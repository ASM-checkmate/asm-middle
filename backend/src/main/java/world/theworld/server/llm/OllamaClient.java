package world.theworld.server.llm;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import world.theworld.server.common.TheworldProps;

/**
 * Ollama 호출 (옛 Node 백엔드 ollama.ts(커밋 0298e8d) 그대로). /api/chat 하나만 쓴다. 생각 모드는 끈다 (답장 한 줄에 몇 초씩 더 걸릴 뿐이다).
 * JSON 스키마를 `format`으로 넘겨 모델이 형식을 지키게 한다. 요청 본문 모양은 BACKEND-CONTRACT §2.4에 고정돼 있다:
 * {@code { model, stream:false, think:false, format, keep_alive:'30m', options:{temperature, num_predict}, messages:[system, user(+images)] }}.
 * 제한 시간은 호출마다 다르므로(reply 25s·trip은 데드라인이 깎은 값·tags 2s) 호출마다 가벼운 요청 팩토리를 새로 만들어 하나의 JDK HttpClient
 * (연결 풀) 위에 얹는다 — 값별로 캐시하면 데드라인이 깎은 값마다 인스턴스가 영원히 쌓인다.
 * 스레드가 인터럽트되면(묶음 취소, ReplyService) 진행 중인 요청(HTTP 연결)도 끊긴다. Ollama가 그 뒤 생성을 멈추는지는 확인하지 않았다
 * (backend/README '알려진 한계').
 */
@Component
public class OllamaClient {
  /** 답장용 기본 생성 옵션 (ollama.ts:38). */
  public static final double DEFAULT_TEMPERATURE = 0.9;
  public static final int DEFAULT_NUM_PREDICT = 160;
  /** 설치 모델 조회 제한 시간 (ollama.ts:51). */
  public static final long TAGS_TIMEOUT_MS = 2_000;

  private final String baseUrl;
  private final long defaultTimeoutMs;
  private final ObjectMapper om;
  private final HttpClient http;
  /** 주소·컨버터를 미리 맞춘 빌더 — 호출마다 clone해 제한 시간만 끼운다. 본문은 byte[]로 보내고 응답은 exchange로 직접 읽으므로 컨버터는 하나면 된다 */
  private final RestClient.Builder base;

  @Autowired
  public OllamaClient(TheworldProps props, ObjectMapper om) {
    this(props.ollama().url(), props.ollama().timeoutMs(), om);
  }

  /** 주소·기본 제한 시간을 직접 — 테스트가 로컬 서버를 꽂는다. */
  public OllamaClient(String baseUrl, long defaultTimeoutMs, ObjectMapper om) {
    this.baseUrl = baseUrl.replaceFirst("/$", "");
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.om = om;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    this.base = RestClient.builder().baseUrl(this.baseUrl).messageConverters(c -> { c.clear(); c.add(new ByteArrayHttpMessageConverter()); });
  }

  /** reply·sketch가 쓰는 기본 제한 시간 (LLM_TIMEOUT_MS). */
  public long defaultTimeoutMs() { return defaultTimeoutMs; }

  /** 제한 시간을 끼운 클라이언트 — 팩토리·클라이언트는 가볍고(연결 풀은 http 하나), 어디에도 남기지 않는다. */
  private RestClient client(long timeoutMs) {
    JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(http);
    f.setReadTimeout(Duration.ofMillis(Math.max(1, timeoutMs)));
    return base.clone().requestFactory(f).build();
  }

  /**
   * 시스템·사용자 프롬프트로 JSON 한 덩어리를 받는다.
   *
   * @param model Ollama 모델 태그 ("qwen3.8:27b")
   * @param system 시스템 프롬프트
   * @param user 사용자 프롬프트
   * @param schema 응답 JSON 스키마 (Ollama structured output) — Map/List로 만든 것 (null 보존)
   * @param images 사용자 메시지에 붙일 이미지 (base64, 접두 없이). 비어 있으면 키를 넣지 않는다. 비전 모델만 받는다
   * @param temperature 생성 온도 (답장 0.9, 여행 0.2)
   * @param numPredict 최대 토큰 (답장 160, 여행 2500)
   * @param timeoutMs 제한 시간
   * @return 모델이 낸 JSON 문자열 (파싱은 호출자가). 없으면 ''
   * @throws OllamaException 서버 오류·제한 시간·연결 실패. 모델이 없으면 Ollama의 메시지가 그대로 실린다
   */
  public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs) {
    Map<String, Object> systemMsg = new LinkedHashMap<>();
    systemMsg.put("role", "system");
    systemMsg.put("content", system);
    Map<String, Object> userMsg = new LinkedHashMap<>();
    userMsg.put("role", "user");
    userMsg.put("content", user);
    if (images != null && !images.isEmpty()) userMsg.put("images", images);
    Map<String, Object> options = new LinkedHashMap<>();
    options.put("temperature", temperature);
    options.put("num_predict", numPredict);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("stream", false);
    body.put("think", false);
    body.put("format", schema);
    body.put("keep_alive", "30m");   // 답장마다 17GB를 다시 올리지 않게
    body.put("options", options);
    body.put("messages", List.of(systemMsg, userMsg));
    byte[] json;
    try { json = om.writeValueAsBytes(body); }
    catch (JsonProcessingException e) { throw new OllamaException("ollama: cannot serialize request", e); }
    try {
      return client(timeoutMs).post().uri("/api/chat").contentType(MediaType.APPLICATION_JSON).body(json).exchange((req, res) -> {
        String text = new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8);
        if (!res.getStatusCode().is2xxSuccessful()) throw new OllamaException("ollama " + res.getStatusCode().value() + ": " + Text.cut(text, 300));
        JsonNode j;
        try { j = om.readTree(text); }
        catch (JsonProcessingException e) { throw new OllamaException("ollama: unreadable response " + Text.cut(text, 300)); }
        if (j != null && j.hasNonNull("error")) throw new OllamaException("ollama: " + j.get("error").asText());
        JsonNode content = j == null ? null : j.path("message").path("content");
        return content != null && content.isTextual() ? content.asText() : "";
      });
    } catch (RestClientException e) {   // 연결 거부·제한 시간·인터럽트
      throw new OllamaException("ollama: " + rootMessage(e), e);
    }
  }

  /** 설치된 모델 태그들 (GET /api/tags, 2초). 서버가 없으면 null. */
  public Set<String> installedModels() {
    try {
      return client(TAGS_TIMEOUT_MS).get().uri("/api/tags").exchange((req, res) -> {
        JsonNode j = om.readTree(res.getBody());
        Set<String> out = new LinkedHashSet<>();
        if (j != null) for (JsonNode m : j.path("models")) if (m.path("name").isTextual()) out.add(m.get("name").asText());
        return out;
      });
    } catch (RuntimeException e) {
      return null;
    }
  }

  static String rootMessage(Throwable e) {
    Throwable t = e;
    while (t.getCause() != null && t.getCause() != t) t = t.getCause();
    String m = t.getMessage();
    return m == null || m.isBlank() ? t.getClass().getSimpleName() : m;
  }
}
