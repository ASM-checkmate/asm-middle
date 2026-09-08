package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Ollama 요청 본문 검사 (BACKEND-CONTRACT §2.4 "Ollama 호출 모양", trip.test.mjs 'chatJson 옵션'). 실제 Ollama는 부르지 않는다 — 로컬 HttpServer가 받는다.
 */
class OllamaClientTest {
  private HttpServer server;
  private final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
  private volatile String reply = "{\"message\":{\"content\":\"{}\"}}";
  private volatile int status = 200;
  private volatile long delayMs = 0;

  @BeforeEach
  void up() throws Exception {
    server = LlmFixtures.server();
    server.createContext("/api/chat", ex -> {
      bodies.add(LlmFixtures.OM.readTree(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      if (delayMs > 0) { try { Thread.sleep(delayMs); } catch (InterruptedException ignored) { } }
      LlmFixtures.respond(ex, status, reply);
    });
    server.createContext("/api/tags", ex -> LlmFixtures.respond(ex, 200, "{\"models\":[{\"name\":\"qwen3.5:9b\"},{\"name\":\"llava:7b\"}]}"));
  }

  @AfterEach
  void down() { server.stop(0); }

  private OllamaClient client() { return new OllamaClient(LlmFixtures.url(server) + "/", 1_000, LlmFixtures.OM); }

  @Test
  void requestShapeWithDefaults() {
    String out = client().chatJson("m", "s", "u", ReplyPrompt.REPLY_SCHEMA, null, OllamaClient.DEFAULT_TEMPERATURE, OllamaClient.DEFAULT_NUM_PREDICT, 1_000);
    assertThat(out).isEqualTo("{}");
    JsonNode b = bodies.get(0);
    assertThat(b.get("model").asText()).isEqualTo("m");
    assertThat(b.get("stream").asBoolean()).isFalse();
    assertThat(b.get("think").asBoolean()).isFalse();
    assertThat(b.get("keep_alive").asText()).isEqualTo("30m");
    assertThat(b.get("options").get("temperature").asDouble()).isEqualTo(0.9);
    assertThat(b.get("options").get("num_predict").asInt()).isEqualTo(160);
    assertThat(b.get("messages")).hasSize(2);
    assertThat(b.get("messages").get(0).get("role").asText()).isEqualTo("system");
    assertThat(b.get("messages").get(0).get("content").asText()).isEqualTo("s");
    assertThat(b.get("messages").get(1).get("role").asText()).isEqualTo("user");
    assertThat(b.get("messages").get(1).get("content").asText()).isEqualTo("u");
    assertThat(b.get("messages").get(1).has("images")).isFalse();
    // 스키마의 null이 살아남는다 (enum 안·type 배열 안)
    JsonNode format = b.get("format");
    assertThat(format.get("properties").get("text").get("type").toString()).isEqualTo("[\"string\",null]");
    JsonNode worryEnum = format.get("properties").get("worry").get("enum");
    assertThat(worryEnum.get(worryEnum.size() - 1).isNull()).isTrue();
    assertThat(format.get("required").toString()).isEqualTo("[\"text\",\"worry\",\"callMe\",\"trip\"]");
  }

  @Test
  void tripOptionsAndImagesAndKorean() {
    client().chatJson("m", "시스템", "사용자 — 교토", Map.of("type", "object"), List.of("AAAA"), 0.2, 2500, 1_000);
    JsonNode b = bodies.get(0);
    assertThat(b.get("options").get("temperature").asDouble()).isEqualTo(0.2);
    assertThat(b.get("options").get("num_predict").asInt()).isEqualTo(2500);
    assertThat(b.get("messages").get(1).get("images").get(0).asText()).isEqualTo("AAAA");
    assertThat(b.get("messages").get(0).get("content").asText()).isEqualTo("시스템");
    assertThat(b.get("messages").get(1).get("content").asText()).isEqualTo("사용자 — 교토");
  }

  @Test
  void contentReturnedAsIs() {
    reply = "{\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"text\\\":\\\"나 카페야\\\"}\"}}";
    assertThat(client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000)).isEqualTo("{\"text\":\"나 카페야\"}");
    reply = "{\"message\":{}}";
    assertThat(client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000)).isEqualTo("");
  }

  @Test
  void errorsBecomeOllamaException() {
    status = 404; reply = "{\"error\":\"model 'm' not found\"}";
    assertThatThrownBy(() -> client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000)).isInstanceOf(OllamaException.class).hasMessageStartingWith("ollama 404: ");
    status = 200; reply = "{\"error\":\"something\"}";
    assertThatThrownBy(() -> client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000)).isInstanceOf(OllamaException.class).hasMessage("ollama: something");
  }

  @Test
  void timeoutIsAnError() {
    delayMs = 1_500;   // 제한 시간이 안 걸리면 1.5초 뒤 정상 응답이 와서 예외가 안 난다
    assertThatThrownBy(() -> client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 200)).isInstanceOf(OllamaException.class);
  }

  @Test
  void unreachableIsAnError() {
    OllamaClient dead = new OllamaClient("http://127.0.0.1:9", 1_000, LlmFixtures.OM);
    assertThatThrownBy(() -> dead.chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000)).isInstanceOf(OllamaException.class);
    assertThat(dead.installedModels()).isNull();
  }

  @Test
  void installedModels() {
    assertThat(client().installedModels()).containsExactly("qwen3.5:9b", "llava:7b");
  }
}
