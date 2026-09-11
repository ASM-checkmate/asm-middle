package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.post.Post;
import world.theworld.server.post.PostLikeRepository;
import world.theworld.server.post.PostRepository;

/**
 * 피드 (CONTRACT §2.5 GET /api/feed, ADR-0025 결정 3·4): 친구 글(why 없음) → 추천(why 있음). 비공개 남·나 자신·내가 좋아요한 글은 추천에 없다.
 * 점수는 데이터가 같으면 순서도 같다 — 글은 createdAt·likes를 정해 표에 직접 넣는다(API로 만들면 시각을 못 정한다).
 */
class FeedApiTest extends ApiTest {
  static final long H = 3_600_000L;
  static final long D = 24 * H;

  @Autowired PostRepository postRows;
  @Autowired PostLikeRepository likeRows;

  /** 추천은 공개 계정의 글을 전부 후보로 보므로 다른 테스트가 남긴 공개 글이 섞인다 — 컨텍스트(H2)를 공유하니 표를 비우고 시작한다. */
  @BeforeEach
  void clearPosts() {
    likeRows.deleteAll();
    postRows.deleteAll();
  }

  /** 글 한 편을 표에 직접 — 컷 id는 아무 hex(피드는 미디어 표를 보지 않는다). */
  String seed(Session author, long createdAt, String category, String area, String city, long likes) {
    String id = MediaApiTest.newId();
    String cuts = "[{\"shotId\":\"" + MediaApiTest.newId() + "\",\"actKey\":\"d:am\",\"win\":0,\"by\":\"agent\"}]";
    postRows.save(new Post(id, author.userId(), createdAt, cuts, "글", "어딘가", area, city, category, "2026-09-11@Asia/Seoul", "[]", false, likes));
    return id;
  }

  JsonNode putAgentVis(Session s, String name, String visibility) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name); body.put("color", "#5FC9A6"); body.put("emoji", "🐥"); body.put("likes", List.of()); body.put("traits", List.of());
    body.put("home", home(126.92, 37.56)); body.put("visibility", visibility);
    MvcResult r = call(HttpMethod.PUT, "/api/me/agent", s, body).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    return json(r);
  }

  /** 취향 재료 — 최근 14일 안의 발행 활동 n개, 범주·동네·도시를 정해서. */
  void taste(Session me, long now, int n, String category, String area, String city) throws Exception {
    List<Map<String, Object>> acts = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      long at = now - (i + 1) * D;
      Map<String, Object> a = activity("d" + i + "@Asia/Seoul:am", "place-" + area, at, at + 2 * H);
      a.put("category", category);
      Map<String, Object> place = home(126.9, 37.5);
      place.put("area", area); place.put("city", city);
      a.put("place", place);
      acts.add(a);
    }
    putSchedule(me, now - 15 * D, now, acts);
  }

  JsonNode feed(Session s, String query) throws Exception {
    MvcResult r = call(HttpMethod.GET, "/api/feed" + query, s, null).andReturn();
    assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
    return json(r);
  }

  static List<String> ids(JsonNode items) {
    List<String> out = new ArrayList<>();
    for (JsonNode it : items) out.add(it.get("post").get("id").asText());
    return out;
  }

  /**
   * A(나): 최근 14일 발행 활동 2개 = meal · 연남동 · seoul → 히스토그램 {c:meal 2, a:연남동 2, t:seoul 2}, ‖h‖ = √12 ≈ 3.464.
   * B(친구, 비공개) 글 2 · C(공개 남) 글 3 · D(비공개 남) 글 1 · A 자신 글 1.
   *
   * C의 세 글 (나이 · 좋아요 · 면) 과 손으로 계산한 점수 — 취향 = 내적 / (‖h‖·√면수), 인기 = log1p(likes)·e^(-나이/7) / 최댓값, 신선 = e^(-나이/3):
   *   C1: 0일 · 0  · meal/연남동/seoul  → 취향 6/(3.464·√3) = 1.000, 인기 0,               신선 1.000 → 0.500 + 0     + 0.200 = 0.700
   *   C2: 2일 · 10 · play/성수동/seoul  → 취향 2/(3.464·√3) = 0.333, 인기 1.802/1.959 = 0.920, 신선 0.513 → 0.167 + 0.276 + 0.103 = 0.546
   *   C3: 6일 · 100· exercise/해운대/busan → 취향 0,             인기 1.959/1.959 = 1.000, 신선 0.135 → 0     + 0.300 + 0.027 = 0.327
   * 순서 C1 > C2 > C3. 이유 칩: C1 범주 맞음 '식사 글을 좋아하셔서', C2 도시만 맞음 '같은 도시', C3 아무것도 안 맞음 '요즘 인기'.
   */
  @Test
  void friendsThenRecommendedWithWhy() throws Exception {
    long now = System.currentTimeMillis();
    Session a = newUser();
    Session b = newUser();
    Session c = newUser();
    Session d = newUser();
    putAgentVis(a, "에이", "private");
    putAgentVis(b, "비", "private");
    putAgentVis(c, "씨", "public");
    putAgentVis(d, "디", "private");
    call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", b.userId())).andReturn();
    taste(a, now, 2, "meal", "연남동", "seoul");

    String b1 = seed(b, now - 2 * H, "play", "성수동", "seoul", 0);
    String b2 = seed(b, now - 1 * H, "meal", "연남동", "seoul", 0);
    String c1 = seed(c, now - 60_000L, "meal", "연남동", "seoul", 0);
    String c2 = seed(c, now - 2 * D, "play", "성수동", "seoul", 10);
    String c3 = seed(c, now - 6 * D, "exercise", "해운대", "busan", 100);
    seed(d, now - 1 * H, "meal", "연남동", "seoul", 50);
    seed(a, now - 1 * H, "meal", "연남동", "seoul", 50);

    // 한 장에 다 — 친구 글(최신순, why 없음) 다음 추천(why 있음). D·나 자신은 없다
    JsonNode all = feed(a, "");
    assertThat(ids(all.get("items"))).containsExactly(b2, b1, c1, c2, c3);
    assertThat(all.get("next").isNull()).isTrue();
    JsonNode f0 = all.get("items").get(0);
    assertThat(f0.has("why")).isFalse();
    assertThat(f0.get("author").get("id").asText()).isEqualTo(b.userId());
    assertThat(f0.get("author").get("name").asText()).isEqualTo("비");
    assertThat(f0.get("author").get("visibility").asText()).isEqualTo("private");
    assertThat(f0.get("post").get("likedByMe").asBoolean()).isFalse();
    assertThat(all.get("items").get(2).get("why").asText()).isEqualTo("식사 글을 좋아하셔서");
    assertThat(all.get("items").get(2).get("author").get("visibility").asText()).isEqualTo("public");
    assertThat(all.get("items").get(3).get("why").asText()).isEqualTo("같은 도시");
    assertThat(all.get("items").get(4).get("why").asText()).isEqualTo("요즘 인기");

    // 두 개씩 — 커서가 친구 구간에서 추천 구간으로 이어진다
    JsonNode p1 = feed(a, "?limit=2");
    assertThat(ids(p1.get("items"))).containsExactly(b2, b1);
    assertThat(p1.get("next").isTextual()).isTrue();
    JsonNode p2 = feed(a, "?limit=2&cursor=" + p1.get("next").asText());
    assertThat(ids(p2.get("items"))).containsExactly(c1, c2);
    assertThat(p2.get("items").get(0).get("why").asText()).isEqualTo("식사 글을 좋아하셔서");
    JsonNode p3 = feed(a, "?limit=2&cursor=" + p2.get("next").asText());
    assertThat(ids(p3.get("items"))).containsExactly(c3);
    assertThat(p3.get("next").isNull()).isTrue();

    // 친구 글이 limit보다 적으면 같은 장에서 추천이 이어진다 (친구 2 + 추천 1)
    JsonNode p = feed(a, "?limit=3");
    assertThat(ids(p.get("items"))).containsExactly(b2, b1, c1);
    assertThat(p.get("items").get(2).get("why").asText()).isEqualTo("식사 글을 좋아하셔서");
    JsonNode q = feed(a, "?limit=3&cursor=" + p.get("next").asText());
    assertThat(ids(q.get("items"))).containsExactly(c2, c3);
    assertThat(q.get("next").isNull()).isTrue();

    // 내가 좋아요한 글은 추천에서 빠진다('본 글 제외' = 좋아요한 글). C3에 누르면 취향에 exercise·해운대·busan(1.5씩)이 더해지지만
    // C1 취향 6/(√18.75·√3) = 0.800 → 0.600, C2 2/7.5 = 0.267, 인기 최댓값이 C2 → 0.133 + 0.300 + 0.103 = 0.536. 여전히 C1 > C2
    assertThat(call(HttpMethod.POST, "/api/posts/" + c3 + "/like", a, null).andReturn().getResponse().getStatus()).isEqualTo(200);
    JsonNode after = feed(a, "");
    assertThat(ids(after.get("items"))).containsExactly(b2, b1, c1, c2);

    // 친구 글에 좋아요하면 likedByMe가 실린다
    call(HttpMethod.POST, "/api/posts/" + b2 + "/like", a, null).andReturn();
    assertThat(feed(a, "?limit=1").get("items").get(0).get("post").get("likedByMe").asBoolean()).isTrue();
    assertThat(feed(a, "?limit=1").get("items").get(0).get("post").get("likes").asLong()).isEqualTo(1);

    // C의 눈에는 친구가 없으니 처음부터 추천 — 자기 글은 없고, 비공개 A·B·D도 없다
    JsonNode cs = feed(c, "");
    assertThat(cs.get("items")).isEmpty();
    assertThat(cs.get("next").isNull()).isTrue();

    // 커서 모양이 틀리면 400, 격자 커서('u')는 피드에 못 쓴다
    assertThat(json(call(HttpMethod.GET, "/api/feed?cursor=%3F%3F", a, null).andReturn()).get("error").asText()).isEqualTo("cursor invalid");
    String userCursor = json(call(HttpMethod.GET, "/api/users/" + c.userId() + "/posts?limit=1", a, null).andReturn()).get("next").asText();
    assertThat(json(call(HttpMethod.GET, "/api/feed?cursor=" + userCursor, a, null).andReturn()).get("error").asText()).isEqualTo("cursor invalid");
    // offset이 int를 넘는 친구 구간 커서 — 500이 아니라 400
    MvcResult huge = call(HttpMethod.GET, "/api/feed?cursor=" + PostsApiTest.cursor("f:99999999999"), a, null).andReturn();
    assertThat(huge.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(huge).get("error").asText()).isEqualTo("cursor invalid");
  }

  /**
   * 탐색 몫과 작성자 연속 제한. E(나): 취향 meal · 연남동 · seoul. 공개 남 F 글 5개(전부 취향과 같음, 나이 0~4일), 공개 남 G 글 3개
   * (exercise · 연남동 · busan — 동네만 맞음, 나이 0~2일). 좋아요는 전부 0이라 인기도 0.
   *   F_k: 취향 1.000 → 0.5 + 0.2·e^(-k/3) = F0 0.700, F1 0.643, F2 0.603, F3 0.574, F4 0.553
   *   G_k: 취향 2/(3.464·√3) = 0.333 → 0.167 + 0.2·e^(-k/3) = G0 0.367, G1 0.310, G2 0.269
   * 점수순 F0 F1 F2 F3 F4 G0 G1 G2. 자리마다 뽑기:
   *   1 F0 · 2 F1 · 3 (F 셋 연속 금지 → 다음 다른 작성자) G0 · 4 F2 · 5 F3 · 6 (F 셋 연속 금지) G1 · 7 탐색 = 남은 {F4, G2} 중 취향 최저 G2 · 8 F4
   * → F0 F1 G0 F2 F3 G1 G2 F4. 탐색이 없었다면 7번째는 F4였다.
   */
  @Test
  void explorationSlotAndAuthorRun() throws Exception {
    long now = System.currentTimeMillis();
    Session e = newUser();
    Session f = newUser();
    Session g = newUser();
    putAgentVis(e, "이", "private");
    putAgentVis(f, "에프", "public");
    putAgentVis(g, "지", "public");
    taste(e, now, 2, "meal", "연남동", "seoul");
    List<String> fs = new ArrayList<>();
    for (int k = 0; k < 5; k++) fs.add(seed(f, now - k * D, "meal", "연남동", "seoul", 0));
    List<String> gs = new ArrayList<>();
    for (int k = 0; k < 3; k++) gs.add(seed(g, now - k * D, "exercise", "연남동", "busan", 0));

    JsonNode all = feed(e, "");
    assertThat(ids(all.get("items"))).containsExactly(fs.get(0), fs.get(1), gs.get(0), fs.get(2), fs.get(3), gs.get(1), gs.get(2), fs.get(4));
    assertThat(all.get("items").get(0).get("why").asText()).isEqualTo("식사 글을 좋아하셔서");
    assertThat(all.get("items").get(2).get("why").asText()).isEqualTo("연남동 이웃");
    assertThat(all.get("next").isNull()).isTrue();

    // 세 개씩 — 전체 순서를 자른 것과 같다 (탐색 자리 7은 셋째 장의 첫 칸)
    JsonNode p1 = feed(e, "?limit=3");
    assertThat(ids(p1.get("items"))).containsExactly(fs.get(0), fs.get(1), gs.get(0));
    JsonNode p2 = feed(e, "?limit=3&cursor=" + p1.get("next").asText());
    assertThat(ids(p2.get("items"))).containsExactly(fs.get(2), fs.get(3), gs.get(1));
    JsonNode p3 = feed(e, "?limit=3&cursor=" + p2.get("next").asText());
    assertThat(ids(p3.get("items"))).containsExactly(gs.get(2), fs.get(4));
    assertThat(p3.get("next").isNull()).isTrue();

    // 같은 요청을 다시 해도 같다
    assertThat(ids(feed(e, "").get("items"))).isEqualTo(ids(all.get("items")));
  }
}
