package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.AuthService;

/** 인증 필터·고정 아이디 로그인·오류 모양 (BACKEND-CONTRACT §0·§2.1, 2026-09-08 오후 개정). */
class AuthApiTest extends ApiTest {
  static final List<String> SEEDED = List.of("guest1", "guest2", "guest3", "hojun", "yoongwan");

  @Test
  void healthIsPublic() throws Exception {
    MvcResult r = call(HttpMethod.GET, "/api/health", null, null).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(r).get("ok").asBoolean()).isTrue();
  }

  @Test
  void usersListsSeededIdsInOrder() throws Exception {
    MvcResult r = call(HttpMethod.GET, "/api/users", null, null).andReturn();   // 공개
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    JsonNode users = json(r).get("users");
    List<String> ids = new ArrayList<>();
    users.forEach(u -> { ids.add(u.get("id").asText()); assertThat(u.get("name").asText()).isNotEmpty(); assertThat(u.has("createdAt")).isFalse(); });
    assertThat(ids).isSorted();   // id 순 — 다른 테스트가 넣은 사용자도 섞여 있다
    assertThat(ids).containsAll(SEEDED);
    Map<String, String> names = new java.util.HashMap<>();
    users.forEach(u -> names.put(u.get("id").asText(), u.get("name").asText()));
    assertThat(names).containsEntry("yoongwan", "윤관").containsEntry("hojun", "호준").containsEntry("guest1", "손님1");
  }

  @Test
  void loginKnownUnknownMalformed() throws Exception {
    MvcResult ok = call(HttpMethod.POST, "/api/auth/login", null, Map.of("userId", "yoongwan")).andReturn();
    assertThat(ok.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(ok).get("userId").asText()).isEqualTo("yoongwan");
    assertThat(json(ok).get("name").asText()).isEqualTo("윤관");
    assertThat(json(ok).size()).isEqualTo(2);   // 토큰 같은 건 없다

    MvcResult nope = call(HttpMethod.POST, "/api/auth/login", null, Map.of("userId", "nope")).andReturn();
    assertThat(nope.getResponse().getStatus()).isEqualTo(404);
    assertThat(json(nope).get("error").asText()).isEqualTo("user not found");

    MvcResult missing = call(HttpMethod.POST, "/api/auth/login", null, Map.of()).andReturn();
    assertThat(missing.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(missing).get("error").asText()).isEqualTo("userId required");
    assertThat(call(HttpMethod.POST, "/api/auth/login", null, null).andReturn().getResponse().getStatus()).isEqualTo(400);
    MvcResult shape = call(HttpMethod.POST, "/api/auth/login", null, Map.of("userId", "Yoon Gwan!")).andReturn();
    assertThat(shape.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(shape).get("error").asText()).startsWith("userId must match");
    assertThat(call(HttpMethod.POST, "/api/auth/login", null, Map.of("userId", "x".repeat(25))).andReturn().getResponse().getStatus()).isEqualTo(400);
  }

  @Test
  void meNeedsKnownUserId() throws Exception {
    MvcResult me = call(HttpMethod.GET, "/api/me", new Session("hojun"), null).andReturn();
    assertThat(me.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(me).get("userId").asText()).isEqualTo("hojun");
    assertThat(json(me).get("name").asText()).isEqualTo("호준");
    assertThat(json(me).get("createdAt").asLong()).isPositive();

    // 헤더 없음 · 모르는 아이디 · 모양 틀린 아이디 — 전부 401 {error:'unauthorized'}, JSON
    MvcResult none = call(HttpMethod.GET, "/api/me", null, null).andReturn();
    assertThat(none.getResponse().getStatus()).isEqualTo(401);
    assertThat(json(none).get("error").asText()).isEqualTo("unauthorized");
    assertThat(none.getResponse().getContentType()).startsWith("application/json");
    assertThat(call(HttpMethod.GET, "/api/me", new Session("nobody"), null).andReturn().getResponse().getStatus()).isEqualTo(401);
    assertThat(call(HttpMethod.GET, "/api/me", new Session("Not An Id"), null).andReturn().getResponse().getStatus()).isEqualTo(401);
    assertThat(call(HttpMethod.GET, "/api/me", new Session(""), null).andReturn().getResponse().getStatus()).isEqualTo(401);
    // 문서 경로도 같은 필터
    assertThat(call(HttpMethod.GET, "/api/me/docs", null, null).andReturn().getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void lastSeenIsUpdatedAtMostOncePerMinute() throws Exception {
    Session s = newUser();
    long before = users.findById(s.userId()).orElseThrow().getLastSeenAt();
    // 방금 만든 사용자 — 1분이 안 지났으니 요청이 와도 그대로
    call(HttpMethod.GET, "/api/me", s, null).andReturn();
    assertThat(users.findById(s.userId()).orElseThrow().getLastSeenAt()).isEqualTo(before);
    // 오래전에 본 사용자 — 첫 요청에서 갱신
    String old = s.userId() + "o";
    users.save(new AppUser(old, "옛날", System.currentTimeMillis() - 2 * AuthService.TOUCH_INTERVAL_MS));
    long stale = users.findById(old).orElseThrow().getLastSeenAt();
    assertThat(call(HttpMethod.GET, "/api/me", new Session(old), null).andReturn().getResponse().getStatus()).isEqualTo(200);
    long seen = users.findById(old).orElseThrow().getLastSeenAt();
    assertThat(seen).isGreaterThan(stale);
    // 바로 다음 요청은 다시 쓰지 않는다
    call(HttpMethod.GET, "/api/me", new Session(old), null).andReturn();
    assertThat(users.findById(old).orElseThrow().getLastSeenAt()).isEqualTo(seen);
  }

  @Test
  void brokenJsonIs400() throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/auth/login", null, "{not json").andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(r).get("error").asText()).startsWith("bad json: ");
  }

  @Test
  void unknownPathAndMethod() throws Exception {
    Session s = newUser();
    MvcResult nf = call(HttpMethod.GET, "/api/nope", s, null).andReturn();
    assertThat(nf.getResponse().getStatus()).isEqualTo(404);
    assertThat(json(nf).get("error").asText()).isEqualTo("not found");
    MvcResult mna = call(HttpMethod.DELETE, "/api/me", s, null).andReturn();
    assertThat(mna.getResponse().getStatus()).isEqualTo(405);
    assertThat(json(mna).get("error").asText()).isEqualTo("method not allowed");
    // 옛 기기 인증 경로는 사라졌다
    assertThat(call(HttpMethod.POST, "/api/auth/device", s, Map.of("deviceId", "my-device-0001")).andReturn().getResponse().getStatus()).isEqualTo(404);
  }

  @Test
  void corsPreflightAllowsUserIdHeader() throws Exception {
    MvcResult r = mvc.perform(options("/api/me").header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", "GET")
      .header("Access-Control-Request-Headers", "x-user-id,content-type")).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    assertThat(r.getResponse().getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:5173");
    assertThat(r.getResponse().getHeader("Access-Control-Allow-Headers").toLowerCase()).contains("x-user-id");
    // authorization은 더는 허용 헤더가 아니다
    MvcResult old = mvc.perform(options("/api/me").header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", "GET")
      .header("Access-Control-Request-Headers", "authorization")).andReturn();
    assertThat(old.getResponse().getStatus()).isEqualTo(403);
  }

  @Test
  void bodyLimitOnGenericApiIs256Kb() throws Exception {
    String big = "{\"userId\":\"" + "x".repeat(300 * 1024) + "\"}";
    MvcResult r = call(HttpMethod.POST, "/api/auth/login", null, big).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(413);
    assertThat(json(r).get("error").asText()).isEqualTo("body too large");
  }
}
