package world.theworld.server.social;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.auth.AuthService;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.Json;
import world.theworld.server.social.SocialDtos.ActivityIn;
import world.theworld.server.social.SocialDtos.AgentPut;
import world.theworld.server.social.SocialDtos.AgentsAtRequest;
import world.theworld.server.social.SocialDtos.FriendAdd;
import world.theworld.server.social.SocialDtos.FriendEntry;
import world.theworld.server.social.SocialDtos.Hit;
import world.theworld.server.social.SocialDtos.PlaceIn;
import world.theworld.server.social.SocialDtos.PublishedActivityDto;
import world.theworld.server.social.SocialDtos.RemoteAgent;
import world.theworld.server.social.SocialDtos.RemotePlace;
import world.theworld.server.social.SocialDtos.SchedulePut;
import world.theworld.server.social.SocialDtos.Slot;

/**
 * 진짜 사람 에이전트 (BACKEND-CONTRACT §2.3, FRIENDS_SPEC §4). 서버가 하는 일은 셋뿐 — 프로필·발행 일정 저장, 장소·시간 겹침 조회,
 * 친구 관계. 굴림(rollTalk)·판정은 프런트(ADR-0006 결정 5)라 여기엔 확률이 없다.
 */
@Service
public class SocialService {
  /** timeline.ts ENCOUNTER_MIN_MS — 30분 넘게 겹쳐야 마주침 후보. */
  public static final long ENCOUNTER_MIN_MS = 30 * 60_000L;
  public static final int MAX_ACTIVITIES = 64;
  public static final int MAX_SLOTS = 16;
  public static final int MAX_HITS_PER_SLOT = 8;
  public static final long MAX_DAY_WINDOW_MS = 7 * 24 * 3_600_000L;
  static final Set<String> REACH_BY = Set.of("boat", "plane", "train");

  private final AgentProfileRepository profiles;
  private final PublishedActivityRepository activities;
  private final FriendshipRepository friendships;
  private final AuthService auth;
  private final Json json;

  public SocialService(AgentProfileRepository profiles, PublishedActivityRepository activities, FriendshipRepository friendships, AuthService auth, Json json) {
    this.profiles = profiles;
    this.activities = activities;
    this.friendships = friendships;
    this.auth = auth;
    this.json = json;
  }

  // ── 검증 도우미: 틀린 곳을 한 줄로 (Node 백엔드 validate 관례) ──

  static String nfc(String s) { return Normalizer.normalize(s, Normalizer.Form.NFC); }

  static String str(String s, int max, String what) {
    if (s == null || s.isEmpty() || s.length() > max) throw ApiException.badRequest(what + " must be 1-" + max + " chars");
    return nfc(s);
  }

  static String optStr(String s, int max, String what) {
    if (s == null) return null;
    if (s.length() > max) throw ApiException.badRequest(what + " must be ≤ " + max + " chars");
    return nfc(s);
  }

  static String strOrEmpty(String s, int max, String what) {
    String v = optStr(s, max, what);
    return v == null ? "" : v;
  }

  static List<String> strings(List<String> v, int maxItems, int maxLen, String what) {
    if (v == null) return List.of();
    if (v.size() > maxItems || v.stream().anyMatch(x -> x == null || x.length() > maxLen)) {
      throw ApiException.badRequest(what + " must be ≤ " + maxItems + " strings of ≤ " + maxLen + " chars");
    }
    return v.stream().map(SocialService::nfc).toList();
  }

  static long num(Long v, String what) {
    if (v == null) throw ApiException.badRequest(what + " required");
    return v;
  }

  static double finite(Double v, String what) {
    if (v == null || !Double.isFinite(v)) throw ApiException.badRequest(what + " must be finite");
    return v;
  }

  /** RemotePlace 정규화. forcedId/forcedType/owner가 있으면 서버가 강제한다(집: `home:<userId>` · friend_home · ownerFriendId = userId). */
  static RemotePlace place(PlaceIn in, String what, String forcedId, String forcedType, String owner) {
    if (in == null) throw ApiException.badRequest(what + " required");
    double lng = finite(in.lng(), what + ".lng/lat");
    double lat = finite(in.lat(), what + ".lng/lat");
    String id = forcedId != null ? forcedId : str(in.id(), 80, what + ".id");
    String type = forcedType != null ? forcedType : str(in.type(), 24, what + ".type");
    String name = str(in.name(), 80, what + ".name");
    String reachBy = in.reachBy() != null && REACH_BY.contains(in.reachBy()) ? in.reachBy() : null;
    String ownerId = owner != null ? owner : optStr(in.ownerFriendId(), 80, what + ".ownerFriendId");
    return new RemotePlace(id, name, type, lng, lat, strOrEmpty(in.area(), 80, what + ".area"), strOrEmpty(in.city(), 40, what + ".city"),
      strOrEmpty(in.country(), 8, what + ".country"), strOrEmpty(in.emoji(), 8, what + ".emoji"), reachBy, ownerId);
  }

  // ── 변환 ──

  RemoteAgent toAgent(AgentProfile p) {
    return new RemoteAgent(p.getUserId(), p.getName(), p.getHomePlaceId(), p.getColor(), p.getEmoji(), json.readStrings(p.getLikesJson()),
      json.readStrings(p.getTraitsJson()), p.getHairStyle(), json.read(p.getHomeJson(), RemotePlace.class));
  }

  PublishedActivityDto toDto(PublishedActivity a) {
    RemotePlace place = a.getPlaceJson() == null ? null : json.read(a.getPlaceJson(), RemotePlace.class);
    return new PublishedActivityDto(a.getActKey(), a.getUserId(), a.getDayKey(), a.getBlockId(), a.getPlaceId(), place, a.getCategory(), a.getTitle(),
      a.getEmoji(), a.getArriveAt(), a.getEndAt(), a.getTz(), json.readStrings(a.getCompanionsJson()));
  }

  Map<String, RemoteAgent> agentsById(Set<String> userIds) {
    Map<String, RemoteAgent> out = new HashMap<>();
    if (userIds.isEmpty()) return out;
    for (AgentProfile p : profiles.findAllById(userIds)) out.put(p.getUserId(), toAgent(p));
    return out;
  }

  // ── §2.3 PUT /api/me/agent ──

  @Transactional
  public RemoteAgent putAgent(String userId, AgentPut req) {
    if (req == null) throw ApiException.badRequest("body required");
    String name = str(req.name(), 40, "name");
    String color = str(req.color(), 16, "color");
    String emoji = str(req.emoji(), 8, "emoji");
    String hair = optStr(req.hairStyle(), 24, "hairStyle");
    List<String> likes = strings(req.likes(), 12, 30, "likes");
    List<String> traits = strings(req.traits(), 12, 30, "traits");
    RemotePlace home = place(req.home(), "home", "home:" + userId, "friend_home", userId);
    AgentProfile p = profiles.findById(userId).orElseGet(() -> new AgentProfile(userId));
    p.update(name, color, emoji, hair, json.write(likes), json.write(traits), json.write(home), home.id(), System.currentTimeMillis());
    return toAgent(profiles.save(p));
  }

  // ── §2.3 PUT /api/me/schedule — 창 교체 ──

  @Transactional
  public int putSchedule(String userId, SchedulePut req) {
    if (req == null) throw ApiException.badRequest("body required");
    long from = num(req.from(), "from");
    long to = num(req.to(), "to");
    if (from >= to) throw ApiException.badRequest("from must be < to");
    List<ActivityIn> in = req.activities() == null ? List.of() : req.activities();
    if (in.size() > MAX_ACTIVITIES) throw ApiException.badRequest("activities must have ≤ " + MAX_ACTIVITIES + " items");
    long now = System.currentTimeMillis();
    Set<String> keys = new HashSet<>();
    Map<String, RemotePlace> homes = new HashMap<>();   // 이번 요청에서 찾아본 남의 집 (id → 프로필의 집)
    List<PublishedActivity> rows = new ArrayList<>(in.size());
    for (ActivityIn a : in) {
      if (a == null) throw ApiException.badRequest("activity must be an object");
      String key = str(a.key(), 120, "activity.key");
      if (!keys.add(key)) throw ApiException.badRequest("activity.key duplicated: " + key);
      long arriveAt = num(a.arriveAt(), "activity.arriveAt");
      long endAt = num(a.endAt(), "activity.endAt");
      if (arriveAt >= endAt) throw ApiException.badRequest("activity.arriveAt must be < endAt");
      if (arriveAt < from || arriveAt >= to) throw ApiException.badRequest("activity.arriveAt must be within [from, to)");
      String placeId = str(a.placeId(), 80, "activity.placeId");
      RemotePlace place = activityPlace(userId, placeId, a.place(), homes);
      rows.add(new PublishedActivity(new PublishedActivityId(userId, key), str(a.dayKey(), 60, "activity.dayKey"), str(a.blockId(), 12, "activity.blockId"),
        placeId, place == null ? null : json.write(place), str(a.category(), 12, "activity.category"),
        str(a.title(), 120, "activity.title"), strOrEmpty(a.emoji(), 8, "activity.emoji"), arriveAt, endAt, str(a.tz(), 48, "activity.tz"),
        json.write(strings(a.companions(), 16, 80, "activity.companions")), now));
      // agentId는 무시하고 userId로 덮는다 (§2.3)
    }
    activities.deleteWindow(userId, from, to);
    if (!keys.isEmpty()) activities.deleteKeys(userId, keys);
    activities.saveAll(rows);
    return rows.size();
  }

  static final String HOME_PREFIX = "home:";

  /**
   * 발행 활동의 장소 — 서버가 지키는 것. 다른 사용자에게 그대로 재배포되는 값이라 사용자 입력을 믿지 않는다:
   * <ul>
   *   <li>{@code place.id}는 {@code activity.placeId}로 강제한다 (프런트 validPublished도 같은 것만 싣는다).</li>
   *   <li>집 id({@code home:<userId>})는 그 사람의 프로필에 있는 집이어야 한다. 내 집은 PUT /api/me/agent와 같은 강제(friend_home ·
   *       ownerFriendId = 나), 남의 집(친구 집 방문)은 서버가 가진 그 프로필의 집으로 바꿔 싣는다 — 가짜 좌표로 남의 집 id를 선점할 수 없다.
   *       프로필 없는 사람의 집은 400 (친구가 되려면 프로필이 있어야 하므로 정상 경로에서는 나오지 않는다).</li>
   *   <li>friend_home이 아닌 type에는 ownerFriendId를 두지 않는다.</li>
   * </ul>
   *
   * @return 실을 장소, 없으면 null (남의 집은 place가 없어도 프로필의 집을 싣는다)
   */
  RemotePlace activityPlace(String userId, String placeId, PlaceIn in, Map<String, RemotePlace> homes) {
    if (placeId.startsWith(HOME_PREFIX)) {
      String owner = placeId.substring(HOME_PREFIX.length());
      if (owner.equals(userId)) return in == null ? null : place(in, "activity.place", placeId, "friend_home", userId);
      RemotePlace home = homes.get(owner);
      if (home == null) {
        AgentProfile p = profiles.findById(owner).orElseThrow(() -> ApiException.badRequest("activity.placeId: unknown home " + placeId));
        home = json.read(p.getHomeJson(), RemotePlace.class);
        homes.put(owner, home);
      }
      return home;
    }
    if (in == null) return null;
    RemotePlace p = place(in, "activity.place", placeId, null, null);
    if (p.ownerFriendId() == null || "friend_home".equals(p.type())) return p;
    return new RemotePlace(p.id(), p.name(), p.type(), p.lng(), p.lat(), p.area(), p.city(), p.country(), p.emoji(), p.reachBy(), null);
  }

  // ── §2.3 POST /api/agents/at — 겹침 조회 ──

  private record Cand(String userId, long overlapMs, PublishedActivity act) {}

  @Transactional(readOnly = true)
  public Map<String, List<Hit>> agentsAt(String me, AgentsAtRequest req) {
    if (req == null || req.slots() == null) throw ApiException.badRequest("slots required");
    if (req.slots().size() > MAX_SLOTS) throw ApiException.badRequest("slots must have ≤ " + MAX_SLOTS + " items");
    Map<String, List<Cand>> perSlot = new LinkedHashMap<>();
    Set<String> userIds = new HashSet<>();
    for (Slot s : req.slots()) {
      if (s == null) throw ApiException.badRequest("slot must be an object");
      String key = str(s.key(), 200, "slot.key");
      String placeId = str(s.placeId(), 80, "slot.placeId");
      long from = num(s.from(), "slot.from");
      long to = num(s.to(), "slot.to");
      if (from >= to) throw ApiException.badRequest("slot.from must be < to");
      Map<String, Cand> best = new LinkedHashMap<>();   // 한 사람이 같은 장소에 연달아 있으면 가장 오래 겹친 활동 하나만
      for (PublishedActivity r : activities.findOverlapping(placeId, from, to, me)) {
        long overlap = Math.min(to, r.getEndAt()) - Math.max(from, r.getArriveAt());
        if (overlap < ENCOUNTER_MIN_MS) continue;
        Cand prev = best.get(r.getUserId());
        if (prev == null || overlap > prev.overlapMs()) best.put(r.getUserId(), new Cand(r.getUserId(), overlap, r));
      }
      perSlot.put(key, new ArrayList<>(best.values()));
      userIds.addAll(best.keySet());
    }
    Map<String, RemoteAgent> agents = agentsById(userIds);   // 프로필 없는 사용자는 제외
    Map<String, List<Hit>> out = new LinkedHashMap<>();
    for (Map.Entry<String, List<Cand>> e : perSlot.entrySet()) {
      List<Hit> hits = e.getValue().stream()
        .filter(c -> agents.containsKey(c.userId()))
        .sorted(Comparator.comparing(Cand::userId))   // agent.id 오름차순 — 프런트 결정성
        .limit(MAX_HITS_PER_SLOT)
        .map(c -> new Hit(agents.get(c.userId()), c.overlapMs(), toDto(c.act())))
        .toList();
      out.put(e.getKey(), hits);
    }
    return out;
  }

  // ── §2.3 친구 ──

  @Transactional(readOnly = true)
  public List<FriendEntry> friends(String me, long at) {
    Map<String, Friendship> byOther = new LinkedHashMap<>();
    for (Friendship f : friendships.findAllOf(me)) byOther.put(f.getId().other(me), f);
    Map<String, RemoteAgent> agents = agentsById(byOther.keySet());
    Map<String, PublishedActivity> nowBy = new HashMap<>();
    if (!agents.isEmpty()) for (PublishedActivity a : activities.findNow(agents.keySet(), at)) nowBy.putIfAbsent(a.getUserId(), a);
    List<FriendEntry> out = new ArrayList<>();
    for (String id : byOther.keySet()) {
      RemoteAgent agent = agents.get(id);
      if (agent == null) continue;   // 프로필을 아직 안 올린 친구는 그릴 수 없으니 뺀다
      Friendship f = byOther.get(id);
      PublishedActivity now = nowBy.get(id);
      out.add(new FriendEntry(agent, f.getMetAt(), f.getMetPlaceId(), now == null ? null : toDto(now)));
    }
    out.sort(Comparator.comparing(e -> e.agent().id()));
    return out;
  }

  @Transactional
  public boolean addFriend(String me, FriendAdd req) {
    if (req == null || req.otherId() == null || req.otherId().isBlank()) throw ApiException.badRequest("otherId required");
    String other = req.otherId();
    if (other.equals(me)) throw ApiException.badRequest("cannot befriend yourself");
    if (!auth.exists(other)) throw ApiException.notFound("user not found");
    String metPlaceId = optStr(req.metPlaceId(), 80, "metPlaceId");
    FriendshipId id = FriendshipId.of(me, other);
    if (friendships.existsById(id)) return false;   // 멱등 — 처음 기록한 마주침을 지킨다
    friendships.save(new Friendship(id, req.metAt(), metPlaceId, System.currentTimeMillis()));
    return true;
  }

  @Transactional
  public void removeFriend(String me, String otherId) {
    friendships.deleteById(FriendshipId.of(me, otherId));
  }

  @Transactional(readOnly = true)
  public List<PublishedActivityDto> friendDay(String me, String otherId, long from, long to) {
    // 권한이 검증보다 먼저 — 친구가 아닌 사람에게는 창이 어떻든 403이다 (계약 §2.3 "친구가 아니면 403; 창 ≤ 7일")
    if (!friendships.existsById(FriendshipId.of(me, otherId))) throw ApiException.forbidden("not friends");
    if (from >= to) throw ApiException.badRequest("from must be < to");
    if (to - from > MAX_DAY_WINDOW_MS) throw ApiException.badRequest("window must be ≤ 7 days");
    return activities.findDay(otherId, from, to).stream().map(this::toDto).toList();
  }
}
