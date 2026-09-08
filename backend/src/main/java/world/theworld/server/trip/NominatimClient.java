package world.theworld.server.trip;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.trip.TripDtos.GeoHit;

/**
 * 지오코딩 (옛 Node 백엔드 geocode.ts(커밋 0298e8d), docs/adr/0009-trip-search.md). Nominatim(OpenStreetMap) 공개 서버. 이용 정책: 초당 1회, 식별 가능한
 * User-Agent, 대량 조회 금지. 도시당 장소 열댓 개를 **순차로** 1.1초 간격으로 묻고 결과는 TripCache가 남기므로 한 도시에 한 번이다.
 * 간격은 프로세스 전역 락 하나로 지킨다 — Node 원본은 전역 변수라 도시 둘이 동시에 오면 경쟁이 있었다. 자체 서버가 있으면 NOMINATIM_URL(+ min-gap-ms 0).
 */
@Component
public class NominatimClient {
  private static final Logger log = LoggerFactory.getLogger(NominatimClient.class);
  public static final long TIMEOUT_MS = 8_000;
  public static final long RETRY_SLEEP_MS = 2_000;

  private final String baseUrl;
  private final String userAgent;
  private final long minGapMs;
  private final long retrySleepMs;
  private final ObjectMapper om;
  private final HttpClient http;
  /** 컨버터를 미리 맞춘 빌더 — 호출마다 clone해 제한 시간만 끼운다 (OllamaClient와 같은 이유: 데드라인이 깎은 값마다 캐시가 자라지 않게) */
  private final RestClient.Builder base;
  /** 전역 1.1초 간격 — 정책상 동시에 한 요청만 나간다. */
  private final ReentrantLock lock = new ReentrantLock(true);
  private long lastCallAt = 0;

  @Autowired
  public NominatimClient(TheworldProps props, ObjectMapper om) {
    this(props.nominatim().url(), props.nominatim().contact(), props.nominatim().minGapMs(), RETRY_SLEEP_MS, om);
  }

  /** 주소·연락처·간격을 직접 — 테스트가 로컬 서버를 꽂는다. */
  public NominatimClient(String baseUrl, String contact, long minGapMs, long retrySleepMs, ObjectMapper om) {
    this.baseUrl = baseUrl.replaceFirst("/$", "");
    String c = contact == null ? "" : contact.strip();
    this.userAgent = "theworld/0.1 (" + (c.isEmpty() ? "dev@localhost" : c) + ")";
    this.minGapMs = minGapMs;
    this.retrySleepMs = retrySleepMs;
    this.om = om;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    this.base = RestClient.builder().messageConverters(mc -> { mc.clear(); mc.add(new ByteArrayHttpMessageConverter()); });
  }

  /** 검색 URL. 순수 함수 — URLSearchParams와 같은 인코딩(공백 '+', 쉼표 %2C). */
  public static String nominatimUrl(String q, String base) {
    return base.replaceFirst("/$", "") + "/search?q=" + enc(q) + "&format=jsonv2&limit=1&addressdetails=1&accept-language=" + enc("ko,en");
  }

  private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

  /**
   * Nominatim 응답을 다듬는다. 순수 함수. 첫 결과만 본다.
   *
   * @param json 응답 JSON (배열)
   * @return 좌표, 없으면 null
   */
  public static GeoHit parseNominatim(JsonNode json) {
    if (json == null || !json.isArray() || json.isEmpty()) return null;
    JsonNode r = json.get(0);
    double lat = num(r.get("lat")), lng = num(r.get("lon"));
    if (Double.isNaN(lat) || Double.isNaN(lng)) return null;
    JsonNode dn = r.get("display_name");
    JsonNode cc = r.path("address").get("country_code");
    return new GeoHit(lat, lng, dn != null && dn.isTextual() ? dn.asText() : "", cc != null && cc.isTextual() ? cc.asText().toUpperCase(java.util.Locale.ROOT) : "");
  }

  /** JS `Number(x)` — 숫자 문자열도 받는다. 못 읽으면 NaN. */
  private static double num(JsonNode n) {
    if (n == null || n.isNull()) return Double.NaN;
    if (n.isNumber()) return n.doubleValue();
    if (n.isTextual()) { try { return Double.parseDouble(n.asText().strip()); } catch (NumberFormatException e) { return Double.NaN; } }
    return Double.NaN;
  }

  private RestClient client(long timeoutMs) {
    JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(http);
    f.setReadTimeout(Duration.ofMillis(Math.max(1, timeoutMs)));
    return base.clone().requestFactory(f).build();
  }

  /** 장소 이름 하나의 좌표. 정책대로 앞 호출과 1.1초를 띄운다. 못 찾거나 오류면 null (한 장소가 실패해도 팩은 살린다). */
  public GeoHit geocode(String q) {
    return geocode(q, Long.MAX_VALUE);
  }

  /**
   * @param q "Kiyomizu-dera, Kyoto, JP"
   * @param remainingMs 데드라인까지 남은 시간 (결함 4) — 제한 시간은 min(8초, 남은 시간), 재시도는 시간이 남을 때만. 0 이하면 묻지 않는다
   * @return 좌표, 못 찾거나 오류·데드라인이면 null
   */
  public GeoHit geocode(String q, long remainingMs) {
    long deadline = remainingMs >= Long.MAX_VALUE / 2 ? Long.MAX_VALUE : System.currentTimeMillis() + remainingMs;
    lock.lock();
    try {
      // 서버 오류·제한 시간은 한 번 더 — 공개 서버는 가끔 429/5xx를 낸다. "결과 없음"(200에 빈 배열)은 다시 묻지 않는다
      for (int attempt = 0; attempt < 2; attempt++) {
        long wait = lastCallAt + minGapMs - System.currentTimeMillis();
        if (wait > 0 && !sleep(wait)) return null;
        long timeout = Math.min(TIMEOUT_MS, deadline == Long.MAX_VALUE ? TIMEOUT_MS : deadline - System.currentTimeMillis());
        if (timeout <= 0) return null;   // 데드라인 — 묻지 않는다
        lastCallAt = System.currentTimeMillis();
        try {
          Response r = request(q, timeout);
          if (r.status >= 200 && r.status < 300) return parseNominatim(om.readTree(r.body));
          log.warn("[geocode] {} for \"{}\"{}", r.status, q, r.status == 403 ? " — Nominatim이 User-Agent를 거부했다. NOMINATIM_CONTACT에 진짜 연락처를 넣거나 비워 둔다 (example.com 같은 자리표시는 막힌다)" : "");
          if (r.status == 403 || r.status == 400) return null;   // 다시 물어도 같다
        } catch (Exception e) {
          log.warn("[geocode] {} for \"{}\"", e.getClass().getSimpleName(), q);
        }
        if (attempt == 0) {
          if (deadline != Long.MAX_VALUE && deadline - System.currentTimeMillis() <= retrySleepMs) return null;   // 재시도할 시간이 없다
          if (!sleep(retrySleepMs)) return null;
        }
      }
      return null;
    } finally {
      lock.unlock();
    }
  }

  private record Response(int status, String body) {}

  private Response request(String q, long timeoutMs) {
    try {
      return client(timeoutMs).get().uri(URI.create(nominatimUrl(q, baseUrl))).header("user-agent", userAgent).header("accept", "application/json")
        .exchange((req, res) -> new Response(res.getStatusCode().value(), new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8)));
    } catch (RestClientException e) {
      throw new IllegalStateException(e.getMessage(), e);
    }
  }

  /** @return false면 인터럽트됐다 */
  private static boolean sleep(long ms) {
    try { Thread.sleep(ms); return true; }
    catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
  }
}
