package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmFixtures;
import world.theworld.server.trip.TripDtos.GeoHit;

/** trip.test.mjs '지오코딩' 4개 이관 + Nominatim 호출 규칙(UA·403 즉시 null·1회 재시도·전역 간격·데드라인). 실제 Nominatim은 부르지 않는다. */
class GeocodeTest {
  private HttpServer server;
  private final List<String> queries = new CopyOnWriteArrayList<>();
  private final List<String> agents = new CopyOnWriteArrayList<>();
  private final List<Long> times = new CopyOnWriteArrayList<>();
  private volatile int status = 200;
  private volatile long delayMs = 0;
  private volatile String body = "[{\"lat\":\"35.0\",\"lon\":\"135.7\",\"display_name\":\"Kyoto\",\"address\":{\"country_code\":\"jp\"}}]";

  @BeforeEach
  void up() throws Exception {
    server = LlmFixtures.server();
    server.createContext("/search", ex -> {
      times.add(System.currentTimeMillis());
      queries.add(ex.getRequestURI().getRawQuery());
      agents.add(ex.getRequestHeaders().getFirst("User-Agent"));
      if (delayMs > 0) { try { Thread.sleep(delayMs); } catch (InterruptedException ignored) { } }
      LlmFixtures.respond(ex, status, body);
    });
  }

  @AfterEach
  void down() { server.stop(0); }

  private NominatimClient client(long gapMs, long retryMs) { return new NominatimClient(LlmFixtures.url(server) + "/", "me@example.org", gapMs, retryMs, LlmFixtures.OM); }

  @Test
  void nominatimUrl() {
    assertThat(NominatimClient.nominatimUrl("Kyoto, JP", "https://n")).startsWith("https://n/search?q=Kyoto%2C+JP&format=jsonv2&limit=1");
    assertThat(NominatimClient.nominatimUrl("Kyoto, JP", "https://n/")).isEqualTo("https://n/search?q=Kyoto%2C+JP&format=jsonv2&limit=1&addressdetails=1&accept-language=ko%2Cen");
  }

  @Test
  void parseFirstResult() throws Exception {
    assertThat(NominatimClient.parseNominatim(LlmFixtures.OM.readTree(body))).isEqualTo(new GeoHit(35, 135.7, "Kyoto", "JP"));
  }

  @Test
  void emptyOrBrokenIsNull() throws Exception {
    assertThat(NominatimClient.parseNominatim(LlmFixtures.OM.readTree("[]"))).isNull();
    assertThat(NominatimClient.parseNominatim(LlmFixtures.OM.readTree("[{\"lat\":\"x\",\"lon\":\"1\"}]"))).isNull();
    assertThat(NominatimClient.parseNominatim(LlmFixtures.OM.readTree("{}"))).isNull();
  }

  @Test
  void normCity() {
    assertThat(TripCache.normCity(" Kyoto ")).isEqualTo("kyoto");
    assertThat(TripCache.normCity("교토")).isEqualTo("교토");
    assertThat(TripCache.normCity("Chiang   Mai")).isEqualTo("chiang mai");
  }

  @Test
  void requestHeadersAndQuery() {
    GeoHit g = client(0, 10).geocode("Kiyomizu-dera, Kyoto, JP");
    assertThat(g).isEqualTo(new GeoHit(35, 135.7, "Kyoto", "JP"));
    assertThat(queries.get(0)).isEqualTo("q=Kiyomizu-dera%2C+Kyoto%2C+JP&format=jsonv2&limit=1&addressdetails=1&accept-language=ko%2Cen");
    assertThat(agents.get(0)).isEqualTo("theworld/0.1 (me@example.org)");
    NominatimClient noContact = new NominatimClient(LlmFixtures.url(server), "  ", 0, 10, LlmFixtures.OM);
    noContact.geocode("x");
    assertThat(agents.get(1)).isEqualTo("theworld/0.1 (dev@localhost)");
  }

  @Test
  void forbiddenIsImmediatelyNull() {
    status = 403;
    assertThat(client(0, 10).geocode("x")).isNull();
    assertThat(queries).hasSize(1);
    status = 400;
    assertThat(client(0, 10).geocode("y")).isNull();
    assertThat(queries).hasSize(2);
  }

  @Test
  void serverErrorRetriesOnce() {
    status = 500;
    assertThat(client(0, 20).geocode("x")).isNull();
    assertThat(queries).hasSize(2);
  }

  @Test
  void emptyResultIsNotRetried() {
    body = "[]";
    assertThat(client(0, 20).geocode("x")).isNull();
    assertThat(queries).hasSize(1);
  }

  @Test
  void globalGapBetweenCalls() {
    NominatimClient c = client(150, 10);
    long t0 = System.currentTimeMillis();
    c.geocode("a"); c.geocode("b"); c.geocode("c");
    assertThat(times).hasSize(3);
    assertThat(System.currentTimeMillis() - t0).as("간격 둘 = 300ms 이상").isGreaterThanOrEqualTo(290);
  }

  @Test
  void deadlineBoundsTimeoutAndSkipsRetry() {
    delayMs = 800;   // 제한 시간(남은 150ms)이 안 걸리면 0.8초 뒤 좌표가 와서 null이 아니다
    assertThat(client(0, 2_000).geocode("slow", 150)).isNull();
    assertThat(queries).hasSize(1);   // 재시도할 시간이 없다
    assertThat(client(0, 2_000).geocode("none", 0)).isNull();
    assertThat(queries).hasSize(1);   // 남은 시간 0 — 묻지 않는다
  }
}
