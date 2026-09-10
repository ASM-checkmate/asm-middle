package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmFixtures;
import world.theworld.server.llm.OllamaClient;
import world.theworld.server.trip.TripDtos.GeoHit;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripDtos.TripPlace;
import world.theworld.server.trip.TripDtos.TripPlanRequest;
import world.theworld.server.trip.TripDtos.TripPlanResponse;

/**
 * 파이프라인 순서·데드라인(결함 4)·동시 요청 합치기·캐시 별칭 (trip.ts planTrip). 검색·모델·지오코딩·DB는 전부 가짜 — 네트워크도 Ollama도 없다.
 */
class TripServiceTest {
  static class FakeOllama extends OllamaClient {
    final AtomicInteger calls = new AtomicInteger();
    volatile String raw = TripFixtures.DRAFT_JSON;
    volatile CountDownLatch gate;
    final CountDownLatch entered = new CountDownLatch(1);
    volatile long lastTimeout;
    FakeOllama() { super("http://127.0.0.1:9", 1_000, LlmFixtures.OM); }
    @Override public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs, OllamaClient.Cancel cancel) {
      calls.incrementAndGet();
      lastTimeout = timeoutMs;
      assertThat(temperature).isEqualTo(0.2);
      assertThat(numPredict).isEqualTo(2500);
      assertThat(schema).isSameAs(TripPrompt.TRIP_SCHEMA);
      entered.countDown();
      if (gate != null) { try { gate.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { } }
      return raw;
    }
  }

  static class FakeSearch extends SearchClient {
    final AtomicInteger calls = new AtomicInteger();
    volatile boolean empty = false;
    FakeSearch(String key) { super("http://127.0.0.1:9/x", key, LlmFixtures.OM); }
    @Override public List<List<SearchHit>> searchAll(String cityKo) {
      requireApiKey();
      calls.incrementAndGet();
      if (empty) return List.of(List.of(), List.of(), List.of());
      List<SearchHit> h = TripFixtures.hits();
      return List.of(List.of(h.get(0)), List.of(h.get(1)), List.of(h.get(2)));
    }
  }

  /** 표에 있는 이름은 좌표를, 없으면 null. 호출마다 가짜 시계를 advanceMs만큼 민다. */
  static class FakeGeo extends NominatimClient {
    final List<String> calls = new CopyOnWriteArrayList<>();
    final Map<String, GeoHit> table = new HashMap<>();
    final AtomicLong clock;
    long advanceMs = 0;
    FakeGeo(AtomicLong clock) { super("http://127.0.0.1:9", "", 0, 0, LlmFixtures.OM); this.clock = clock; }
    @Override public GeoHit geocode(String q, long remainingMs) {
      calls.add(q);
      assertThat(remainingMs).isPositive();
      clock.addAndGet(advanceMs);
      return table.get(q);
    }
  }

  static class FakeCache extends TripCache {
    final Map<String, TripPlanResponse> packs = new ConcurrentHashMap<>();
    final Map<String, List<List<SearchHit>>> searches = new ConcurrentHashMap<>();
    FakeCache() { super(null, null, LlmFixtures.OM); }
    @Override public TripPlanResponse readPack(String alias) { return packs.get(alias); }
    @Override public void writePack(List<String> aliases, TripPlanResponse plan) { for (String a : aliases) packs.put(a, plan); }
    @Override public List<List<SearchHit>> readSearch(String norm) { return searches.get(norm); }
    @Override public void writeSearch(String norm, List<List<SearchHit>> groups) { searches.put(norm, groups); }
  }

  /** 한 벌의 가짜와 서비스. */
  static class Rig {
    final AtomicLong clock = new AtomicLong(1_000_000);
    final FakeOllama ollama = new FakeOllama();
    final FakeSearch search;
    final FakeGeo geo = new FakeGeo(clock);
    final FakeCache cache = new FakeCache();
    final TripService svc;
    Rig(String key, long deadlineMs) {
      search = new FakeSearch(key);
      TheworldProps props = LlmFixtures.props("http://127.0.0.1:9", key, "http://127.0.0.1:9", deadlineMs);
      svc = new TripService(ollama, search, geo, cache, props, clock::get);
      // 도심 + 허브 + 장소 (도시 붙인 조회) — 기온만 도시 조회가 없어 나라 재조회로 찾는다
      geo.table.put("Kyoto, JP", TripFixtures.hit(TripFixtures.CENTRE.lat(), TripFixtures.CENTRE.lng()));
      geo.table.putAll(TripFixtures.geo());
      geo.table.values().removeIf(v -> v == null);
    }
    TripPlanResponse plan(String city) { return svc.plan(new TripPlanRequest("small", city)); }
  }

  @Test
  void happyPathAndCacheAliases() {
    Rig r = new Rig("key", 100_000);
    TripPlanResponse out = r.plan("교토");
    assertThat(out.cached()).isFalse();
    assertThat(out.model()).isEqualTo("qwen3.5:9b");
    assertThat(out.city().key()).isEqualTo("kyoto");
    assertThat(out.places().stream().map(TripPlace::id)).contains("kyoto-kansai-international-airport", "kyoto-kyoto-station", "kyoto-kiyomizu-dera", "kyoto-gion", "kyoto-kyoto-tower-hotel");
    assertThat(out.sources()).containsExactly("https://ex.com/kyoto", "https://ex.com/kyoto-transport", "https://ex.com/en");
    assertThat(r.search.calls.get()).isEqualTo(1);
    assertThat(r.ollama.calls.get()).isEqualTo(1);
    assertThat(r.cache.packs.keySet()).containsExactlyInAnyOrder("교토", "kyoto");   // norm(요청)=nameKo → 둘이 같고, key
    assertThat(r.cache.searches).containsKey("교토");

    // 캐시 히트: 검색·모델·지오코딩 없이, cached=true·ms=0
    int geoCalls = r.geo.calls.size();
    TripPlanResponse again = r.plan(" Kyoto ");
    assertThat(again.cached()).isTrue();
    assertThat(again.ms()).isZero();
    assertThat(again.city().key()).isEqualTo("kyoto");
    assertThat(r.search.calls.get()).isEqualTo(1);
    assertThat(r.ollama.calls.get()).isEqualTo(1);
    assertThat(r.geo.calls).hasSize(geoCalls);
  }

  @Test
  void countryLookupOnlyWhenCityLookupIsNull() {
    Rig r = new Rig("key", 100_000);
    // 킨카쿠지의 도시 조회는 삿포로(80km 밖) — 그래도 나라 재조회는 하지 않는다 (결함 4b). 근사값(도심 안)으로 들어간다
    r.geo.table.put(TripAssembler.geoQuery("Kinkaku-ji", "Kyoto", "JP"), TripFixtures.hit(43.06, 141.35));
    r.geo.table.put(TripAssembler.hubQuery("Kinkaku-ji", "JP"), TripFixtures.hit(35.0394, 135.7292));
    TripPlanResponse out = r.plan("교토");
    List<String> countryLookups = r.geo.calls.stream().filter(q -> q.endsWith(", JP") && !q.contains(", Kyoto, JP") && !q.equals("Kyoto, JP")).toList();
    // 허브 2개 + 도시 조회가 null인 장소들(기온·아라시야마 대나무숲)만
    assertThat(countryLookups).containsExactlyInAnyOrder("Kansai International Airport, JP", "Kyoto Station, JP", "Gion, JP", "Arashiyama Bamboo Grove, JP");
    assertThat(r.geo.calls).hasSize(1 + 2 + 9 + 2);   // 도심 + 허브 + 장소 9 + 재조회 2 ≤ 18
    assertThat(r.geo.calls.stream().distinct().count()).isEqualTo(r.geo.calls.size());   // 같은 이름은 한 번만
    TripPlace kinkaku = out.places().stream().filter(p -> p.id().equals("kyoto-kinkaku-ji")).findFirst().orElse(null);
    assertThat(kinkaku).isNotNull();
    assertThat(kinkaku.lat()).isEqualTo(35.0394);   // 근사값(초안의 lat)
  }

  @Test
  void deadlineStopsGeocoding() {
    Rig r = new Rig("key", 100_000);
    r.geo.advanceMs = 30_000;   // 조회마다 30초 — 도심(30) 공항(60) 역(90) 첫 장소(120) 이후는 묻지 않는다
    assertThatThrownBy(() -> r.plan("교토")).isInstanceOf(ThinPlanException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(422));
    assertThat(r.geo.calls).hasSize(4);
    assertThat(r.geo.calls.get(0)).isEqualTo("Kyoto, JP");
    assertThat(r.cache.searches).containsKey("교토");   // 검색 결과는 남는다 — 다음 시도는 검색 한도를 안 쓴다
    assertThat(r.cache.packs).isEmpty();
  }

  @Test
  void zeroDeadlineSkipsAllGeocodingAndUsesApproxCentre() {
    Rig r = new Rig("key", 0);
    assertThatThrownBy(() -> r.plan("교토")).isInstanceOf(ThinPlanException.class);
    assertThat(r.geo.calls).isEmpty();
    assertThat(r.ollama.calls.get()).isEqualTo(1);
    assertThat(r.ollama.lastTimeout).isEqualTo(1);   // 모델 제한 시간도 남은 시간 안으로
  }

  @Test
  void modelTimeoutIsBoundedByDeadline() {
    Rig r = new Rig("key", 100_000);
    r.plan("교토");
    assertThat(r.ollama.lastTimeout).isEqualTo(90_000);
    Rig short1 = new Rig("key", 40_000);
    short1.plan("교토");   // 가짜 시계는 멈춰 있으니 40초 안에 다 된다
    assertThat(short1.ollama.lastTimeout).isEqualTo(40_000);   // 모델 제한 시간(90초)이 데드라인(40초)으로 줄어든다
  }

  @Test
  void noKeyIs503UnlessSearchCached() {
    Rig r = new Rig("", 100_000);
    assertThatThrownBy(() -> r.plan("교토")).isInstanceOf(NoApiKeyException.class).satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(503));
    assertThat(r.ollama.calls.get()).isZero();
    List<SearchHit> h = TripFixtures.hits();
    r.cache.searches.put("교토", List.of(List.of(h.get(0)), List.of(h.get(1)), List.of(h.get(2))));
    assertThat(r.plan("교토").city().key()).isEqualTo("kyoto");   // 캐시된 검색이면 키 없이도 간다
  }

  @Test
  void noResultsAndUnusableModelAre502() {
    Rig r = new Rig("key", 100_000);
    r.search.empty = true;
    assertThatThrownBy(() -> r.plan("교토")).isInstanceOf(ApiException.class).hasMessage("no search results for 교토")
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502));
    assertThat(r.cache.searches).isEmpty();
    Rig r2 = new Rig("key", 100_000);
    r2.ollama.raw = "{\"key\":\"kyoto\",\"country\":\"Japan\"}";
    assertThatThrownBy(() -> r2.plan("교토")).isInstanceOf(ApiException.class).hasMessage("model output unusable for 교토")
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502));
  }

  @Test
  void srcOutsidePromptIsDroppedEndToEnd() {
    // 결함 3: 프롬프트 예산이 아주 작아 [2]·[3]이 빠지면 src 2·3 장소는 초안에서 사라진다
    Rig r = new Rig("key", 100_000);
    TheworldProps tiny = new TheworldProps(new TheworldProps.Cors("x"), new TheworldProps.Ollama("http://127.0.0.1:9", 1_000), new TheworldProps.Models("s", "g"),
      new TheworldProps.Trip("fixed-model", 90_000, 100_000, 200), new TheworldProps.Plan(20_000, 120_000), new TheworldProps.Search("key"), new TheworldProps.Nominatim("http://127.0.0.1:9", "", 0), new TheworldProps.Docs(1), new TheworldProps.Media("build/test-media"));
    TripService svc = new TripService(r.ollama, r.search, r.geo, r.cache, tiny, r.clock::get);
    assertThatThrownBy(() -> svc.plan(new TripPlanRequest("good", "교토"))).isInstanceOf(ThinPlanException.class).hasMessageStartingWith("only 5 places");
    assertThat(svc.modelFor("good")).isEqualTo("fixed-model");
  }

  @Test
  void concurrentSameCityRunsOnce() throws Exception {
    Rig r = new Rig("key", 100_000);
    r.ollama.gate = new CountDownLatch(1);
    List<TripPlanResponse> results = new CopyOnWriteArrayList<>();
    AtomicReference<Throwable> err = new AtomicReference<>();
    List<Thread> ts = new ArrayList<>();
    for (String city : List.of("교토", "교토", " 교토 ")) {
      Thread t = new Thread(() -> { try { results.add(r.plan(city)); } catch (Throwable e) { err.set(e); } });
      t.start();
      ts.add(t);
      // 첫 스레드가 모델 호출 안에서 멈춘 뒤에야 나머지를 보낸다 — 그래야 확실히 진행 중 요청에 합쳐진다
      if (ts.size() == 1) assertThat(r.ollama.entered.await(5, TimeUnit.SECONDS)).isTrue();
    }
    Thread.sleep(100);
    r.ollama.gate.countDown();
    for (Thread t : ts) t.join(5_000);
    assertThat(err.get()).isNull();
    assertThat(results).hasSize(3);
    assertThat(r.ollama.calls.get()).isEqualTo(1);
    assertThat(r.search.calls.get()).isEqualTo(1);
    assertThat(results.stream().map(TripPlanResponse::cached)).containsOnly(false);
    assertThat(results.stream().map(x -> x.city().key()).distinct()).containsExactly("kyoto");
  }
}
