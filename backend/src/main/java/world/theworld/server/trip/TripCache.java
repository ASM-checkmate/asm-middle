package world.theworld.server.trip;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.llm.Text;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripDtos.TripPlanResponse;

/**
 * 같은 도시를 두 번 검색하지 않는다 — 검색 한도와 지오코딩 정책 둘 다를 위해 (옛 Node 백엔드 trip.ts(커밋 0298e8d) 캐시 절). Node의 파일(.cache/trip) 대신
 * trip_pack/trip_search 테이블 — 모든 사용자가 공유하는 도시별 정본이다. 읽기·쓰기 실패는 호출자(TripService)가 최선 노력으로 삼킨다.
 */
@Service
public class TripCache {
  private static final TypeReference<List<List<SearchHit>>> GROUPS = new TypeReference<>() {};

  private final TripPackRepository packs;
  private final TripSearchRepository searches;
  private final ObjectMapper om;

  public TripCache(TripPackRepository packs, TripSearchRepository searches, ObjectMapper om) {
    this.packs = packs;
    this.searches = searches;
    this.om = om;
  }

  /** 요청 도시명의 정규화 — "교토"/"Kyoto "/"kyoto"가 같은 칸을 본다. */
  public static String normCity(String s) {
    return Text.collapse(Normalizer.normalize(s, Normalizer.Form.NFC)).toLowerCase(Locale.ROOT);
  }

  /** 팩 — 없거나 모양이 아니면 null. cached/ms는 호출자가 바꿔 단다. */
  @Transactional(readOnly = true)
  public TripPlanResponse readPack(String alias) {
    return packs.findById(alias).map(p -> {
      try {
        TripPlanResponse r = om.readValue(p.getBody(), TripPlanResponse.class);
        return r != null && r.city() != null && r.city().key() != null && r.places() != null ? r : null;
      } catch (Exception e) {
        return null;
      }
    }).orElse(null);
  }

  /** 세 별칭(요청 정규화·nameKo·key)에 같은 팩을 쓴다. 있으면 덮는다. */
  @Transactional
  public void writePack(List<String> aliases, TripPlanResponse plan) {
    String body;
    try { body = om.writeValueAsString(plan); }
    catch (Exception e) { throw new IllegalStateException("json write", e); }
    long now = System.currentTimeMillis();
    for (String a : aliases) packs.save(new TripPack(a, plan.city().key(), body, now));
  }

  /** 검색 결과 (검색어별 묶음) — 없거나 비었거나 모양이 아니면 null. */
  @Transactional(readOnly = true)
  public List<List<SearchHit>> readSearch(String norm) {
    return searches.findById(norm).map(s -> {
      try {
        List<List<SearchHit>> g = om.readValue(s.getBody(), GROUPS);
        return g != null && g.stream().anyMatch(x -> x != null && !x.isEmpty()) ? g : null;
      } catch (Exception e) {
        return null;
      }
    }).orElse(null);
  }

  @Transactional
  public void writeSearch(String norm, List<List<SearchHit>> groups) {
    String body;
    try { body = om.writeValueAsString(groups); }
    catch (Exception e) { throw new IllegalStateException("json write", e); }
    searches.save(new TripSearch(norm, body, System.currentTimeMillis()));
  }
}
