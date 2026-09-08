package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.ApiTest;

/**
 * LLM 엔드포인트의 계약면 (docs/CONTRACT.md·BACKEND-CONTRACT §2.4): 공개 경로, 검증 400 문자열, 인증 401, Ollama 없음 502, 검색 키 없음 503.
 * test 프로필은 Ollama·Nominatim을 닫힌 포트로, 검색 키를 비워 둔다 — 모델은 부르지 않는다.
 */
class LlmApiTest extends ApiTest {
  private static final String REPLY_OK = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\",\"traits\":[],\"likes\":[],\"dislikes\":[]},"
    + "\"situation\":{\"where\":\"집\",\"doing\":\"자는 중\",\"hhmm\":\"02:00\",\"lateWhy\":null,\"mood\":50,\"fatigue\":50,\"worry\":null},\"recent\":[],\"texts\":[\"야\"]}";
  private static final String SKETCH_OK = "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64,AAAA\",\"category\":\"play\",\"options\":[{\"id\":\"a\",\"title\":\"커피\",\"placeName\":\"카페\",\"placeType\":\"cafe\"}]}";

  private void expect(String path, Session s, String body, int status, String error) throws Exception {
    MvcResult r = call(HttpMethod.POST, path, s, body).andReturn();
    assertThat(r.getResponse().getStatus()).as(path + " " + body).isEqualTo(status);
    if (error != null) assertThat(json(r).get("error").asText()).isEqualTo(error);
  }

  @Test
  void modelsIsPublicAndReportsOllamaDown() throws Exception {
    MvcResult r = call(HttpMethod.GET, "/api/models", null, null).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    JsonNode j = json(r);
    assertThat(j.get("ollama").asBoolean()).isFalse();
    assertThat(j.get("tiers").get("small").get("model").asText()).isEqualTo("qwen3.5:9b");
    assertThat(j.get("tiers").get("small").get("installed").asBoolean()).isFalse();
    assertThat(j.get("tiers").get("good").get("model").asText()).isEqualTo("qwen3.8:27b");
    assertThat(j.get("tiers").get("good").get("installed").asBoolean()).isFalse();
  }

  @Test
  void llmPathsNeedUserId() throws Exception {
    expect("/api/chat/reply", null, REPLY_OK, 401, "unauthorized");
    expect("/api/sketch/read", null, SKETCH_OK, 401, "unauthorized");
    expect("/api/trip/plan", null, "{\"tier\":\"small\",\"city\":\"교토\"}", 401, "unauthorized");
  }

  @Test
  void replyValidation() throws Exception {
    Session s = newUser();
    expect("/api/chat/reply", s, "{}", 400, "tier must be small|good");
    expect("/api/chat/reply", s, "{\"tier\":\"small\"}", 400, "agent.name required");
    expect("/api/chat/reply", s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", 400, "situation.where/doing/hhmm required");
    expect("/api/chat/reply", s, "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\"},\"texts\":[]}", 400, "texts must be a non-empty string[]");
    expect("/api/chat/reply", s, "[1]", 400, "body must be an object");
    MvcResult broken = call(HttpMethod.POST, "/api/chat/reply", s, "{not json").andReturn();
    assertThat(broken.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(broken).get("error").asText()).startsWith("bad json: ");
  }

  @Test
  void replyWithoutOllamaIs502() throws Exception {
    Session s = newUser();
    MvcResult r = call(HttpMethod.POST, "/api/chat/reply", s, REPLY_OK).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(502);
    assertThat(json(r).get("error").asText()).startsWith("ollama: ");
    MvcResult batched = call(HttpMethod.POST, "/api/chat/reply", s, REPLY_OK.replace("\"tier\"", "\"batch\":\"b1\",\"tier\"")).andReturn();
    assertThat(batched.getResponse().getStatus()).isEqualTo(502);
  }

  @Test
  void sketchValidation() throws Exception {
    Session s = newUser();
    expect("/api/sketch/read", s, "{\"tier\":\"x\"}", 400, "tier must be small|good");
    expect("/api/sketch/read", s, "{\"tier\":\"good\",\"sketch\":\"data:image/gif;base64,AAAA\"}", 400, "sketch must be an image dataURL");
    expect("/api/sketch/read", s, "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64,AA A\"}", 400, "sketch must be an image dataURL");
    expect("/api/sketch/read", s, "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64,AAAA\"}", 400, "category required");
    expect("/api/sketch/read", s, "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64,AAAA\",\"category\":\"play\",\"options\":[]}", 400, "options must have 1-8 items");
    expect("/api/sketch/read", s, "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64,AAAA\",\"category\":\"play\",\"options\":[{\"id\":\"a\"}]}", 400, "option.id/title required");
    expect("/api/sketch/read", s, SKETCH_OK, 502, null);
  }

  @Test
  void sketchBodyLimitIs512Kb() throws Exception {
    Session s = newUser();
    String big = "{\"tier\":\"good\",\"sketch\":\"data:image/png;base64," + "A".repeat(600 * 1024) + "\",\"category\":\"play\",\"options\":[{\"id\":\"a\",\"title\":\"t\"}]}";
    expect("/api/sketch/read", s, big, 413, "body too large");
  }

  @Test
  void tripValidationAndNoKey() throws Exception {
    Session s = newUser();
    expect("/api/trip/plan", s, "{\"city\":\"교토\"}", 400, "tier must be small|good");
    expect("/api/trip/plan", s, "{\"tier\":\"small\",\"city\":\"   \"}", 400, "city must be 1-40 chars");
    expect("/api/trip/plan", s, "{\"tier\":\"small\",\"city\":\"" + "가".repeat(41) + "\"}", 400, "city must be 1-40 chars");
    expect("/api/trip/plan", s, "{\"tier\":\"small\",\"city\":\"교토\"}", 503, "OLLAMA_API_KEY not set — web search unavailable");
  }
}
