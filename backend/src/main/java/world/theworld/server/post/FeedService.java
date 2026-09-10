package world.theworld.server.post;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.common.Json;
import world.theworld.server.post.PostDtos.Feed;
import world.theworld.server.post.PostDtos.FeedItem;
import world.theworld.server.social.AgentProfile;
import world.theworld.server.social.AgentProfileRepository;
import world.theworld.server.social.PublishedActivity;
import world.theworld.server.social.PublishedActivityRepository;
import world.theworld.server.social.SocialDtos.RemoteAgent;
import world.theworld.server.social.SocialDtos.RemotePlace;
import world.theworld.server.social.SocialService;

/**
 * 피드 (CONTRACT §2.5 GET /api/feed, ADR-0021 결정 3·4). 한 줄기 — 친구 글(최신순) 다음에 추천. 추천은 서버가 주인의 취향·인기도·신선도로
 * 점수를 매긴다. 후보를 다 읽어 메모리에서 정렬하고 커서의 offset으로 자른다(ADR-0021 §영향 "처음엔 SQL + 메모리 정렬로 충분").
 *
 * <p><b>가중치는 서버에서만 바꾼다</b> — 프런트는 순서와 이유 칩만 받는다(ADR-0021 결정 4 "가중치는 서버에서만 바꾼다"). 상수를 한자리에 둔다.</p>
 */
@Service
public class FeedService {
  // ── 점수 = 0.5 취향유사도 + 0.3 인기도 + 0.2 신선도 (ADR-0021 결정 4). 서버 전용 — 계약에 값이 실리지 않는다 ──
  static final double W_TASTE = 0.5;
  static final double W_POPULARITY = 0.3;
  static final double W_FRESHNESS = 0.2;
  /** 인기도 = log1p(likes) · exp(-나이일/7), 후보 집합의 최댓값으로 [0,1] 정규화. */
  static final double POPULARITY_DECAY_DAYS = 7;
  /** 신선도 = exp(-나이일/3). */
  static final double FRESHNESS_DECAY_DAYS = 3;
  /** 취향 재료 — 최근 14일의 발행 일정(가중 1.0)과 내가 좋아요한 글(가중 1.5)의 범주·동네·도시 히스토그램. */
  static final long TASTE_WINDOW_MS = 14 * 24 * 3_600_000L;
  static final double W_ACTIVITY = 1.0;
  static final double W_LIKED = 1.5;
  static final int MAX_LIKED_FOR_TASTE = 200;
  /** 후보는 최신 N개 — 그 밖은 신선도가 0에 가까워 어차피 뒤로 간다. */
  static final int MAX_CANDIDATES = 500;
  /** 같은 작성자 연속 최대. */
  static final int MAX_RUN_PER_AUTHOR = 2;
  /** 탐색 몫 — 매 7번째 자리(1/7 ≈ 14%)는 남은 후보 중 취향유사도가 가장 낮은 글. */
  static final int EXPLORE_EVERY = 7;

  static final long DAY_MS = 24 * 3_600_000L;

  /** 이유 칩의 범주 한글 (frontend/src/sim/types.ts Category). */
  static final Map<String, String> CATEGORY_KO = Map.of(
    "sleep", "잠", "meal", "식사", "play", "놀기", "exercise", "운동", "study", "공부", "work", "일", "rest", "쉬기", "travel", "여행");
  static final String WHY_CITY = "같은 도시";
  static final String WHY_POPULAR = "요즘 인기";

  private final PostRepository posts;
  private final PostService postService;
  private final AgentProfileRepository profiles;
  private final PublishedActivityRepository activities;
  private final SocialService social;
  private final Json json;

  public FeedService(PostRepository posts, PostService postService, AgentProfileRepository profiles, PublishedActivityRepository activities,
                     SocialService social, Json json) {
    this.posts = posts;
    this.postService = postService;
    this.profiles = profiles;
    this.activities = activities;
    this.social = social;
    this.json = json;
  }

  /** 점수 매긴 후보 하나. why는 추천 구간의 이유 칩. */
  record Scored(Post post, double taste, double score, String why) {}

  // ── §2.5 GET /api/feed ──

  @Transactional(readOnly = true)
  public Feed feed(String me, String rawCursor, Integer rawLimit) {
    int limit = PostService.limit(rawLimit);
    Cursor cursor = Cursor.decode(rawCursor, Cursor.FRIENDS, "fr");
    long now = System.currentTimeMillis();
    Set<String> friends = postService.friendIds(me);
    List<FeedItem> items = new ArrayList<>(limit);
    String next = null;

    if (cursor.section() == Cursor.FRIENDS) {
      // 프로필 없는 친구는 카드를 그릴 수 없으니 뺀다 (GET /api/friends와 같은 규칙)
      Map<String, RemoteAgent> agents = social.agentsById(friends);
      List<Post> rows = agents.isEmpty() ? List.of() : posts.findByAuthors(agents.keySet(), Offset.of(cursor.offset(), limit + 1));
      boolean more = rows.size() > limit;
      List<Post> page = more ? rows.subList(0, limit) : rows;
      List<PostDtos.Post> dtos = postService.toDtos(me, page);
      for (int i = 0; i < page.size(); i++) items.add(new FeedItem(dtos.get(i), agents.get(page.get(i).getAuthorId()), null));
      if (more) return new Feed(items, new Cursor(Cursor.FRIENDS, cursor.offset() + limit).encode());
      cursor = new Cursor(Cursor.RECOMMENDED, 0);   // 친구 글이 다 나왔으면 같은 응답에서 추천으로 이어진다
    }

    int room = limit - items.size();
    List<Scored> ranked = recommend(me, friends, now);
    int from = (int) Math.min(cursor.offset(), ranked.size());
    int to = Math.min(from + room, ranked.size());
    List<Scored> slice = ranked.subList(from, to);
    if (!slice.isEmpty()) {
      Map<String, RemoteAgent> agents = social.agentsById(slice.stream().map(s -> s.post().getAuthorId()).collect(Collectors.toSet()));
      List<PostDtos.Post> dtos = postService.toDtos(me, slice.stream().map(Scored::post).toList());
      for (int i = 0; i < slice.size(); i++) items.add(new FeedItem(dtos.get(i), agents.get(slice.get(i).post().getAuthorId()), slice.get(i).why()));
    }
    if (to < ranked.size()) next = new Cursor(Cursor.RECOMMENDED, to).encode();
    return new Feed(items, next);
  }

  // ── 추천 ──

  /** 후보(공개 계정 · 나·친구 제외 · 내가 좋아요한 글 제외)를 점수순으로, 작성자 연속 제한·탐색 몫까지 적용한 전체 목록. */
  List<Scored> recommend(String me, Set<String> friends, long now) {
    Set<String> excluded = new HashSet<>(friends);
    excluded.add(me);
    List<Post> cands = posts.findCandidates(me, AgentProfile.VISIBILITY_PUBLIC, excluded, Offset.of(0, MAX_CANDIDATES));
    if (cands.isEmpty()) return List.of();
    return arrange(rank(cands, taste(me, now), now));
  }

  /** 취향 히스토그램 — 면 키는 c:범주 · a:동네 · t:도시 (동네와 도시가 같은 이름이어도 섞이지 않게). */
  Map<String, Double> taste(String me, long now) {
    Map<String, Double> h = new HashMap<>();
    for (PublishedActivity a : activities.findDay(me, now - TASTE_WINDOW_MS, now)) {
      add(h, "c:" + a.getCategory(), W_ACTIVITY);
      if (a.getPlaceJson() != null) {
        RemotePlace pl = json.read(a.getPlaceJson(), RemotePlace.class);
        add(h, key("a:", pl.area()), W_ACTIVITY);
        add(h, key("t:", pl.city()), W_ACTIVITY);
      }
    }
    for (Post p : posts.findLikedBy(me, Offset.of(0, MAX_LIKED_FOR_TASTE))) {
      for (String f : facets(p)) add(h, f, W_LIKED);
    }
    return h;
  }

  private static String key(String prefix, String v) { return v == null || v.isEmpty() ? null : prefix + v; }

  private static void add(Map<String, Double> h, String key, double w) {
    if (key != null) h.merge(key, w, Double::sum);
  }

  /** 글의 one-hot 면 {범주, 동네, 도시} — 빈 것은 뺀다. */
  static List<String> facets(Post p) {
    List<String> out = new ArrayList<>(3);
    String c = key("c:", p.getCategory());
    String a = key("a:", p.getArea());
    String t = key("t:", p.getCity());
    if (c != null) out.add(c);
    if (a != null) out.add(a);
    if (t != null) out.add(t);
    return out;
  }

  static double ageDays(Post p, long now) { return Math.max(0, now - p.getCreatedAt()) / (double) DAY_MS; }

  /**
   * 점수 = W_TASTE·코사인(내 히스토그램, 글의 one-hot 면) + W_POPULARITY·(log1p(likes)·감쇠 / 후보 최댓값) + W_FRESHNESS·exp(-나이/3).
   * 점수 내림차순, 동률은 createdAt 내림차순 → id 내림차순 — 데이터가 같으면 순서도 같다(안정 정렬).
   */
  static List<Scored> rank(List<Post> cands, Map<String, Double> hist, long now) {
    double norm = Math.sqrt(hist.values().stream().mapToDouble(v -> v * v).sum());
    double[] pop = new double[cands.size()];
    double maxPop = 0;
    for (int i = 0; i < cands.size(); i++) {
      Post p = cands.get(i);
      pop[i] = Math.log1p(p.getLikes()) * Math.exp(-ageDays(p, now) / POPULARITY_DECAY_DAYS);
      maxPop = Math.max(maxPop, pop[i]);
    }
    List<Scored> out = new ArrayList<>(cands.size());
    for (int i = 0; i < cands.size(); i++) {
      Post p = cands.get(i);
      List<String> facets = facets(p);
      double dot = 0;
      for (String f : facets) dot += hist.getOrDefault(f, 0.0);
      double taste = norm == 0 || facets.isEmpty() ? 0 : dot / (norm * Math.sqrt(facets.size()));
      double popularity = maxPop == 0 ? 0 : pop[i] / maxPop;
      double freshness = Math.exp(-ageDays(p, now) / FRESHNESS_DECAY_DAYS);
      out.add(new Scored(p, taste, W_TASTE * taste + W_POPULARITY * popularity + W_FRESHNESS * freshness, why(p, hist)));
    }
    out.sort(Comparator.comparingDouble(Scored::score).reversed()
      .thenComparing(Comparator.comparingLong((Scored s) -> s.post().getCreatedAt()).reversed())
      .thenComparing(Comparator.comparing((Scored s) -> s.post().getId()).reversed()));
    return out;
  }

  /** 이유 칩 — 맞은 면 중 가장 구체적인 것: 범주 → 동네 → 도시(만 맞음) → 없으면 인기. */
  static String why(Post p, Map<String, Double> hist) {
    String c = p.getCategory();
    if (c != null && !c.isEmpty() && hist.getOrDefault("c:" + c, 0.0) > 0) return CATEGORY_KO.getOrDefault(c, c) + " 글을 좋아하셔서";
    if (p.getArea() != null && !p.getArea().isEmpty() && hist.getOrDefault("a:" + p.getArea(), 0.0) > 0) return p.getArea() + " 이웃";
    if (p.getCity() != null && !p.getCity().isEmpty() && hist.getOrDefault("t:" + p.getCity(), 0.0) > 0) return WHY_CITY;
    return WHY_POPULAR;
  }

  /**
   * 후처리 — 자리마다 하나씩 뽑는다. 같은 작성자가 MAX_RUN_PER_AUTHOR번 연속이면 다음 다른 작성자를 앞으로 당긴다(없으면 그냥 둔다).
   * EXPLORE_EVERY번째 자리는 남은 후보(연속 제한을 지키는 것 중) 가운데 취향유사도가 가장 낮은 글 — 동률은 점수순 앞 것.
   */
  static List<Scored> arrange(List<Scored> ranked) {
    List<Scored> pool = new ArrayList<>(ranked);
    List<Scored> out = new ArrayList<>(ranked.size());
    while (!pool.isEmpty()) {
      Scored pick = null;
      if ((out.size() + 1) % EXPLORE_EVERY == 0) {
        for (Scored s : pool) if (allowed(out, s) && (pick == null || s.taste() < pick.taste())) pick = s;
      }
      if (pick == null) for (Scored s : pool) if (allowed(out, s)) { pick = s; break; }
      if (pick == null) pick = pool.get(0);
      pool.remove(pick);
      out.add(pick);
    }
    return out;
  }

  private static boolean allowed(List<Scored> out, Scored s) {
    int n = out.size();
    if (n < MAX_RUN_PER_AUTHOR) return true;
    String author = s.post().getAuthorId();
    for (int i = 1; i <= MAX_RUN_PER_AUTHOR; i++) if (!out.get(n - i).post().getAuthorId().equals(author)) return true;
    return false;
  }
}
