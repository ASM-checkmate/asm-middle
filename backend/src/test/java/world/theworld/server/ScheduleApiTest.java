package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;

/** 프로필·발행 일정 창 교체 (BACKEND-CONTRACT §2.3 PUT /api/me/agent, PUT /api/me/schedule). */
class ScheduleApiTest extends ApiTest {
  static final long H = 3_600_000L;

  @Test
  void agentProfileIsForcedIntoShape() throws Exception {
    Session s = newUser();
    JsonNode a = putAgent(s, "모모");
    assertThat(a.get("id").asText()).isEqualTo(s.userId());
    assertThat(a.get("name").asText()).isEqualTo("모모");
    assertThat(a.get("homePlaceId").asText()).isEqualTo("home:" + s.userId());
    assertThat(a.get("home").get("id").asText()).isEqualTo("home:" + s.userId());
    assertThat(a.get("home").get("type").asText()).isEqualTo("friend_home");
    assertThat(a.get("home").get("ownerFriendId").asText()).isEqualTo(s.userId());
    assertThat(a.get("home").get("lng").asDouble()).isEqualTo(126.92);
    assertThat(a.get("home").has("reachBy")).isFalse();
    assertThat(a.get("likes")).hasSize(2);
    assertThat(a.get("hairStyle").asText()).isEqualTo("short");

    // 다시 올리면 덮어쓴다 — hairStyle 없으면 키가 빠진다
    MvcResult r = call(HttpMethod.PUT, "/api/me/agent", s, Map.of("name", "미미", "color", "#fff", "emoji", "🐰", "likes", List.of(), "traits", List.of(), "home", home(1, 2))).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(r).get("name").asText()).isEqualTo("미미");
    assertThat(json(r).has("hairStyle")).isFalse();
  }

  @Test
  void agentProfileValidation() throws Exception {
    Session s = newUser();
    Map<String, Object> ok = Map.of("name", "모모", "color", "#fff", "emoji", "🐰", "likes", List.of(), "traits", List.of(), "home", home(1, 2));
    Map<String, Object> noName = new java.util.HashMap<>(ok); noName.put("name", "");
    assertThat(json(call(HttpMethod.PUT, "/api/me/agent", s, noName).andReturn()).get("error").asText()).isEqualTo("name must be 1-40 chars");
    Map<String, Object> tooManyLikes = new java.util.HashMap<>(ok); tooManyLikes.put("likes", java.util.Collections.nCopies(13, "x"));
    assertThat(call(HttpMethod.PUT, "/api/me/agent", s, tooManyLikes).andReturn().getResponse().getStatus()).isEqualTo(400);
    Map<String, Object> badHome = new java.util.HashMap<>(ok); Map<String, Object> h = home(1, 2); h.put("lng", "east"); badHome.put("home", h);
    assertThat(call(HttpMethod.PUT, "/api/me/agent", s, badHome).andReturn().getResponse().getStatus()).isEqualTo(400);
    Map<String, Object> noHome = new java.util.HashMap<>(ok); noHome.remove("home");
    assertThat(json(call(HttpMethod.PUT, "/api/me/agent", s, noHome).andReturn()).get("error").asText()).isEqualTo("home required");
  }

  @Test
  void scheduleReplacesWindow() throws Exception {
    Session me = newUser();
    Session friend = newUser();
    putAgent(me, "나");
    putAgent(friend, "친구");
    call(HttpMethod.POST, "/api/friends", friend, Map.of("otherId", me.userId())).andReturn();

    long day = 1_800_000_000_000L;
    JsonNode c1 = putSchedule(me, day, day + 24 * H, acts(
      activity("2027-01-01@Asia/Seoul:am", "cafe-1", day + 9 * H, day + 11 * H),
      activity("2027-01-01@Asia/Seoul:pm", "park-1", day + 14 * H, day + 17 * H)));
    assertThat(c1.get("count").asInt()).isEqualTo(2);

    JsonNode d1 = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), friend, null).andReturn());
    assertThat(d1.get("activities")).hasSize(2);
    JsonNode first = d1.get("activities").get(0);
    assertThat(first.get("key").asText()).isEqualTo("2027-01-01@Asia/Seoul:am");
    assertThat(first.get("agentId").asText()).isEqualTo(me.userId());   // 보낸 agentId는 무시, userId로
    assertThat(first.get("blockId").asText()).isEqualTo("am");
    assertThat(first.get("companions").isArray()).isTrue();
    assertThat(first.has("place")).isFalse();

    // 같은 창을 활동 하나로 다시 올리면 나머지는 사라진다
    JsonNode c2 = putSchedule(me, day, day + 24 * H, acts(activity("2027-01-01@Asia/Seoul:pm", "park-2", day + 15 * H, day + 17 * H)));
    assertThat(c2.get("count").asInt()).isEqualTo(1);
    JsonNode d2 = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), friend, null).andReturn());
    assertThat(d2.get("activities")).hasSize(1);
    assertThat(d2.get("activities").get(0).get("placeId").asText()).isEqualTo("park-2");

    // 다른 창(다음날)은 건드리지 않는다
    long next = day + 24 * H;
    putSchedule(me, next, next + 24 * H, acts(activity("2027-01-02@Asia/Seoul:am", "cafe-1", next + 9 * H, next + 11 * H)));
    JsonNode d3 = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 48 * H), friend, null).andReturn());
    assertThat(d3.get("activities")).hasSize(2);

    // 빈 창 교체 = 지우기
    putSchedule(me, day, next + 24 * H, acts());
    JsonNode d4 = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 48 * H), friend, null).andReturn());
    assertThat(d4.get("activities")).isEmpty();
  }

  @Test
  void scheduleCarriesPlaceAndNormalizesTitle() throws Exception {
    Session me = newUser();
    Session friend = newUser();
    putAgent(me, "나");
    putAgent(friend, "친구");
    call(HttpMethod.POST, "/api/friends", me, Map.of("otherId", friend.userId())).andReturn();
    long day = 1_800_000_000_000L;
    Map<String, Object> a = activity("2027-01-01@Asia/Seoul:am", "kyoto-cafe", day + 9 * H, day + 11 * H);
    a.put("title", "카페가");   // 분해된 '가' → NFC '가'
    Map<String, Object> place = home(135.7, 35.0); place.put("id", "kyoto-cafe"); place.put("type", "cafe"); place.put("reachBy", "train");
    a.put("place", place);
    a.put("companions", List.of(friend.userId()));
    putSchedule(me, day, day + 24 * H, acts(a));
    JsonNode d = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), friend, null).andReturn());
    JsonNode act = d.get("activities").get(0);
    assertThat(act.get("title").asText()).isEqualTo("카페가");
    assertThat(act.get("place").get("id").asText()).isEqualTo("kyoto-cafe");
    assertThat(act.get("place").get("reachBy").asText()).isEqualTo("train");
    assertThat(act.get("companions").get(0).asText()).isEqualTo(friend.userId());
  }

  @Test
  void activityPlaceIsGuarded() throws Exception {
    Session me = newUser();
    Session friend = newUser();
    Session stranger = newUser();   // 프로필 없음
    putAgent(me, "나");
    putAgent(friend, "친구");
    call(HttpMethod.POST, "/api/friends", me, Map.of("otherId", friend.userId())).andReturn();
    long day = 1_800_000_000_000L;
    String myHome = "home:" + me.userId(), friendHome = "home:" + friend.userId();

    // place.id는 placeId로 강제, friend_home이 아니면 ownerFriendId는 지운다
    Map<String, Object> a1 = activity("2027-01-01@Asia/Seoul:am", "kyoto-cafe", day + 9 * H, day + 10 * H);
    Map<String, Object> p1 = home(135.7, 35.0); p1.put("id", "other-id"); p1.put("type", "cafe"); p1.put("ownerFriendId", friend.userId());
    a1.put("place", p1);
    // 내 집: PUT /api/me/agent와 같은 강제
    Map<String, Object> a2 = activity("2027-01-01@Asia/Seoul:lunch", myHome, day + 11 * H, day + 12 * H);
    Map<String, Object> p2 = home(1, 2); p2.put("id", "home"); p2.put("type", "home");
    a2.put("place", p2);
    // 친구 집 방문: 사용자가 보낸 가짜 좌표 대신 서버가 가진 프로필의 집을 싣는다
    Map<String, Object> a3 = activity("2027-01-01@Asia/Seoul:pm", friendHome, day + 14 * H, day + 15 * H);
    Map<String, Object> p3 = home(0.0, 0.0); p3.put("id", friendHome); p3.put("type", "friend_home"); p3.put("name", "가짜 집"); p3.put("ownerFriendId", friend.userId());
    a3.put("place", p3);
    // 친구 집인데 place를 안 보내도 프로필의 집이 실린다
    Map<String, Object> a4 = activity("2027-01-01@Asia/Seoul:evening", friendHome, day + 18 * H, day + 19 * H);
    putSchedule(me, day, day + 24 * H, acts(a1, a2, a3, a4));

    JsonNode d = json(call(HttpMethod.GET, "/api/friends/" + me.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), friend, null).andReturn()).get("activities");
    assertThat(d).hasSize(4);
    JsonNode cafe = d.get(0).get("place");
    assertThat(cafe.get("id").asText()).isEqualTo("kyoto-cafe");
    assertThat(cafe.get("type").asText()).isEqualTo("cafe");
    assertThat(cafe.has("ownerFriendId")).isFalse();
    JsonNode mine = d.get(1).get("place");
    assertThat(mine.get("id").asText()).isEqualTo(myHome);
    assertThat(mine.get("type").asText()).isEqualTo("friend_home");
    assertThat(mine.get("ownerFriendId").asText()).isEqualTo(me.userId());
    for (int i : new int[] { 2, 3 }) {
      JsonNode theirs = d.get(i).get("place");
      assertThat(theirs.get("id").asText()).isEqualTo(friendHome);
      assertThat(theirs.get("type").asText()).isEqualTo("friend_home");
      assertThat(theirs.get("ownerFriendId").asText()).isEqualTo(friend.userId());
      assertThat(theirs.get("name").asText()).isEqualTo("우리집");   // putAgent의 집
      assertThat(theirs.get("lng").asDouble()).isEqualTo(126.92);
    }

    // 프로필 없는 사람의 집 id는 400
    Map<String, Object> a5 = activity("2027-01-01@Asia/Seoul:am", "home:" + stranger.userId(), day + 9 * H, day + 10 * H);
    MvcResult bad = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("from", day, "to", day + 24 * H, "activities", acts(a5))).andReturn();
    assertThat(bad.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(bad).get("error").asText()).isEqualTo("activity.placeId: unknown home home:" + stranger.userId());
  }

  @Test
  void scheduleValidation() throws Exception {
    Session me = newUser();
    long day = 1_800_000_000_000L;
    List<Map<String, Object>> many = new ArrayList<>();
    for (int i = 0; i < 65; i++) many.add(activity("d@Asia/Seoul:b" + i, "p", day + i * 60_000L, day + i * 60_000L + 30_000L));
    MvcResult tooMany = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("from", day, "to", day + 24 * H, "activities", many)).andReturn();
    assertThat(tooMany.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(tooMany).get("error").asText()).isEqualTo("activities must have ≤ 64 items");

    MvcResult backwards = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("from", day, "to", day + 24 * H,
      "activities", acts(activity("d@Asia/Seoul:am", "p", day + 2 * H, day + H)))).andReturn();
    assertThat(json(backwards).get("error").asText()).isEqualTo("activity.arriveAt must be < endAt");

    MvcResult outside = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("from", day, "to", day + 24 * H,
      "activities", acts(activity("d@Asia/Seoul:am", "p", day + 30 * H, day + 31 * H)))).andReturn();
    assertThat(json(outside).get("error").asText()).isEqualTo("activity.arriveAt must be within [from, to)");

    MvcResult longKey = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("from", day, "to", day + 24 * H,
      "activities", acts(activity("k".repeat(121) + ":am", "p", day + H, day + 2 * H)))).andReturn();
    assertThat(json(longKey).get("error").asText()).isEqualTo("activity.key must be 1-120 chars");

    MvcResult noWindow = call(HttpMethod.PUT, "/api/me/schedule", me, Map.of("activities", acts())).andReturn();
    assertThat(json(noWindow).get("error").asText()).isEqualTo("from required");
  }
}
