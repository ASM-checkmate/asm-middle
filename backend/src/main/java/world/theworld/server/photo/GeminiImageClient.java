package world.theworld.server.photo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import world.theworld.server.common.TheworldProps;

/**
 * Gemini 이미지 생성 (ADR-0029). {@code models/{model}:generateContent}에 참고 그림(inlineData)과 글을 보내고 응답의 inlineData(base64)를
 * 찾는다 — frontend/scripts/nano-banana.mjs와 같은 호출. 429/5xx는 한 번 물러났다 다시, 그림이 안 오면(거절) {@link GeminiException}.
 */
@Component
public class GeminiImageClient {
  private static final Logger log = LoggerFactory.getLogger(GeminiImageClient.class);

  /** 참고 그림 하나 — mime과 바이트 */
  public record Ref(String mime, byte[] bytes) {}
  /** 받은 그림 */
  public record Image(String mime, byte[] bytes) {}

  private final TheworldProps.Gemini cfg;
  private final ObjectMapper om;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  public GeminiImageClient(TheworldProps props, ObjectMapper om) {
    this.cfg = props.gemini();
    this.om = om;
  }

  public boolean enabled() { return cfg.apiKey() != null && !cfg.apiKey().isBlank(); }

  /**
   * @param refs 참고 그림들 (순서대로 parts에 실린다 — 프롬프트가 "첫 그림·둘째 그림"으로 가리킨다)
   * @param prompt 글
   * @param aspect "2:3" 같은 비율
   */
  public Image generate(List<Ref> refs, String prompt, String aspect) {
    if (!enabled()) throw new GeminiException(503, "gemini api key not configured");
    ObjectNode body = om.createObjectNode();
    ArrayNode contents = body.putArray("contents");
    ObjectNode content = contents.addObject();
    content.put("role", "user");
    ArrayNode parts = content.putArray("parts");
    for (Ref r : refs) {
      ObjectNode inline = parts.addObject().putObject("inlineData");
      inline.put("mimeType", r.mime());
      inline.put("data", Base64.getEncoder().encodeToString(r.bytes()));
    }
    parts.addObject().put("text", prompt);
    ObjectNode gen = body.putObject("generationConfig");
    gen.putArray("responseModalities").add("IMAGE");
    ObjectNode ic = gen.putObject("imageConfig");
    ic.put("aspectRatio", aspect);
    ic.put("imageSize", "1K");

    String url = cfg.endpoint().replaceFirst("/$", "") + "/" + cfg.imageModel() + ":generateContent";
    byte[] payload;
    try { payload = om.writeValueAsBytes(body); } catch (IOException e) { throw new GeminiException(500, "gemini: bad request body"); }
    String lastText = "";
    for (int attempt = 1; attempt <= 3; attempt++) {
      HttpRequest req = HttpRequest.newBuilder(URI.create(url))
        .timeout(Duration.ofMillis(Math.max(1000, cfg.timeoutMs())))
        .header("x-goog-api-key", cfg.apiKey())
        .header("content-type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
        .build();
      HttpResponse<byte[]> res;
      try {
        res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
      } catch (IOException e) {
        throw new GeminiException(502, "gemini: " + e.getMessage());
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new GeminiException(502, "gemini: interrupted");
      }
      if (res.statusCode() == 429 || res.statusCode() >= 500) {
        log.warn("gemini {} — retry {}/3", res.statusCode(), attempt);
        try { Thread.sleep(attempt == 1 ? 3000 : 8000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new GeminiException(502, "gemini: interrupted"); }
        continue;
      }
      JsonNode json;
      try { json = om.readTree(res.body()); } catch (IOException e) { throw new GeminiException(502, "gemini: unreadable response"); }
      if (res.statusCode() != 200) {
        String msg = json.path("error").path("message").asText("http " + res.statusCode());
        throw new GeminiException(502, "gemini: " + msg);
      }
      Image img = findImage(json);
      if (img != null) return img;
      lastText = findText(json);
      log.warn("gemini returned no image: {}", lastText);
      if (attempt >= 2) break;   // 거절이 두 번이면 프롬프트 문제
    }
    throw new GeminiException(502, "gemini: no image — " + lastText);
  }

  /** 응답 어디에 있든 base64 그림을 찾는다 (inlineData / inline_data) */
  static Image findImage(JsonNode n) {
    if (n == null) return null;
    for (String k : new String[] {"inlineData", "inline_data"}) {
      JsonNode v = n.get(k);
      if (v != null && v.path("data").isTextual() && v.path("data").asText().length() > 1000) {
        String mime = v.path("mimeType").asText(v.path("mime_type").asText("image/png"));
        return new Image(mime, Base64.getDecoder().decode(v.path("data").asText()));
      }
    }
    for (JsonNode c : n) { Image f = findImage(c); if (f != null) return f; }
    return null;
  }

  static String findText(JsonNode n) {
    StringBuilder sb = new StringBuilder();
    collectText(n, sb);
    String s = sb.toString().trim();
    return s.length() > 300 ? s.substring(0, 300) : s;
  }

  private static void collectText(JsonNode n, StringBuilder sb) {
    if (n == null) return;
    if (n.has("text") && n.get("text").isTextual()) sb.append(n.get("text").asText()).append(' ');
    for (JsonNode c : n) collectText(c, sb);
  }
}
