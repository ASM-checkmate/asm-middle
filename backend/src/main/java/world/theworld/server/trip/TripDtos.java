package world.theworld.server.trip;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 여행지 찾기 계약의 JSON 모양 (옛 Node 백엔드 contract.ts(커밋 0298e8d)·docs/CONTRACT.md 그대로, ADR-0009). 프런트 sim/types.ts의 Place·CityInfo **복사**.
 * TS의 `?` 필드(reachBy·hubs.*)는 없을 때 키 자체를 뺀다(NON_NULL) — 프런트 validPack이 `hubs.station`이 있으면 string이어야 한다고 본다.
 */
public final class TripDtos {
  private TripDtos() {}

  /** 웹에서 찾은 장소가 가질 수 있는 유형 — 집·친구 집·일터·학교는 여행지에 없다. */
  public static final List<String> TRIP_PLACE_TYPES = List.of(
    "cafe", "restaurant", "park", "gym", "library", "cinema", "mall", "river", "beach", "museum", "arcade", "bar",
    "station", "airport", "port", "temple", "market", "hotel", "stadium", "mountain", "island");
  public static final List<String> HUB_TYPES = List.of("airport", "station", "port");
  /** 모델이 적을 수 있는 장소 유형 — 허브는 hubs 칸에 따로. */
  public static final List<String> NON_HUB_TYPES = TRIP_PLACE_TYPES.stream().filter(t -> !HUB_TYPES.contains(t)).toList();

  /** 검색 결과 한 건 (search.ts SearchHit). */
  public record SearchHit(String title, String url, String content) {}
  /** 지오코딩 결과 (geocode.ts GeoHit). */
  public record GeoHit(double lat, double lng, String displayName, String countryCode) {}
  public record LatLng(double lat, double lng) {}

  // ── 모델 출력(초안) ──
  /** lat/lng는 모르면 NaN. */
  public record DraftHub(String nameKo, String nameEn, double lat, double lng) {}
  public record DraftPlace(String nameKo, String nameEn, String type, String area, String emoji, double lat, double lng, int src) {}
  /** 각 허브는 없으면 null. */
  public record DraftHubs(DraftHub airport, DraftHub station, DraftHub port) {}
  public record TripDraft(String key, String nameKo, String nameEn, String country, String tz, int stayNights, boolean hasSubway, DraftHubs hubs, List<DraftPlace> places) {}

  // ── 팩 ──
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record TripPlace(String id, String name, String type, double lng, double lat, String area, String city, String country, String emoji, String reachBy) {}
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Hubs(String station, String airport, String port, String intlAirport, Boolean hasSubway) {}
  public record CityInfo(String key, String nameKo, String nameEn, String country, String tz, int stayNights, Hubs hubs) {}
  public record TripPlanRequest(String tier, String city) {}
  public record TripPlanResponse(CityInfo city, List<TripPlace> places, List<String> sources, boolean cached, String model, long ms) {}
}
