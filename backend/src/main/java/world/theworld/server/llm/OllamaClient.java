package world.theworld.server.llm;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import world.theworld.server.common.TheworldProps;

/**
 * Ollama 호출 (옛 Node 백엔드 ollama.ts(커밋 2808024) 그대로). /api/chat 하나로 말을 짓고, /api/generate로 예열한다. 생각 모드는 끈다.
 * JSON 스키마를 `format`으로 넘겨 모델이 형식을 지키게 한다. 요청 본문 모양은 BACKEND-CONTRACT §2.4에 고정돼 있다:
 * {@code { model, stream:true, think:false, format?, keep_alive:'30m', options:{temperature, num_predict}, messages:[system, user(+images)] }}.
 *
 * <p><b>항상 스트리밍으로 받아 모은다</b> (ADR-0011 결정 6). Ollama는 이 맥에서 요청을 한 번에 하나만 돌리므로, 통화 턴이 오면 돌고 있던
 * 하루 계획·여행지 추출을 끊어야 한다. stream:false면 연결을 끊어도 Ollama가 끝까지 돌아 통화 첫마디가 그 뒤에 줄을 서지만,
 * 스트리밍이면 응답 스트림을 닫는 순간 다음 토큰에서 멈춘다. {@link Cancel}이 그 손잡이다 — {@link ModelLane}이 낮은 우선순위 호출을 모아 두고
 * 통화가 오면 전부 끊는다. 스레드 인터럽트(묶음 취소, ReplyService)도 같은 길로 끊는다.
 *
 * <p>제한 시간은 호출마다 다르므로(reply 25s·trip은 데드라인이 깎은 값·tags 2s) 호출마다 가벼운 요청 팩토리를 새로 만들어 하나의 JDK HttpClient
 * (연결 풀) 위에 얹는다 — 값별로 캐시하면 데드라인이 깎은 값마다 인스턴스가 영원히 쌓인다. 읽기 제한 시간은 토큰 사이의 침묵에 걸린다.
 */
@Component
public class OllamaClient {
  /** 답장용 기본 생성 옵션 (ollama.ts:40). */
  public static final double DEFAULT_TEMPERATURE = 0.9;
  public static final int DEFAULT_NUM_PREDICT = 160;
  /** 설치 모델 조회 제한 시간 (ollama.ts:84). */
  public static final long TAGS_TIMEOUT_MS = 2_000;
  /** 예열 제한 시간 (ollama.ts:74) — 27B를 올리는 데 몇 초에서 몇십 초. */
  public static final long WARM_TIMEOUT_MS = 60_000;

  /**
   * 진행 중인 생성 하나를 끊는 손잡이. {@link #cancel()}은 응답 스트림을 닫아(연결이 끊기면 Ollama가 다음 토큰에서 멈춘다) 읽던 스레드를
   * {@link OllamaCancelledException}으로 깨운다. 호출 전에 미리 만들어 넘기고, 다른 스레드에서 끊는다. 한 번 쓰고 버린다.
   */
  public static final class Cancel {
    private volatile boolean cancelled;
    private volatile Closeable body;
    private volatile Thread reader;

    public boolean cancelled() { return cancelled; }

    /** 끊는다 — 아직 시작 전이면 시작하자마자 끊긴다, 진행 중이면 스트림을 닫는다. 여러 번 불러도 된다. */
    public void cancel() {
      cancelled = true;
      Closeable b = body;
      if (b != null) { try { b.close(); } catch (IOException ignored) { /* 이미 닫힘 */ } }
      Thread t = reader;
      if (t != null) t.interrupt();
    }

    void attach(Closeable b, Thread t) {
      body = b;
      reader = t;
      if (cancelled) cancel();   // 붙이기 전에 끊겼다 — 지금 닫는다
    }

    void detach() {
      body = null;
      reader = null;
    }
  }

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
   * 시스템·사용자 프롬프트로 JSON 한 덩어리를 받는다 (스트리밍으로 받아 모은 것).
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
    return chatJson(model, system, user, schema, images, temperature, numPredict, timeoutMs, null);
  }

  /**
   * {@link #chatJson(String, String, String, Map, List, double, int, long)}에 끊기 손잡이를 더한 것 — 하루 계획·여행지처럼 통화에 양보하는 호출.
   *
   * @param cancel 끊기 손잡이. null이면 못 끊는다
   * @throws OllamaCancelledException 손잡이로 끊겼다
   */
  public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs, Cancel cancel) {
    StringBuilder out = new StringBuilder();
    chatStream(model, system, user, schema, images, temperature, numPredict, timeoutMs, cancel, out::append);
    return out.toString();
  }

  /**
   * 스트리밍 채팅 — 토큰 조각이 올 때마다 {@code onDelta}를 부른다 (통화 턴, call.ts callTurn). 같은 스레드에서, 순서대로.
   *
   * @param schema 응답 스키마. null이면 `format` 없이 자유 텍스트 (통화)
   * @param cancel 끊기 손잡이. null이면 못 끊는다
   * @param onDelta 조각 하나 (빈 조각은 건너뛴다)
   * @throws OllamaException 서버 오류·제한 시간·연결 실패·응답의 error 필드
   * @throws OllamaCancelledException {@code cancel}로 끊겼다 (그때까지의 조각은 이미 전달됐다)
   */
  public void chatStream(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs, Cancel cancel, Consumer<String> onDelta) {
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
    body.put("stream", true);
    body.put("think", false);
    if (schema != null) body.put("format", schema);
    body.put("keep_alive", "30m");   // 답장마다 17GB를 다시 올리지 않게
    body.put("options", options);
    body.put("messages", List.of(systemMsg, userMsg));
    byte[] json;
    try { json = om.writeValueAsBytes(body); }
    catch (JsonProcessingException e) { throw new OllamaException("ollama: cannot serialize request", e); }
    if (cancel != null && cancel.cancelled()) throw new OllamaCancelledException();
    try {
      client(timeoutMs).post().uri("/api/chat").contentType(MediaType.APPLICATION_JSON).body(json).exchange((req, res) -> {
        if (!res.getStatusCode().is2xxSuccessful()) {
          String text = new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8);
          throw new OllamaException("ollama " + res.getStatusCode().value() + ": " + Text.cut(text, 300));
        }
        InputStream in = res.getBody();
        if (cancel != null) cancel.attach(in, Thread.currentThread());
        try {
          readLines(in, onDelta, cancel);
        } finally {
          if (cancel != null) cancel.detach();
        }
        return null;
      });
    } catch (RestClientException e) {   // 연결 거부·제한 시간·인터럽트·끊김
      if (cancel != null && cancel.cancelled()) throw new OllamaCancelledException();
      throw new OllamaException("ollama: " + rootMessage(e), e);
    }
    if (cancel != null && cancel.cancelled()) throw new OllamaCancelledException();
  }

  /**
   * ndjson 한 줄이 조각 하나다 ({@code {"message":{"content":"…"},"done":false}}). stream:false 응답(객체 하나)도 같은 모양이라 같이 읽힌다.
   * `error` 필드가 있으면 그 줄에서 멈춘다. 끊겼으면(스트림이 닫혔으면) 조용히 나온다 — 호출자가 손잡이를 보고 예외를 낸다.
   */
  private void readLines(InputStream in, Consumer<String> onDelta, Cancel cancel) throws IOException {
    BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
    String line;
    try {
      while ((line = r.readLine()) != null) {
        line = line.strip();
        if (line.isEmpty()) continue;
        JsonNode j;
        try { j = om.readTree(line); }
        catch (JsonProcessingException e) { continue; }   // 깨진 줄은 넘긴다 (call.ts:126)
        if (j == null) continue;
        if (j.hasNonNull("error")) throw new OllamaException("ollama: " + j.get("error").asText());
        JsonNode content = j.path("message").path("content");
        if (content.isTextual() && !content.asText().isEmpty()) onDelta.accept(content.asText());
        if (j.path("done").asBoolean(false)) break;
      }
    } catch (IOException e) {
      if (cancel != null && cancel.cancelled()) return;   // 우리가 닫았다
      throw e;
    }
  }

  /**
   * 모델을 미리 올려 둔다 (생성 없이, POST /api/generate). 통화 벨이 울릴 때 부르면 첫마디가 모델 로드(3~15초)를 기다리지 않는다 (ollama.ts:72).
   *
   * @throws OllamaException 서버 오류·제한 시간
   */
  public void warm(String model) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("prompt", "");
    body.put("keep_alive", "30m");
    byte[] json;
    try { json = om.writeValueAsBytes(body); }
    catch (JsonProcessingException e) { throw new OllamaException("ollama: cannot serialize request", e); }
    try {
      client(WARM_TIMEOUT_MS).post().uri("/api/generate").contentType(MediaType.APPLICATION_JSON).body(json).exchange((req, res) -> {
        byte[] text = res.getBody().readAllBytes();
        if (!res.getStatusCode().is2xxSuccessful()) throw new OllamaException("ollama " + res.getStatusCode().value() + ": " + Text.cut(new String(text, StandardCharsets.UTF_8), 300));
        return null;
      });
    } catch (RestClientException e) {
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
