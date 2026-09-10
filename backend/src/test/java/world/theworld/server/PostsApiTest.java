package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.auth.UserIdAuthFilter;
import world.theworld.server.post.PostLikeId;
import world.theworld.server.post.PostLikeRepository;
import world.theworld.server.post.PostRepository;
import world.theworld.server.post.PostService;

/**
 * 글·좋아요·글 격자 (CONTRACT §2.5, ADR-0021): 컷은 내 미디어만, 동행은 친구만, 작성자만 고치고 지운다, 좋아요는 멱등, 비공개 계정은 친구만.
 * 공개 글이 참조하는 컷은 누구나 받는다(PostMediaAccess).
 */
class PostsApiTest extends ApiTest {
  @Autowired PostLikeRepository likeRows;
  @Autowired PostRepository postRows;
  @Autowired PostService postService;

  /** 구운 컷 하나를 올리고 id를 돌려준다. */
  String upload(Session s) throws Exception {
    String id = MediaApiTest.newId();
    MvcResult r = mvc.perform(put("/api/media/" + id + "?kind=shot").header(UserIdAuthFilter.HEADER, s.userId()).contentType("image/webp")
      .content(MediaApiTest.webp(300))).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    return id;
  }

  static Map<String, Object> cut(String shotId, int win) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("shotId", shotId); m.put("actKey", "2026-09-11@Asia/Seoul:am"); m.put("win", win); m.put("by", "agent");
    return m;
  }

  static Map<String, Object> post(List<Map<String, Object>> cuts, List<String> companions) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cuts", cuts); m.put("caption", "오늘의 카페"); m.put("place", "카페 X"); m.put("area", "연남동"); m.put("city", "seoul");
    m.put("dateKey", "2026-09-11@Asia/Seoul"); m.put("companions", companions); m.put("editedByOwner", false);
    return m;
  }

  /** 글 하나를 올리고 응답 JSON. */
  JsonNode create(Session s, Map<String, Object> body) throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/posts", s, body).andReturn();
    assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
    return json(r);
  }

  JsonNode putAgentVis(Session s, String name, String visibility) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name); body.put("color", "#5FC9A6"); body.put("emoji", "🐥"); body.put("likes", List.of()); body.put("traits", List.of());
    body.put("home", home(126.92, 37.56)); body.put("visibility", visibility);
    MvcResult r = call(HttpMethod.PUT, "/api/me/agent", s, body).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    return json(r);
  }

  void befriend(Session a, Session b) throws Exception {
    assertThat(call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", b.userId())).andReturn().getResponse().getStatus()).isEqualTo(200);
  }

  MvcResult likeCall(Session s, String id, boolean on) throws Exception {
    return call(on ? HttpMethod.POST : HttpMethod.DELETE, "/api/posts/" + id + "/like", s, null).andReturn();
  }

  @Test
  void createOk() throws Exception {
    Session a = newUser();
    Session friend = newUser();
    Session stranger = newUser();
    befriend(a, friend);
    String s1 = upload(a);
    String s2 = upload(a);
    Map<String, Object> body = post(List.of(cut(s1, 0), cut(s2, 3)), List.of(friend.userId(), stranger.userId(), "nobody"));
    body.put("category", "meal");

    JsonNode p = create(a, body);
    assertThat(p.get("id").asText()).matches("^[0-9a-f]{32}$");
    assertThat(p.get("authorId").asText()).isEqualTo(a.userId());
    assertThat(p.get("createdAt").asLong()).isPositive();
    assertThat(p.get("cuts")).hasSize(2);
    assertThat(p.get("cuts").get(1).get("shotId").asText()).isEqualTo(s2);
    assertThat(p.get("cuts").get(1).get("win").asInt()).isEqualTo(3);
    assertThat(p.get("cuts").get(1).get("by").asText()).isEqualTo("agent");
    assertThat(p.get("caption").asText()).isEqualTo("오늘의 카페");
    assertThat(p.get("place").asText()).isEqualTo("카페 X");
    assertThat(p.get("category").asText()).isEqualTo("meal");
    assertThat(p.get("dateKey").asText()).isEqualTo("2026-09-11@Asia/Seoul");
    // 동행은 내 친구와의 교집합만 — 남·모르는 id는 조용히 빠진다
    assertThat(p.get("companions")).hasSize(1);
    assertThat(p.get("companions").get(0).asText()).isEqualTo(friend.userId());
    assertThat(p.get("editedByOwner").asBoolean()).isFalse();
    assertThat(p.get("likes").asLong()).isZero();
    assertThat(p.get("likedByMe").asBoolean()).isFalse();

    // category 없이 올리면 키가 빠진다; 본문의 authorId는 무시
    Map<String, Object> noCat = post(List.of(cut(s1, 1)), List.of());
    noCat.put("authorId", stranger.userId());
    JsonNode p2 = create(a, noCat);
    assertThat(p2.has("category")).isFalse();
    assertThat(p2.get("authorId").asText()).isEqualTo(a.userId());

    // 내 글 격자 — 최신순
    JsonNode mine = json(call(HttpMethod.GET, "/api/me/posts", a, null).andReturn());
    assertThat(mine.get("items")).hasSize(2);
    assertThat(mine.get("items").get(0).get("id").asText()).isEqualTo(p2.get("id").asText());
    assertThat(mine.get("next").isNull()).isTrue();
  }

  @Test
  void createValidation() throws Exception {
    Session a = newUser();
    Session b = newUser();
    String mine = upload(a);
    String theirs = upload(b);

    // 남의 컷 · 모르는 컷 · 모양 오류 — 전부 'cut not yours'
    MvcResult notMine = call(HttpMethod.POST, "/api/posts", a, post(List.of(cut(theirs, 0)), List.of())).andReturn();
    assertThat(notMine.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(notMine).get("error").asText()).isEqualTo("cut not yours");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, post(List.of(cut(MediaApiTest.newId(), 0)), List.of())).andReturn()).get("error").asText()).isEqualTo("cut not yours");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, post(List.of(cut("nope", 0)), List.of())).andReturn()).get("error").asText()).isEqualTo("cut not yours");

    // 11컷 · 0컷
    List<Map<String, Object>> eleven = new ArrayList<>();
    for (int i = 0; i < 11; i++) eleven.add(cut(mine, i % 4));
    MvcResult tooMany = call(HttpMethod.POST, "/api/posts", a, post(eleven, List.of())).andReturn();
    assertThat(tooMany.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(tooMany).get("error").asText()).isEqualTo("cuts must have 1-10 items");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, post(List.of(), List.of())).andReturn()).get("error").asText()).isEqualTo("cuts must have 1-10 items");

    // win · by
    Map<String, Object> badWin = cut(mine, 4);
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, post(List.of(badWin), List.of())).andReturn()).get("error").asText()).isEqualTo("cut.win must be 0-3");
    Map<String, Object> badBy = cut(mine, 0); badBy.put("by", "npc");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, post(List.of(badBy), List.of())).andReturn()).get("error").asText()).isEqualTo("cut.by must be user|agent");

    // 캡션 300자 초과 · place 없음 · 본문 없음
    Map<String, Object> longCap = post(List.of(cut(mine, 0)), List.of()); longCap.put("caption", "가".repeat(301));
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, longCap).andReturn()).get("error").asText()).isEqualTo("caption must be ≤ 300 chars");
    Map<String, Object> noPlace = post(List.of(cut(mine, 0)), List.of()); noPlace.remove("place");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, noPlace).andReturn()).get("error").asText()).isEqualTo("place must be 1-120 chars");
    assertThat(json(call(HttpMethod.POST, "/api/posts", a, null).andReturn()).get("error").asText()).isEqualTo("body required");

    // 정확히 10컷·300자는 된다
    List<Map<String, Object>> ten = new ArrayList<>(eleven.subList(0, 10));
    Map<String, Object> ok = post(ten, List.of()); ok.put("caption", "가".repeat(300));
    assertThat(create(a, ok).get("cuts")).hasSize(10);
  }

  @Test
  void patchAndDeleteAreAuthorOnly() throws Exception {
    Session a = newUser();
    Session b = newUser();
    String s1 = upload(a);
    String s2 = upload(a);
    String id = create(a, post(List.of(cut(s1, 0)), List.of())).get("id").asText();

    // 남이 고치면 403, 없는 글 404
    MvcResult other = call(HttpMethod.PATCH, "/api/posts/" + id, b, Map.of("caption", "훔침")).andReturn();
    assertThat(other.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(other).get("error").asText()).isEqualTo("not yours");
    assertThat(call(HttpMethod.PATCH, "/api/posts/" + MediaApiTest.newId(), a, Map.of("caption", "x")).andReturn().getResponse().getStatus()).isEqualTo(404);

    // 작성자 — 캡션만 고쳐도 editedByOwner
    MvcResult mine = call(HttpMethod.PATCH, "/api/posts/" + id, a, Map.of("caption", "고쳤다")).andReturn();
    assertThat(mine.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(mine).get("caption").asText()).isEqualTo("고쳤다");
    assertThat(json(mine).get("editedByOwner").asBoolean()).isTrue();
    assertThat(json(mine).get("cuts")).hasSize(1);

    // 컷 교체 — 역시 내 것만
    MvcResult cuts = call(HttpMethod.PATCH, "/api/posts/" + id, a, Map.of("cuts", List.of(cut(s2, 2), cut(s1, 1)))).andReturn();
    assertThat(cuts.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(cuts).get("cuts").get(0).get("shotId").asText()).isEqualTo(s2);
    assertThat(json(cuts).get("caption").asText()).isEqualTo("고쳤다");
    String theirs = upload(b);
    assertThat(json(call(HttpMethod.PATCH, "/api/posts/" + id, a, Map.of("cuts", List.of(cut(theirs, 0)))).andReturn()).get("error").asText()).isEqualTo("cut not yours");

    // 지우기 — 남 403, 작성자 204, 좋아요 행도 같이, 그 뒤 404
    befriend(a, b);
    assertThat(likeCall(b, id, true).getResponse().getStatus()).isEqualTo(200);
    assertThat(likeRows.existsById(new PostLikeId(id, b.userId()))).isTrue();
    assertThat(call(HttpMethod.DELETE, "/api/posts/" + id, b, null).andReturn().getResponse().getStatus()).isEqualTo(403);
    assertThat(call(HttpMethod.DELETE, "/api/posts/" + id, a, null).andReturn().getResponse().getStatus()).isEqualTo(204);
    assertThat(likeRows.existsById(new PostLikeId(id, b.userId()))).isFalse();
    assertThat(call(HttpMethod.DELETE, "/api/posts/" + id, a, null).andReturn().getResponse().getStatus()).isEqualTo(404);
    assertThat(likeCall(b, id, true).getResponse().getStatus()).isEqualTo(404);
    assertThat(json(call(HttpMethod.GET, "/api/me/posts", a, null).andReturn()).get("items")).isEmpty();
  }

  @Test
  void likeIsIdempotentWithCounter() throws Exception {
    Session a = newUser();
    Session b = newUser();
    Session c = newUser();
    putAgentVis(a, "에이", "public");
    String id = create(a, post(List.of(cut(upload(a), 0)), List.of())).get("id").asText();

    MvcResult first = likeCall(b, id, true);
    assertThat(first.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(first).get("likes").asLong()).isEqualTo(1);
    assertThat(json(first).get("likedByMe").asBoolean()).isTrue();
    // 두 번 눌러도 1
    assertThat(json(likeCall(b, id, true)).get("likes").asLong()).isEqualTo(1);
    assertThat(json(likeCall(c, id, true)).get("likes").asLong()).isEqualTo(2);
    // 글에도 카운터·내 표시가 실린다
    JsonNode asB = json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts", b, null).andReturn()).get("items").get(0);
    assertThat(asB.get("likes").asLong()).isEqualTo(2);
    assertThat(asB.get("likedByMe").asBoolean()).isTrue();
    JsonNode asA = json(call(HttpMethod.GET, "/api/me/posts", a, null).andReturn()).get("items").get(0);
    assertThat(asA.get("likedByMe").asBoolean()).isFalse();
    // 취소 — 두 번 해도 1, 0 아래로 안 내려간다
    MvcResult un = likeCall(b, id, false);
    assertThat(json(un).get("likes").asLong()).isEqualTo(1);
    assertThat(json(un).get("likedByMe").asBoolean()).isFalse();
    assertThat(json(likeCall(b, id, false)).get("likes").asLong()).isEqualTo(1);
    assertThat(json(likeCall(c, id, false)).get("likes").asLong()).isZero();
    assertThat(json(likeCall(c, id, false)).get("likes").asLong()).isZero();
  }

  @Test
  void privateAuthorIsFriendsOnly() throws Exception {
    Session owner = newUser();
    Session friend = newUser();
    Session stranger = newUser();
    putAgentVis(owner, "주인", "private");
    String shot = upload(owner);
    String id = create(owner, post(List.of(cut(shot, 0)), List.of())).get("id").asText();

    // 좋아요 — 남 403, 친구 200, 나 200
    MvcResult forbidden = likeCall(stranger, id, true);
    assertThat(forbidden.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(forbidden).get("error").asText()).isEqualTo("not allowed");
    assertThat(likeCall(friend, id, true).getResponse().getStatus()).isEqualTo(403);
    befriend(friend, owner);
    assertThat(likeCall(friend, id, true).getResponse().getStatus()).isEqualTo(200);
    assertThat(likeCall(owner, id, true).getResponse().getStatus()).isEqualTo(200);

    // 글 격자 — 남 403, 친구·나 200
    MvcResult grid = call(HttpMethod.GET, "/api/users/" + owner.userId() + "/posts", stranger, null).andReturn();
    assertThat(grid.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(grid).get("error").asText()).isEqualTo("not allowed");
    assertThat(json(call(HttpMethod.GET, "/api/users/" + owner.userId() + "/posts", friend, null).andReturn()).get("items")).hasSize(1);
    assertThat(json(call(HttpMethod.GET, "/api/users/" + owner.userId() + "/posts", owner, null).andReturn()).get("items")).hasSize(1);

    // 공개 글이 참조하는 컷 — 비공개일 땐 남이 못 받고, 공개로 바꾸면 받는다 (PostMediaAccess)
    assertThat(mvc.perform(get("/api/media/" + shot).header(UserIdAuthFilter.HEADER, stranger.userId())).andReturn().getResponse().getStatus()).isEqualTo(403);
    putAgentVis(owner, "주인", "public");
    assertThat(mvc.perform(get("/api/media/" + shot).header(UserIdAuthFilter.HEADER, stranger.userId())).andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(likeCall(stranger, id, true).getResponse().getStatus()).isEqualTo(200);
    assertThat(json(call(HttpMethod.GET, "/api/users/" + owner.userId() + "/posts", stranger, null).andReturn()).get("items")).hasSize(1);
    // 글에 안 실린 컷은 공개 계정이어도 여전히 소유자·친구만
    String unposted = upload(owner);
    assertThat(mvc.perform(get("/api/media/" + unposted).header(UserIdAuthFilter.HEADER, stranger.userId())).andReturn().getResponse().getStatus()).isEqualTo(403);
    // 프로필이 없는 사람은 비공개로 친다
    Session noProfile = newUser();
    String id2 = create(noProfile, post(List.of(cut(upload(noProfile), 0)), List.of())).get("id").asText();
    assertThat(likeCall(stranger, id2, true).getResponse().getStatus()).isEqualTo(403);
  }

  @Test
  void userPostsPaginate() throws Exception {
    Session a = newUser();
    putAgentVis(a, "에이", "public");
    Session viewer = newUser();
    String shot = upload(a);
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      Map<String, Object> b = post(List.of(cut(shot, 0)), List.of()); b.put("caption", "글 " + i);
      ids.add(create(a, b).get("id").asText());
    }
    JsonNode p1 = json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?limit=2", viewer, null).andReturn());
    assertThat(p1.get("items")).hasSize(2);
    assertThat(p1.get("items").get(0).get("caption").asText()).isEqualTo("글 2");   // 최신순
    assertThat(p1.get("items").get(1).get("caption").asText()).isEqualTo("글 1");
    assertThat(p1.get("next").isTextual()).isTrue();
    JsonNode p2 = json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?limit=2&cursor=" + p1.get("next").asText(), viewer, null).andReturn());
    assertThat(p2.get("items")).hasSize(1);
    assertThat(p2.get("items").get(0).get("caption").asText()).isEqualTo("글 0");
    assertThat(p2.get("next").isNull()).isTrue();
    // limit 상한 · 커서 모양
    assertThat(json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?limit=51", viewer, null).andReturn()).get("error").asText()).isEqualTo("limit must be 1-50");
    assertThat(json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?cursor=%3F%3F", viewer, null).andReturn()).get("error").asText()).isEqualTo("cursor invalid");
    // 피드 커서를 격자에 쓰면 400 — 추천 구간('r', viewer는 친구가 없다)과 친구 구간('f') 둘 다, /api/me/posts도
    String feedNext = json(call(HttpMethod.GET, "/api/feed?limit=1", viewer, null).andReturn()).get("next").asText();
    assertThat(feedNext).isNotEmpty();
    for (String c : List.of(feedNext, cursor("f:0"))) {
      MvcResult r = call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?cursor=" + c, viewer, null).andReturn();
      assertThat(r.getResponse().getStatus()).as(c).isEqualTo(400);
      assertThat(json(r).get("error").asText()).isEqualTo("cursor invalid");
      assertThat(json(call(HttpMethod.GET, "/api/me/posts?cursor=" + c, viewer, null).andReturn()).get("error").asText()).isEqualTo("cursor invalid");
    }
    // 모양은 맞지만 offset이 int를 넘는 커서 — 500이 아니라 400
    MvcResult huge = call(HttpMethod.GET, "/api/me/posts?cursor=" + cursor("u:99999999999"), viewer, null).andReturn();
    assertThat(huge.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(huge).get("error").asText()).isEqualTo("cursor invalid");
    assertThat(json(call(HttpMethod.GET, "/api/users/" + a.userId() + "/posts?cursor=" + cursor("u:2147483648"), viewer, null).andReturn()).get("error").asText()).isEqualTo("cursor invalid");
    // 딱 int 최댓값은 모양으로는 통과한다(빈 장)
    assertThat(json(call(HttpMethod.GET, "/api/me/posts?cursor=" + cursor("u:2147483647"), viewer, null).andReturn()).get("items")).isEmpty();
  }

  /** 서버가 주는 것과 같은 모양의 커서를 손으로 — 클라이언트는 이렇게 만들면 안 되지만 테스트는 경계를 찔러야 한다. */
  static String cursor(String raw) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /**
   * 동시 취소 — 같은 사람이 두 탭에서 동시에 취소해도 카운터는 한 번만 내려가고 어느 쪽도 500이 아니다. 좋아요 행의 삭제가 지운 행 수를 돌려주고
   * 그만큼만 bumpLikes 하므로(PostLikeRepository.deleteOne) 인터리빙과 무관하게 결과가 같다.
   */
  @Test
  void concurrentUnlikeDecrementsOnce() throws Exception {
    Session a = newUser();
    Session b = newUser();
    putAgentVis(a, "에이", "public");
    String id = create(a, post(List.of(cut(upload(a), 0)), List.of())).get("id").asText();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int round = 0; round < 10; round++) {
        assertThat(json(likeCall(b, id, true)).get("likes").asLong()).isEqualTo(1);
        CyclicBarrier go = new CyclicBarrier(2);
        List<Future<Throwable>> results = new ArrayList<>();
        for (int t = 0; t < 2; t++) {
          results.add(pool.submit(() -> {
            try { go.await(); postService.like(b.userId(), id, false); return null; } catch (Throwable e) { return e; }
          }));
        }
        for (Future<Throwable> f : results) assertThat(f.get(10, TimeUnit.SECONDS)).as("round " + round).isNull();
        assertThat(postRows.findById(id).orElseThrow().getLikes()).as("round " + round).isZero();
        assertThat(likeRows.existsById(new PostLikeId(id, b.userId()))).isFalse();
      }
    } finally {
      pool.shutdownNow();
    }
  }
}
