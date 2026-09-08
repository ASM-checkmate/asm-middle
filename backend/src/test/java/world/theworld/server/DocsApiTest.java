package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;

/** 문서 동기화 버전 규칙 (BACKEND-CONTRACT §2.2). */
class DocsApiTest extends ApiTest {
  private MvcResult put(Session s, String name, long base, long clientTs, Object body, Boolean force) throws Exception {
    Map<String, Object> req = new java.util.LinkedHashMap<>();
    req.put("baseVersion", base); req.put("clientTs", clientTs); req.put("body", body);
    if (force != null) req.put("force", force);
    return call(HttpMethod.PUT, "/api/me/docs/" + name, s, req).andReturn();
  }

  @Test
  void createUpdateConflictForce() throws Exception {
    Session s = newUser();
    JsonNode empty = json(call(HttpMethod.GET, "/api/me/docs", s, null).andReturn());
    assertThat(empty.get("docs").size()).isZero();

    Map<String, Object> v1 = Map.of("v", 5, "days", Map.of(), "anchor", Map.of("placeId", "home", "t", 1000));
    MvcResult c = put(s, "world", 0, 1000, v1, null);
    assertThat(c.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(c).get("name").asText()).isEqualTo("world");
    assertThat(json(c).get("version").asLong()).isEqualTo(1);
    assertThat(json(c).get("updatedAt").asLong()).isPositive();

    JsonNode got = json(call(HttpMethod.GET, "/api/me/docs/world", s, null).andReturn());
    assertThat(got.get("version").asLong()).isEqualTo(1);
    assertThat(got.get("clientTs").asLong()).isEqualTo(1000);
    assertThat(got.get("body")).isEqualTo(om.valueToTree(v1));

    JsonNode list = json(call(HttpMethod.GET, "/api/me/docs", s, null).andReturn());
    assertThat(list.get("docs").get("world").get("version").asLong()).isEqualTo(1);
    assertThat(list.get("docs").get("world").get("clientTs").asLong()).isEqualTo(1000);
    assertThat(list.get("docs").has("memory")).isFalse();

    // 갱신: baseVersion == 현재
    MvcResult u = put(s, "world", 1, 2000, Map.of("v", 5, "n", 2), null);
    assertThat(u.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(u).get("version").asLong()).isEqualTo(2);

    // 충돌: 옛 baseVersion — 서버본을 그대로 돌려준다
    MvcResult k = put(s, "world", 1, 3000, Map.of("v", 5, "n", 3), null);
    assertThat(k.getResponse().getStatus()).isEqualTo(409);
    JsonNode conflict = json(k);
    assertThat(conflict.get("error").asText()).isEqualTo("conflict");
    assertThat(conflict.get("name").asText()).isEqualTo("world");
    assertThat(conflict.get("version").asLong()).isEqualTo(2);
    assertThat(conflict.get("clientTs").asLong()).isEqualTo(2000);
    assertThat(conflict.get("updatedAt").asLong()).isPositive();
    assertThat(conflict.get("body").get("n").asInt()).isEqualTo(2);

    // force: baseVersion 무시하고 덮어쓴다
    MvcResult f = put(s, "world", 0, 4000, Map.of("v", 5, "n", 4), true);
    assertThat(f.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(f).get("version").asLong()).isEqualTo(3);
    assertThat(json(call(HttpMethod.GET, "/api/me/docs/world", s, null).andReturn()).get("body").get("n").asInt()).isEqualTo(4);
  }

  @Test
  void missingDocNeedsBaseVersionZero() throws Exception {
    Session s = newUser();
    MvcResult k = put(s, "memory", 3, 1, Map.of("name", "모모"), null);
    assertThat(k.getResponse().getStatus()).isEqualTo(409);
    assertThat(json(k).get("error").asText()).isEqualTo("conflict");
    assertThat(json(k).get("version").asLong()).isZero();
    assertThat(json(k).get("body").isNull()).isTrue();
    // force면 만든다
    assertThat(put(s, "memory", 3, 1, Map.of("name", "모모"), true).getResponse().getStatus()).isEqualTo(200);
  }

  @Test
  void docsAreScopedPerUser() throws Exception {
    Session a = newUser();
    Session b = newUser();
    assertThat(put(a, "book", 0, 1, java.util.List.of(1, 2), null).getResponse().getStatus()).isEqualTo(200);
    assertThat(call(HttpMethod.GET, "/api/me/docs/book", b, null).andReturn().getResponse().getStatus()).isEqualTo(404);
  }

  @Test
  void unknownNameIs404() throws Exception {
    Session s = newUser();
    MvcResult g = call(HttpMethod.GET, "/api/me/docs/secret", s, null).andReturn();
    assertThat(g.getResponse().getStatus()).isEqualTo(404);
    assertThat(json(g).get("error").asText()).isEqualTo("not found");
    assertThat(put(s, "secret", 0, 1, Map.of(), null).getResponse().getStatus()).isEqualTo(404);
    assertThat(call(HttpMethod.GET, "/api/me/docs/world", s, null).andReturn().getResponse().getStatus()).isEqualTo(404);
  }

  @Test
  void bodyRequiredAndTooLarge() throws Exception {
    Session s = newUser();
    MvcResult nb = call(HttpMethod.PUT, "/api/me/docs/places", s, Map.of("baseVersion", 0, "clientTs", 1)).andReturn();
    assertThat(nb.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(nb).get("error").asText()).isEqualTo("body required");

    String huge = "{\"baseVersion\":0,\"clientTs\":1,\"body\":\"" + "a".repeat(4 * 1024 * 1024 + 10) + "\"}";
    MvcResult big = call(HttpMethod.PUT, "/api/me/docs/places", s, huge).andReturn();
    assertThat(big.getResponse().getStatus()).isEqualTo(413);
    assertThat(json(big).get("error").asText()).isEqualTo("body too large");

    // 문서 경로는 256 KB보다 큰 본문도 받는다 (4 MB까지)
    String medium = "{\"baseVersion\":0,\"clientTs\":1,\"body\":\"" + "b".repeat(600 * 1024) + "\"}";
    assertThat(call(HttpMethod.PUT, "/api/me/docs/places", s, medium).andReturn().getResponse().getStatus()).isEqualTo(200);
  }
}
