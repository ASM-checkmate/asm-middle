package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import world.theworld.server.trip.TripAssembler.Assembled;
import world.theworld.server.trip.TripDtos.DraftHub;
import world.theworld.server.trip.TripDtos.DraftHubs;
import world.theworld.server.trip.TripDtos.DraftPlace;
import world.theworld.server.trip.TripDtos.GeoHit;
import world.theworld.server.trip.TripDtos.LatLng;
import world.theworld.server.trip.TripDtos.TripDraft;
import world.theworld.server.trip.TripDtos.TripPlace;

/** trip.test.mjs '조립' 13개 이관 + 결함 1 회귀(city-hit 멀고 country-hit 가까움 → geocoded). */
class TripAssemblerTest {
  private final TripDraft draft2 = TripFixtures.draft2();
  private final Map<String, GeoHit> geo = TripFixtures.geo();
  private final Assembled a = TripAssembler.assemble(draft2, geo, TripFixtures.CENTRE);

  private TripPlace byId(List<TripPlace> ps, String id) {
    return ps.stream().filter(p -> p.id().equals(id)).findFirst().orElse(null);
  }

  @Test
  void idsAreKeyPlusSlug() {
    assertThat(a.places().stream().map(TripPlace::id)).contains("kyoto-kiyomizu-dera");
    assertThat(a.places()).allMatch(p -> p.id().startsWith("kyoto-") && p.city().equals("kyoto") && p.country().equals("JP"));
    assertThat(a.places().stream().map(TripPlace::id).distinct().count()).isEqualTo(a.places().size());
  }

  @Test
  void hubsBecomePlacesAndIds() {
    assertThat(a.city().hubs().airport()).isEqualTo("kyoto-kansai-international-airport");
    assertThat(a.city().hubs().station()).isEqualTo("kyoto-kyoto-station");
    assertThat(a.city().hubs().intlAirport()).isEqualTo(a.city().hubs().airport());
    assertThat(a.city().hubs().port()).isNull();
    assertThat(a.city().hubs().hasSubway()).isTrue();
    TripPlace airport = byId(a.places(), "kyoto-kansai-international-airport");
    assertThat(airport.type()).isEqualTo("airport");
    assertThat(airport.emoji()).isEqualTo("✈️");
    assertThat(airport.area()).isEqualTo("교토");
  }

  @Test
  void geocodedCoordinatesUsed() {
    assertThat(byId(a.places(), "kyoto-nishiki-market").lat()).isEqualTo(35.005);
  }

  @Test
  void countryOnlyLookupWhenCityLookupMissing() {
    assertThat(byId(a.places(), "kyoto-gion").lat()).isEqualTo(35.0037);
  }

  @Test
  void approxWhenNotGeocoded() {
    assertThat(byId(a.places(), "kyoto-arashiyama-bamboo-grove").lat()).isEqualTo(35.0094);
  }

  @Test
  void farResultDropped() {
    assertThat(byId(a.places(), "kyoto-philosopher-s-path")).isNull();
  }

  @Test
  void approxOnlyPlacesCappedAtThreePlusHotel() {
    Map<String, GeoHit> onlyHub = new HashMap<>();
    onlyHub.put(TripAssembler.hubQuery("Kansai International Airport", "JP"), geo.get(TripAssembler.hubQuery("Kansai International Airport", "JP")));
    Assembled onlyApprox = TripAssembler.assemble(draft2, onlyHub, TripFixtures.CENTRE);
    assertThat(onlyApprox.places().stream().filter(p -> !p.type().equals("airport") && !p.type().equals("hotel")).count()).isEqualTo(3);
    assertThat(onlyApprox.places()).anyMatch(p -> p.type().equals("hotel"));
  }

  @Test
  void noReachByAbroad() {
    assertThat(a.places()).allMatch(p -> p.reachBy() == null);
  }

  @Test
  void cityInfo() {
    assertThat(a.city().key()).isEqualTo("kyoto");
    assertThat(a.city().nameKo()).isEqualTo("교토");
    assertThat(a.city().nameEn()).isEqualTo("Kyoto");
    assertThat(a.city().tz()).isEqualTo("Asia/Tokyo");
    assertThat(a.city().stayNights()).isEqualTo(2);
    assertThat(a.city().country()).isEqualTo("JP");
  }

  @Test
  void approxCentreIsMedian() {
    TripDraft d = TripFixtures.draft();
    LatLng ac = TripAssembler.approxCentre(d);
    assertThat(ac.lat()).isCloseTo(35.005, within(0.03));
    assertThat(ac.lng()).isCloseTo(135.77, within(0.03));
    TripDraft two = new TripDraft(d.key(), d.nameKo(), d.nameEn(), d.country(), d.tz(), d.stayNights(), d.hasSubway(), d.hubs(), d.places().subList(0, 2));
    assertThat(TripAssembler.approxCentre(two)).isNull();
  }

  @Test
  void haversineSeoulBusan() {
    assertThat(TripAssembler.haversineKm(37.5665, 126.978, 35.1796, 129.0756)).isCloseTo(325, within(5.0));
  }

  @Test
  void hubApproxWithin200km() {
    Map<String, GeoHit> noKansai = new HashMap<>();
    geo.forEach((k, v) -> { if (!k.startsWith("Kansai")) noKansai.put(k, v); });
    TripDraft d = new TripDraft(draft2.key(), draft2.nameKo(), draft2.nameEn(), draft2.country(), draft2.tz(), draft2.stayNights(), draft2.hasSubway(),
      new DraftHubs(draft2.hubs().airport(), null, null), draft2.places());
    Assembled noGeoHub = TripAssembler.assemble(d, noKansai, TripFixtures.CENTRE);
    assertThat(noGeoHub.city().hubs().airport()).isEqualTo("kyoto-kansai-international-airport");
    assertThat(noGeoHub.places().stream().filter(p -> p.type().equals("airport")).findFirst().get().lat()).isEqualTo(34.43);
    assertThat(noGeoHub.city().hubs().station()).isNull();
  }

  @Test
  void domesticWithoutStationIsPlaneOnly() {
    TripDraft domestic = new TripDraft("jindo", "진도", "Jindo", "KR", "Asia/Seoul", draft2.stayNights(), draft2.hasSubway(),
      new DraftHubs(new DraftHub("진도공항", "Jindo Airport", Double.NaN, Double.NaN), null, null), draft2.places());
    Map<String, GeoHit> geoK = new HashMap<>();
    geoK.put(TripAssembler.hubQuery("Jindo Airport", "KR"), new GeoHit(34.5, 126.3, "", "KR"));
    for (DraftPlace p : draft2.places()) geoK.put(TripAssembler.geoQuery(p.nameEn(), "Jindo", "KR"), new GeoHit(34.48, 126.26, "", "KR"));
    Assembled dom = TripAssembler.assemble(domestic, geoK, new LatLng(34.48, 126.26));
    assertThat(dom.places().stream().filter(p -> !p.type().equals("airport"))).allMatch(p -> "plane".equals(p.reachBy()));
    assertThat(dom.city().hubs().station()).isNull();
    assertThat(dom.places().stream().filter(p -> p.type().equals("airport")).findFirst().get().reachBy()).isNull();
  }

  @Test
  void farCityHitDoesNotHideNearCountryHit() {
    // 결함 1: 도시 붙인 조회가 삿포로(80km 밖)라도 나라만 붙인 조회가 교토 안이면 그것을 쓴다 — 지오코딩된 장소로 (근사값 상한을 먹지 않는다)
    Map<String, GeoHit> g = new HashMap<>(geo);
    g.put(TripAssembler.geoQuery("Kinkaku-ji", "Kyoto", "JP"), TripFixtures.hit(43.06, 141.35));   // 삿포로
    g.put(TripAssembler.hubQuery("Kinkaku-ji", "JP"), TripFixtures.hit(35.0394, 135.7292));
    Assembled fixed = TripAssembler.assemble(draft2, g, TripFixtures.CENTRE);
    TripPlace kinkaku = byId(fixed.places(), "kyoto-kinkaku-ji");
    assertThat(kinkaku).isNotNull();
    assertThat(kinkaku.lat()).isEqualTo(35.0394);
    // 근사값만 있는 장소를 셋 넘게 두어도 킨카쿠지는 지오코딩된 것이라 상한에 안 걸린다
    Map<String, GeoHit> sparse = new HashMap<>();
    sparse.put(TripAssembler.geoQuery("Kinkaku-ji", "Kyoto", "JP"), TripFixtures.hit(43.06, 141.35));
    sparse.put(TripAssembler.hubQuery("Kinkaku-ji", "JP"), TripFixtures.hit(35.0394, 135.7292));
    Assembled sparseA = TripAssembler.assemble(draft2, sparse, TripFixtures.CENTRE);
    assertThat(byId(sparseA.places(), "kyoto-kinkaku-ji")).isNotNull();
    assertThat(sparseA.places().stream().filter(p -> !p.type().equals("hotel") && !TripDtos.HUB_TYPES.contains(p.type())).count()).isEqualTo(4);   // 근사 3 + 지오코딩 1
  }

  @Test
  void emojiFallbackAndAreaFallback() {
    TripDraft d = new TripDraft("kyoto", "교토", "Kyoto", "JP", "Asia/Tokyo", 2, false, new DraftHubs(null, null, null),
      List.of(new DraftPlace("가게", "Some Shop", "mall", "", "", 35.0, 135.77, 1)));
    Assembled r = TripAssembler.assemble(d, Map.of(), TripFixtures.CENTRE);
    assertThat(r.places().get(0).emoji()).isEqualTo("🛍️");
    assertThat(r.places().get(0).area()).isEqualTo("교토");
    assertThat(r.city().hubs().hasSubway()).isNull();
    assertThat(r.city().hubs().intlAirport()).isNull();
  }

  @Test
  void duplicateIdsGetSuffix() {
    TripDraft d = new TripDraft("kyoto", "교토", "Kyoto", "JP", "Asia/Tokyo", 2, false, new DraftHubs(null, null, null),
      List.of(new DraftPlace("가게", "Shop", "mall", "", "", 35.0, 135.77, 1), new DraftPlace("가게2", "Shop", "cafe", "", "", 35.0, 135.77, 1)));
    Assembled r = TripAssembler.assemble(d, Map.of(), TripFixtures.CENTRE);
    assertThat(r.places().stream().map(TripPlace::id)).containsExactly("kyoto-shop", "kyoto-shop-2");
  }
}
