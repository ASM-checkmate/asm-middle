package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.ApiTest;

/**
 * POST /api/call/turn의 계약면 (docs/CONTRACT.md): 인증 401, 검증 400(보통의 JSON — 첫 바이트 전에 끝난다), Ollama 없음은 200 ndjson에 error 한 줄.
 * test 프로필은 Ollama를 닫힌 포트로 둔다 — 모델은 부르지 않는다. 문장이 흐르는 쪽은 {@link CallStreamApiTest}.
 */
class CallApiTest extends ApiTest {
  private static final String SIT = "\"situation\":{\"where\":\"집\",\"doing\":\"자는 중\",\"hhmm\":\"02:00\"}";

  private void expect(Session s, String body, int status, String error) throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/call/turn", s, body).andReturn();
    assertThat(r.getResponse().getStatus()).as(body).isEqualTo(status);
    assertThat(r.getResponse().getContentType()).as(body).startsWith("application/json");
    if (error != null) assertThat(json(r).get("error").asText()).isEqualTo(error);
  }

  @Test
  void needsUserId() throws Exception {
    expect(null, CallFixtures.REQ_JSON, 401, "unauthorized");
  }

  @Test
  void validationIsPlainJson400() throws Exception {
    Session s = newUser();
    expect(s, "[1]", 400, "body must be an object");
    expect(s, "{}", 400, "tier must be small|good");
    expect(s, "{\"tier\":\"small\"}", 400, "agent.name required");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", 400, "situation.where/doing/hhmm required");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + "}", 400, "why must be worry|ask|friction|out");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"ask\"}", 400, "user must be string|null");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"ask\",\"user\":7}", 400, "user must be string|null");
    MvcResult broken = call(HttpMethod.POST, "/api/call/turn", s, "{not json").andReturn();
    assertThat(broken.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(broken).get("error").asText()).startsWith("bad json: ");
    MvcResult empty = call(HttpMethod.POST, "/api/call/turn", s, null).andReturn();
    assertThat(empty.getResponse().getStatus()).isEqualTo(400);
  }

  /** 헤더가 먼저 나가므로 Ollama가 없어도 200 — 본문이 {"error":…} 한 줄로 끝난다. 프론트는 통화를 이어 간다. */
  @Test
  void withoutOllamaStreamsOneErrorLine() throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/call/turn", newUser(), CallFixtures.REQ_JSON).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    assertThat(r.getResponse().getContentType()).startsWith("application/x-ndjson");
    assertThat(r.getResponse().getContentType().toLowerCase()).contains("charset=utf-8");
    assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("no-cache");
    String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertThat(body).endsWith("\n");
    String[] lines = body.split("\n");
    assertThat(lines).hasSize(1);
    JsonNode j = om.readTree(lines[0]);
    assertThat(j.get("error").asText()).startsWith("ollama: ");
    assertThat(j.has("s")).isFalse();
    assertThat(j.has("done")).isFalse();
  }
}
