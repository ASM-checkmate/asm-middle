package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.ApiTest;

/**
 * POST /api/plan/options의 계약면 (docs/CONTRACT.md): 인증 401, 검증 400 문자열, Ollama 없음 502.
 * test 프로필은 Ollama를 닫힌 포트로 둔다 — 모델은 부르지 않는다.
 */
class PlanApiTest extends ApiTest {
  private static final String PATH = "/api/plan/options";

  private void expect(Session s, String body, int status, String error) throws Exception {
    MvcResult r = call(HttpMethod.POST, PATH, s, body).andReturn();
    assertThat(r.getResponse().getStatus()).as(body).isEqualTo(status);
    if (error != null) assertThat(json(r).get("error").asText()).isEqualTo(error);
  }

  @Test
  void needsUserId() throws Exception {
    expect(null, PlanFixtures.planJson(), 401, "unauthorized");
  }

  @Test
  void validation() throws Exception {
    Session s = newUser();
    expect(s, "[1]", 400, "body must be an object");
    expect(s, "{}", 400, "tier must be small|good");
    expect(s, "{\"tier\":\"small\"}", 400, "agent.name required");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", 400, "day.dateKey/weekday required");
    expect(s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\",\"weekday\":\"화요일\"}}", 400, "city.key/nameKo required");
    String head = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\",\"weekday\":\"화요일\"},\"city\":{\"key\":\"seoul\",\"nameKo\":\"서울\"}";
    expect(s, head + ",\"places\":[]}", 400, "places must be a non-empty array");
    expect(s, head + ",\"places\":[{\"id\":\"home\",\"name\":\"우리 집\",\"type\":\"home\"}],\"blocks\":[{\"id\":\"sleep\"}]}", 400, "blocks must have 1-6 known block ids");
    MvcResult broken = call(HttpMethod.POST, PATH, s, "{not json").andReturn();
    assertThat(broken.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(broken).get("error").asText()).startsWith("bad json: ");
  }

  @Test
  void withoutOllamaIs502() throws Exception {
    Session s = newUser();
    MvcResult r = call(HttpMethod.POST, PATH, s, PlanFixtures.planJson()).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(502);
    assertThat(json(r).get("error").asText()).startsWith("ollama: ");
  }
}
