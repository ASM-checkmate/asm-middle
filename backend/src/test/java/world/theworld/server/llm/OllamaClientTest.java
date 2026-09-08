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
    assertThat(b.get("stream").asBoolean()).isTrue();   // 항상 스트리밍으로 받아 모은다 (ADR-0011 결정 6) — 끊으면 다음 토큰에서 멈춘다
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

  // ── 스트리밍 (call.test.mjs '스트리밍', ollama.ts chatJson) ──

  /** Ollama의 ndjson 스트림을 흉내 낸다 — 토큰이 조각조각, 줄 경계와 무관하게 나뉘어 온다. */
  private void streamContext(String path, List<String> tokens, long gapMs) {
    server.createContext(path, ex -> {
      bodies.add(LlmFixtures.OM.readTree(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      ex.getResponseHeaders().add("content-type", "application/x-ndjson");
      ex.sendResponseHeaders(200, 0);
      try (var out = ex.getResponseBody()) {
        StringBuilder all = new StringBuilder();
        for (String t : tokens) all.append("{\"message\":{\"content\":").append(LlmFixtures.OM.writeValueAsString(t)).append("},\"done\":false}\n");
        all.append("{\"message\":{\"content\":\"\"},\"done\":true}\n");
        String body = all.toString();
        int[] cuts = { 0, 40, 95, body.length() };
        for (int i = 1; i < cuts.length; i++) {
          out.write(body.substring(cuts[i - 1], Math.min(cuts[i], body.length())).getBytes(StandardCharsets.UTF_8));
          out.flush();
          if (gapMs > 0) { try { Thread.sleep(gapMs); } catch (InterruptedException ignored) { } }
        }
      } catch (java.io.IOException ignored) { /* 클라이언트가 끊었다 */ }
    });
  }

  @Test
  void streamDeliversDeltasInOrderAndAccumulates() {
    server.removeContext("/api/chat");
    streamContext("/api/chat", List.of("어… ", "그랬", "구나. ", "많이 ", "힘들었겠다", "! "), 0);
    List<String> got = new java.util.ArrayList<>();
    client().chatStream("m", "s", "u", null, null, 0.8, 90, 1_000, null, got::add);
    assertThat(String.join("|", got)).isEqualTo("어… |그랬|구나. |많이 |힘들었겠다|! ");
    assertThat(bodies.get(0).has("format")).isFalse();   // 스키마 없이 자유 텍스트 (통화)
    assertThat(bodies.get(0).get("stream").asBoolean()).isTrue();
    assertThat(client().chatJson("m", "s", "u", Map.of("type", "object"), null, 0.9, 160, 1_000)).isEqualTo("어… 그랬구나. 많이 힘들었겠다! ");
  }

  @Test
  void streamErrorLineIsAnError() {
    reply = "{\"error\":\"model 'm' not found\"}\n";
    assertThatThrownBy(() -> client().chatStream("m", "s", "u", null, null, 0.8, 90, 1_000, null, s -> { })).isInstanceOf(OllamaException.class).hasMessage("ollama: model 'm' not found");
  }

  @Test
  void cancelStopsTheStreamAndKeepsWhatArrived() throws Exception {
    server.removeContext("/api/chat");
    streamContext("/api/chat", List.of("하나. ", "둘. ", "셋. ", "넷. ", "다섯. ", "여섯. "), 300);
    OllamaClient.Cancel cancel = new OllamaClient.Cancel();
    List<String> got = new java.util.ArrayList<>();
    java.util.concurrent.CountDownLatch first = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicReference<Throwable> err = new java.util.concurrent.atomic.AtomicReference<>();
    Thread t = new Thread(() -> {
      try { client().chatStream("m", "s", "u", null, null, 0.8, 90, 5_000, cancel, s -> { got.add(s); first.countDown(); }); }
      catch (Throwable e) { err.set(e); }
    });
    t.start();
    assertThat(first.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
    cancel.cancel();
    t.join(3_000);
    assertThat(t.isAlive()).isFalse();
    assertThat(err.get()).isInstanceOf(OllamaCancelledException.class);
    assertThat(got).isNotEmpty().hasSizeLessThan(6);   // 끊긴 뒤의 조각은 오지 않는다
    assertThat(cancel.cancelled()).isTrue();
  }

  @Test
  void cancelledBeforeStartNeverCalls() {
    OllamaClient.Cancel cancel = new OllamaClient.Cancel();
    cancel.cancel();
    assertThatThrownBy(() -> client().chatJson("m", "s", "u", Map.of(), null, 0.9, 160, 1_000, cancel)).isInstanceOf(OllamaCancelledException.class);
    assertThat(bodies).isEmpty();
  }

  // ── 예열 (ollama.ts warmModel) ──

  @Test
  void warmPostsGenerateWithEmptyPrompt() {
    server.createContext("/api/generate", ex -> {
      bodies.add(LlmFixtures.OM.readTree(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      LlmFixtures.respond(ex, 200, "{\"model\":\"m\",\"done\":true}");
    });
    client().warm("m");
    JsonNode b = bodies.get(0);
    assertThat(b.get("model").asText()).isEqualTo("m");
    assertThat(b.get("prompt").asText()).isEmpty();
    assertThat(b.get("keep_alive").asText()).isEqualTo("30m");
    assertThatThrownBy(() -> new OllamaClient("http://127.0.0.1:9", 1_000, LlmFixtures.OM).warm("m")).isInstanceOf(OllamaException.class);
  }
}
