package world.theworld.server.trip;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import world.theworld.server.trip.TripDtos.CityInfo;
import world.theworld.server.trip.TripDtos.DraftHub;
import world.theworld.server.trip.TripDtos.DraftPlace;
import world.theworld.server.trip.TripDtos.GeoHit;
import world.theworld.server.trip.TripDtos.Hubs;
import world.theworld.server.trip.TripDtos.LatLng;
import world.theworld.server.trip.TripDtos.TripDraft;
import world.theworld.server.trip.TripDtos.TripPlace;

/**
 * 초안 + 좌표 → 도시 팩 (옛 Node 백엔드 trip.ts(커밋 0298e8d) assembleCity). 순수 함수.
 * 좌표 규칙: 도심 80km 안의 지오코딩 결과 > 60km 안의 모델 근사값 > 버림. 허브(공항·역·항구)는 장소로도 만든다 — 프론트의 journey.ts가 그 id로 구간을 짠다.
 * 결함 1 수정: 도시 붙인 조회가 80km 밖이어도 나라만 붙인 조회를 본다 — **후보 둘 중 도심 80km 안인 첫 것**.
 */
public final class TripAssembler {
  private TripAssembler() {}

  /** 도심에서 이보다 먼 지오코딩 결과는 다른 도시의 동명 장소로 본다 (km). */
  public static final double GEO_MAX_KM = 80;
  /** 지오코딩이 없을 때 모델의 근사 좌표를 믿는 반경 (km). */
  public static final double APPROX_MAX_KM = 60;
  /** 허브(공항·역·항구)는 옆 도시일 수 있다 — 도심에서 이 반경 안이면 받는다 (km). */
  public static final double HUB_MAX_KM = 200;
  /** 지오코딩 없이 모델 근사값만으로 들어갈 수 있는 장소 수. 지도에 없는 이름은 대개 지어낸 이름이다 ("교토 시내 카페"). */
  public static final int MAX_APPROX = 3;

  private static final Map<String, String> TYPE_EMOJI = Map.ofEntries(
    Map.entry("cafe", "☕"), Map.entry("restaurant", "🍽️"), Map.entry("park", "🌳"), Map.entry("gym", "🏋️"), Map.entry("library", "📚"),
    Map.entry("cinema", "🎬"), Map.entry("mall", "🛍️"), Map.entry("river", "🌊"), Map.entry("beach", "🏖️"), Map.entry("museum", "🏛️"),
    Map.entry("arcade", "🕹️"), Map.entry("bar", "🍻"), Map.entry("station", "🚄"), Map.entry("airport", "✈️"), Map.entry("port", "⛴️"),
    Map.entry("temple", "⛩️"), Map.entry("market", "🧺"), Map.entry("hotel", "🏨"), Map.entry("stadium", "🏟️"), Map.entry("mountain", "⛰️"),
    Map.entry("island", "🏝️"));
  private static final Map<String, String> HUB_EMOJI = Map.of("airport", "✈️", "station", "🚄", "port", "⛴️");

  public record Assembled(CityInfo city, List<TripPlace> places) {}

  private static final double R = 6371;

  /** 두 점 사이 거리 (km). 프론트 sim/geo.ts와 같은 식. */
  public static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
    double dLat = Math.toRadians(lat2 - lat1), dLng = Math.toRadians(lng2 - lng1);
    double s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  public static double haversineKm(LatLng a, LatLng b) { return haversineKm(a.lat(), a.lng(), b.lat(), b.lng()); }
  static double km(GeoHit g, LatLng c) { return haversineKm(g.lat(), g.lng(), c.lat(), c.lng()); }

  /** 지오코딩할 이름. 영문 이름 + 도시 + 나라 — 동명이인을 줄인다. */
  public static String geoQuery(String nameEn, String cityEn, String country) { return nameEn + ", " + cityEn + ", " + country; }
  /** 허브는 옆 도시일 수 있다 (간사이 공항은 오사카) — 도시를 붙이면 Nominatim이 못 찾으므로 나라만 붙인다. */
  public static String hubQuery(String nameEn, String country) { return nameEn + ", " + country; }

  /** 모델이 적은 장소 근사 좌표들의 중앙값. 셋 미만이면 null. */
  public static LatLng approxCentre(TripDraft d) {
    List<Double> lats = new ArrayList<>(), lngs = new ArrayList<>();
    for (DraftPlace p : d.places()) if (Double.isFinite(p.lat()) && Double.isFinite(p.lng())) { lats.add(p.lat()); lngs.add(p.lng()); }
    if (lats.size() < 3) return null;
    return new LatLng(median(lats), median(lngs));
  }

  private static double median(List<Double> xs) {
    List<Double> s = new ArrayList<>(xs);
    s.sort(Double::compare);
    return s.get(s.size() / 2);
  }

  private record Coord(double lat, double lng, boolean geocoded) {}

  /**
   * @param d 초안
   * @param geo 지오코딩 결과: 조회한 이름 → 좌표(없으면 null)
   * @param centre 도심 좌표 (도시 이름을 지오코딩한 것)
   */
  public static Assembled assemble(TripDraft d, Map<String, GeoHit> geo, LatLng centre) {
    Set<String> ids = new HashSet<>();
    List<TripPlace> places = new ArrayList<>();
    String station = null, airport = null, port = null;
    for (String kind : TripDtos.HUB_TYPES) {
      DraftHub h = switch (kind) { case "airport" -> d.hubs().airport(); case "station" -> d.hubs().station(); default -> d.hubs().port(); };
      if (h == null) continue;
      // 허브는 옆 도시일 수 있다 (교토 → 간사이): 200km 안의 지오코딩 결과, 없으면 200km 안의 모델 근사값, 그것도 없으면 허브 없음
      GeoHit g = geo.get(hubQuery(h.nameEn(), d.country()));
      LatLng c = g != null && km(g, centre) <= HUB_MAX_KM ? new LatLng(g.lat(), g.lng())
        : Double.isFinite(h.lat()) && Double.isFinite(h.lng()) && haversineKm(h.lat(), h.lng(), centre.lat(), centre.lng()) <= HUB_MAX_KM ? new LatLng(h.lat(), h.lng()) : null;
      if (c == null) continue;
      String id = idOf(ids, d.key(), h.nameEn(), kind);
      places.add(new TripPlace(id, h.nameKo(), kind, c.lng(), c.lat(), d.nameKo(), d.key(), d.country(), HUB_EMOJI.get(kind), null));
      switch (kind) { case "airport" -> airport = id; case "station" -> station = id; default -> port = id; }
    }
    Hubs hubs = new Hubs(station, airport, port, airport, d.hasSubway() ? Boolean.TRUE : null);
    // 국내인데 역이 없으면 비행기로만 간다 — 프론트의 tripKind/journey가 같은 판단을 하도록 장소에 적는다
    boolean planeOnly = d.country().equals("KR") && station == null && airport != null;
    // 지도(Nominatim)에 있는 장소가 먼저다. 근사값만 있는 장소는 몇 개까지만 — 지도에 없는 이름은 대개 지어낸 이름이다
    int approx = 0;
    for (DraftPlace p : d.places()) {
      Coord c = coord(d, geo, centre, p);
      if (c == null) continue;
      // 호텔은 상한에서 뺀다 — 팩에 꼭 하나 있어야 하고, 작은 숙소는 지도에 없는 일이 흔하다
      if (!c.geocoded() && !p.type().equals("hotel") && ++approx > MAX_APPROX) continue;
      String emoji = !p.emoji().isEmpty() ? p.emoji() : TYPE_EMOJI.getOrDefault(p.type(), "📍");
      places.add(new TripPlace(idOf(ids, d.key(), p.nameEn(), p.type()), p.nameKo(), p.type(), c.lng(), c.lat(),
        !p.area().isEmpty() ? p.area() : d.nameKo(), d.key(), d.country(), emoji, planeOnly ? "plane" : null));
    }
    CityInfo city = new CityInfo(d.key(), d.nameKo(), d.nameEn(), d.country(), d.tz(), d.stayNights(), hubs);
    return new Assembled(city, places);
  }

  /** 도시 붙인 조회, 나라만 붙인 조회 — 둘 중 도심 반경 안인 첫 것 (결함 1). 없으면 60km 안 근사값, 그것도 없으면 null. */
  private static Coord coord(TripDraft d, Map<String, GeoHit> geo, LatLng centre, DraftPlace p) {
    for (String q : List.of(geoQuery(p.nameEn(), d.nameEn(), d.country()), hubQuery(p.nameEn(), d.country()))) {
      GeoHit g = geo.get(q);
      if (g != null && km(g, centre) <= GEO_MAX_KM) return new Coord(g.lat(), g.lng(), true);
    }
    if (Double.isFinite(p.lat()) && Double.isFinite(p.lng()) && haversineKm(p.lat(), p.lng(), centre.lat(), centre.lng()) <= APPROX_MAX_KM) return new Coord(p.lat(), p.lng(), false);
    return null;
  }

  /** `${key}-${slugify(nameEn) || fallback}`, 겹치면 -2, -3… */
  private static String idOf(Set<String> ids, String key, String nameEn, String fallback) {
    String slug = TripDraftParser.slugify(nameEn);
    String base = key + "-" + (slug.isEmpty() ? fallback : slug);
    String id = base;
    for (int n = 2; ids.contains(id); n++) id = base + "-" + n;
    ids.add(id);
    return id;
  }
}
