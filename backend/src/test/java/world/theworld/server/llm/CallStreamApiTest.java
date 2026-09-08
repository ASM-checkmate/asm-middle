package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import world.theworld.server.ApiTest;

/**
 * 통화 스트림의 끝에서 끝 (call.test.mjs '스트리밍'을 HTTP까지) — 가짜 Ollama(로컬 HttpServer)가 토큰을 줄 경계와 무관하게 조각조각 흘리고,
 * MockMvc가 컨트롤러가 동기로 쓴 ndjson 본문을 그대로 본다. test 프로필의 Ollama 주소(닫힌 포트)를 이 클래스만 가짜 서버로 바꾼다.
 */
class CallStreamApiTest extends ApiTest {
  private static HttpServer ollama;
  private static final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
  /** 가짜 Ollama가 /api/chat에 흘릴 본문 — 검사마다 바꾼다. */
  private static volatile String stream = "";

  @DynamicPropertySource
  static void fakeOllama(DynamicPropertyRegistry reg) throws IOException {
    ollama = LlmFixtures.server();
    ollama.createContext("/api/chat", ex -> {
      bodies.add(LlmFixtures.OM.readTree(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      ex.getResponseHeaders().add("content-type", "application/x-ndjson");
      ex.sendResponseHeaders(200, 0);
      try (var out = ex.getResponseBody()) {
        String body = stream;
        int[] cuts = { 0, 40, 95, body.length() };
        for (int i = 1; i < cuts.length; i++) {
          int a = Math.min(cuts[i - 1], body.length());
          int b = Math.min(cuts[i], body.length());
          if (a >= b) continue;
          out.write(body.substring(a, b).getBytes(StandardCharsets.UTF_8));
          out.flush();
        }
      } catch (IOException ignored) { /* 클라이언트가 끊었다 */ }
    });
    reg.add("theworld.ollama.url", () -> LlmFixtures.url(ollama));
  }

  @AfterAll
  static void down() { ollama.stop(0); }

  @BeforeEach
  void reset() { bodies.clear(); }

  private String[] turn(String reqJson) throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/call/turn", newUser(), reqJson).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    assertThat(r.getResponse().getContentType()).startsWith("application/x-ndjson");
    String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertThat(body).endsWith("\n");
    return body.split("\n");
  }

  @Test
  void sentencesFlowOnePerLineThenDone() throws Exception {
    stream = CallFixtures.ndjson(CallFixtures.TOKENS);
    String[] lines = turn(CallFixtures.REQ_JSON);
    assertThat(lines).hasSize(4);
    assertThat(lines[0]).isEqualTo("{\"s\":\"어… 그랬구나.\"}");
    assertThat(lines[1]).isEqualTo("{\"s\":\"많이 힘들었겠다!\"}");
    assertThat(lines[2]).isEqualTo("{\"s\":\"오늘은 내가 조용한 데로 잡아 놨어\"}");
    JsonNode done = om.readTree(lines[3]);
    assertThat(done.get("done").asBoolean()).isTrue();
    assertThat(done.get("model").asText()).isEqualTo("qwen3.5:9b");
    assertThat(done.get("ms").asLong()).isGreaterThanOrEqualTo(0);
    assertThat(done.fieldNames()).toIterable().containsExactly("done", "model", "ms");
    // Ollama에는 스트리밍으로, 짧게, 형식 없이, 통화 프롬프트 그대로 (call.test.mjs:70, ollama.ts)
    assertThat(bodies).hasSize(1);
    JsonNode b = bodies.get(0);
    assertThat(b.get("model").asText()).isEqualTo("qwen3.5:9b");
    assertThat(b.get("stream").asBoolean()).isTrue();
    assertThat(b.get("think").asBoolean()).isFalse();
    assertThat(b.has("format")).isFalse();
    assertThat(b.get("options").get("num_predict").asInt()).isLessThanOrEqualTo(120);
    assertThat(b.get("options").get("temperature").asDouble()).isEqualTo(0.8);
    assertThat(b.get("messages").get(0).get("content").asText()).isEqualTo(LlmFixtures.golden("call-system"));
    assertThat(b.get("messages").get(1).get("content").asText()).isEqualTo(LlmFixtures.golden("call-user"));
  }

  @Test
  void goodTierAndFirstTurn() throws Exception {
    stream = CallFixtures.ndjson(List.of("여보세요, ", "나야. ", "뭐 해?"));
    String[] lines = turn(CallFixtures.REQ_JSON.replace("\"tier\":\"small\"", "\"tier\":\"good\"").replace("\"user\":\"아 그냥 팀 사람들이 좀 그래\"", "\"user\":null"));
    assertThat(lines).containsExactly("{\"s\":\"여보세요, 나야.\"}", "{\"s\":\"뭐 해?\"}", lines[2]);
    assertThat(om.readTree(lines[2]).get("model").asText()).isEqualTo("qwen3.8:27b");
    assertThat(bodies.get(0).get("messages").get(1).get("content").asText()).endsWith(LlmFixtures.golden("call-user-first"));
  }

  /** Ollama의 error 줄은 스트림 안의 {"error":…} 한 줄로 끝난다 — 그 전에 완성된 문장은 이미 나갔다. done은 없다. */
  @Test
  void ollamaErrorEndsTheStreamWithAnErrorLine() throws Exception {
    stream = "{\"error\":\"model 'qwen3.5:9b' not found\"}\n";
    String[] lines = turn(CallFixtures.REQ_JSON);
    assertThat(lines).containsExactly("{\"error\":\"ollama: model 'qwen3.5:9b' not found\"}");

    stream = "{\"message\":{\"content\":\"여보세요. 나\"},\"done\":false}\n{\"error\":\"boom\"}\n";
    lines = turn(CallFixtures.REQ_JSON);
    assertThat(lines).containsExactly("{\"s\":\"여보세요.\"}", "{\"error\":\"ollama: boom\"}");
  }
}
