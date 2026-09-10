package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.ApiTest;

/** POST /api/character/look 계약면: 인증 401, 검증 400 문자열, Ollama 없음 502, 본문 상한 1.5 MB. test 프로필은 Ollama를 닫힌 포트로 둔다. */
class LookApiTest extends ApiTest {
  private static final String OK = "{\"tier\":\"good\",\"photo\":\"data:image/jpeg;base64,AAAA\"}";

  private void expect(Session s, String body, int status, String error) throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/character/look", s, body).andReturn();
    assertThat(r.getResponse().getStatus()).as(body.length() > 80 ? body.substring(0, 80) : body).isEqualTo(status);
    if (error != null) assertThat(json(r).get("error").asText()).isEqualTo(error);
  }

  @Test
  void needsUserId() throws Exception {
    expect(null, OK, 401, "unauthorized");
  }

  @Test
  void validation() throws Exception {
    Session s = newUser();
    expect(s, "{}", 400, "tier must be small|good");
    expect(s, "{\"tier\":\"good\"}", 400, "photo must be an image dataURL");
    expect(s, "{\"tier\":\"good\",\"photo\":\"data:image/gif;base64,AAAA\"}", 400, "photo must be an image dataURL");
  }

  @Test
  void withoutOllamaIs502() throws Exception {
    Session s = newUser();
    MvcResult r = call(HttpMethod.POST, "/api/character/look", s, OK).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(502);
    assertThat(json(r).get("error").asText()).startsWith("ollama: ");
  }

  @Test
  void bodyLimitIs1536Kb() throws Exception {
    Session s = newUser();
    // 1 MB는 통과(→ 502, 모델이 없으니), 1.6 MB는 413
    String fits = "{\"tier\":\"good\",\"photo\":\"data:image/jpeg;base64," + "A".repeat(1024 * 1024) + "\"}";
    expect(s, fits, 502, null);
    String big = "{\"tier\":\"good\",\"photo\":\"data:image/jpeg;base64," + "A".repeat(1600 * 1024) + "\"}";
    expect(s, big, 413, "body too large");
  }
}
