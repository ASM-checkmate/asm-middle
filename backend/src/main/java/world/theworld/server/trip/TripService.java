package world.theworld.server.trip;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.ModelLane;
import world.theworld.server.llm.OllamaCancelledException;
import world.theworld.server.llm.OllamaClient;
import world.theworld.server.trip.TripAssembler.Assembled;
import world.theworld.server.trip.TripDtos.DraftHub;
import world.theworld.server.trip.TripDtos.DraftPlace;
import world.theworld.server.trip.TripDtos.GeoHit;
import world.theworld.server.trip.TripDtos.LatLng;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripDtos.TripDraft;
import world.theworld.server.trip.TripDtos.TripPlace;
import world.theworld.server.trip.TripDtos.TripPlanRequest;
import world.theworld.server.trip.TripDtos.TripPlanResponse;
import world.theworld.server.trip.TripPrompt.Built;

/**
 * 여행지 찾기 파이프라인 (옛 Node 백엔드 trip.ts(커밋 0298e8d) planTrip, ADR-0009). "교토 가자"에 대해 도시 팩(도시 정보 + 장소들)을 만든다. 고정 파이프라인이다:
 *   검색 3회(병렬) → 모델 1회(JSON 스키마로 추출) → 지오코딩(순차) → 조립·검증 → 캐시.
 * 모델은 검색 스니펫에 있는 장소만 적고 근거 번호(src)를 단다. 좌표는 Nominatim이 정하고, 도심에서 너무 먼 결과는 버린다.
 * "언제 무엇을 하는가"는 여기서 정하지 않는다 — 프론트의 규칙 엔진이 한다.
 * 결함 4 수정: 요청 전체 데드라인(theworld.trip.deadline-ms, 기본 100초). 지오코딩은 데드라인까지만 — 남은 장소는 근사값/버림. 나라만 붙인 재조회는
 * 도시 붙인 조회가 null일 때만(80km 밖이면 생략) — 최대 32회가 ≤18회로 준다. 같은 도시의 동시 요청은 하나로 합친다(inflight).
 * 오래 걸리므로 @Transactional을 두지 않는다 — 캐시 읽기·쓰기만 TripCache가 짧은 트랜잭션으로.
 */
@Service
public class TripService {
  private static final Logger log = LoggerFactory.getLogger(TripService.class);
  /** 여행지 추출 생성 옵션 (trip.ts:337). */
  public static final double TEMPERATURE = 0.2;
  public static final int NUM_PREDICT = 2500;
  /** 근거 URL은 여기까지. */
  static final int MAX_SOURCES = 24;

  private final OllamaClient ollama;
  private final SearchClient search;
  private final NominatimClient geocoder;
  private final TripCache cache;
  private final TheworldProps props;
  private final LongSupplier clock;
  private final ModelLane lane;
  private final ConcurrentHashMap<String, CompletableFuture<TripPlanResponse>> inflight = new ConcurrentHashMap<>();

  @Autowired
  public TripService(OllamaClient ollama, SearchClient search, NominatimClient geocoder, TripCache cache, TheworldProps props, ModelLane lane) {
    this(ollama, search, geocoder, cache, props, System::currentTimeMillis, lane);
  }

  /** 시계를 직접 — 데드라인 테스트용. 차선은 제 것을 쓴다. */
  public TripService(OllamaClient ollama, SearchClient search, NominatimClient geocoder, TripCache cache, TheworldProps props, LongSupplier clock) {
    this(ollama, search, geocoder, cache, props, clock, new ModelLane());
  }

  public TripService(OllamaClient ollama, SearchClient search, NominatimClient geocoder, TripCache cache, TheworldProps props, LongSupplier clock, ModelLane lane) {
    this.lane = lane;
    this.ollama = ollama;
    this.search = search;
    this.geocoder = geocoder;
    this.cache = cache;
    this.props = props;
    this.clock = clock;
  }

  /** 여행지 추출 모델. 요청의 tier를 따르되 TRIP_MODEL이 있으면 그것으로 고정한다 (server.ts tripConfig). */
  String modelFor(String tier) {
    String fixed = props.trip().model();
    if (fixed != null && !fixed.isBlank()) return fixed.strip();
    return tier.equals("good") ? props.models().good() : props.models().small();
  }

  /**
   * 도시 팩 하나를 만든다 (캐시되면 즉시). 같은 도시(정규화 기준)의 진행 중 요청이 있으면 그 결과를 같이 받는다.
   *
   * @throws ApiException 503 키 없음 · 422 얇은 팩 · 502 검색/모델/지오코딩 실패
   */
  public TripPlanResponse plan(TripPlanRequest req) {
    String norm = TripCache.normCity(req.city());
    CompletableFuture<TripPlanResponse> mine = new CompletableFuture<>();
    CompletableFuture<TripPlanResponse> running = inflight.putIfAbsent(norm, mine);
    if (running != null) return join(running);
    try {
      TripPlanResponse out = run(req, norm);
      mine.complete(out);
      return out;
    } catch (Throwable t) {
      // Error(OOM·StackOverflow)도 완료시킨다 — 안 그러면 같은 도시로 들어와 join 중인 요청 스레드가 영원히 기다린다
      mine.completeExceptionally(t);
      throw t;
    } finally {
      inflight.remove(norm, mine);
    }
  }

  private static TripPlanResponse join(CompletableFuture<TripPlanResponse> f) {
    try {
      return f.join();
    } catch (CompletionException e) {
      Throwable c = e.getCause();
      if (c instanceof RuntimeException r) throw r;
      throw new ApiException(502, c == null ? "trip failed" : String.valueOf(c.getMessage()));
    }
  }

  private TripPlanResponse run(TripPlanRequest req, String norm) {
    TripPlanResponse cached = readPack(norm);
    if (cached != null) return new TripPlanResponse(cached.city(), cached.places(), cached.sources(), true, cached.model(), 0);
    long t0 = clock.getAsLong();
    long deadline = t0 + props.trip().deadlineMs();
    try {
      List<List<SearchHit>> groups = searchCached(norm, req.city());
      List<SearchHit> hits = TripPrompt.roundRobin(groups);
      if (hits.isEmpty()) throw new ApiException(502, "no search results for " + req.city());
      String model = modelFor(req.tier());
      Built p = TripPrompt.build(req.city(), hits, props.trip().snippetsMaxChars());
      long modelTimeout = Math.max(1, Math.min(props.trip().modelTimeoutMs(), deadline - clock.getAsLong()));
      // 낮은 우선순위 — 통화 턴이 오면 끊긴다 (ModelLane, ADR-0011 결정 6). 끊기면 503 'yielded to call'
      OllamaClient.Cancel cancel = lane.lowPriority();
      String raw;
      try { raw = ollama.chatJson(model, p.system(), p.user(), TripPrompt.TRIP_SCHEMA, null, TEMPERATURE, NUM_PREDICT, modelTimeout, cancel); }
      catch (OllamaCancelledException e) { throw new ApiException(503, "yielded to call"); }
      finally { lane.release(cancel); }
      TripDraft draft = TripDraftParser.parse(raw, p.included());
      if (draft == null) throw new ApiException(502, "model output unusable for " + req.city());
      log.info("[trip] {} draft {} {} {} places (hotel {}) hubs {}", req.city(), draft.key(), draft.country(), draft.places().size(),
        draft.places().stream().anyMatch(x -> x.type().equals("hotel")) ? "yes" : "no", hubsSummary(draft));
      // 도심: 지오코딩이 먼저, 안 되면 모델이 적은 근사 좌표들의 중앙값 (한 번의 실패로 검색·추출을 버리지 않게)
      GeoHit cityHit = geocode(draft.nameEn() + ", " + draft.country(), deadline);
      LatLng centre = cityHit != null ? new LatLng(cityHit.lat(), cityHit.lng()) : TripAssembler.approxCentre(draft);
      if (centre == null) throw new ApiException(502, "cannot geocode city " + draft.nameEn());
      Map<String, GeoHit> geo = new HashMap<>();
      for (DraftHub h : new DraftHub[] { draft.hubs().airport(), draft.hubs().station(), draft.hubs().port() }) {
        if (h != null) lookup(geo, TripAssembler.hubQuery(h.nameEn(), draft.country()), deadline);
      }
      for (DraftPlace pl : draft.places()) {
        GeoHit g = lookup(geo, TripAssembler.geoQuery(pl.nameEn(), draft.nameEn(), draft.country()), deadline);
        // 도시를 붙여서 못 찾았을 때만 나라만 붙여 한 번 더 (반경 검사는 조립에서 — 결함 1·4)
        if (g == null) lookup(geo, TripAssembler.hubQuery(pl.nameEn(), draft.country()), deadline);
      }
      Assembled a = TripAssembler.assemble(draft, geo, centre);
      Set<String> kept = new LinkedHashSet<>(a.places().stream().map(TripPlace::name).toList());
      List<String> dropped = draft.places().stream().filter(x -> !kept.contains(x.nameKo())).map(x -> x.nameKo() + "(" + x.nameEn() + ")").toList();
      if (!dropped.isEmpty()) log.info("[trip] {} dropped {}: {}", req.city(), dropped.size(), String.join(", ", dropped));
      TripValidator.validate(a.city(), a.places());
      List<String> sources = new ArrayList<>(new LinkedHashSet<>(hits.stream().map(SearchHit::url).toList()));
      if (sources.size() > MAX_SOURCES) sources = new ArrayList<>(sources.subList(0, MAX_SOURCES));
      TripPlanResponse plan = new TripPlanResponse(a.city(), a.places(), sources, false, model, clock.getAsLong() - t0);
      writePack(List.of(norm, TripCache.normCity(a.city().nameKo()), a.city().key()), plan);
      return plan;
    } catch (ApiException e) {
      throw e;
    } catch (RuntimeException e) {
      log.warn("[trip] {} pipeline failed", req.city(), e);
      throw new ApiException(502, e.getMessage() == null ? e.toString() : e.getMessage());
    }
  }

  private static String hubsSummary(TripDraft d) {
    List<String> parts = new ArrayList<>();
    if (d.hubs().airport() != null) parts.add("airport=" + d.hubs().airport().nameEn());
    if (d.hubs().station() != null) parts.add("station=" + d.hubs().station().nameEn());
    if (d.hubs().port() != null) parts.add("port=" + d.hubs().port().nameEn());
    return parts.isEmpty() ? "none" : String.join(", ", parts);
  }

  /** 검색 결과 — 캐시가 있으면 키 없이도 간다. 없으면 검색 3회(병렬) 후 결과가 있을 때만 남긴다. */
  private List<List<SearchHit>> searchCached(String norm, String city) {
    List<List<SearchHit>> groups = null;
    try { groups = cache.readSearch(norm); }
    catch (RuntimeException e) { log.warn("[trip] search cache read failed: {}", e.getMessage()); }
    if (groups != null) return groups;
    groups = search.searchAll(city);
    if (groups.stream().anyMatch(g -> !g.isEmpty())) {
      try { cache.writeSearch(norm, groups); }
      catch (RuntimeException e) { log.warn("[trip] search cache write failed: {}", e.getMessage()); }
    }
    return groups;
  }

  private TripPlanResponse readPack(String alias) {
    try { return cache.readPack(alias); }
    catch (RuntimeException e) { log.warn("[trip] cache read failed: {}", e.getMessage()); return null; }
  }

  private void writePack(List<String> aliases, TripPlanResponse plan) {
    try { cache.writePack(aliases, plan); }
    catch (RuntimeException e) { log.warn("[trip] cache write failed: {}", e.getMessage()); }
  }

  /** 같은 이름은 한 번만 묻는다. 값이 null이어도 "물어봤다"로 남긴다. */
  private GeoHit lookup(Map<String, GeoHit> geo, String q, long deadline) {
    if (geo.containsKey(q)) return geo.get(q);
    GeoHit g = geocode(q, deadline);
    geo.put(q, g);
    return g;
  }

  /** 데드라인이 지났으면 묻지 않는다 — 조립이 근사값/버림으로 처리한다 (결함 4). */
  private GeoHit geocode(String q, long deadline) {
    long left = deadline - clock.getAsLong();
    if (left <= 0) {
      log.info("[trip] deadline passed — skip geocode \"{}\"", q);
      return null;
    }
    return geocoder.geocode(q, left);
  }
}
