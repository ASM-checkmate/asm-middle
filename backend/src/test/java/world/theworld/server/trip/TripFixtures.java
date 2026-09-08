package world.theworld.server.trip;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import world.theworld.server.trip.TripDtos.GeoHit;
import world.theworld.server.trip.TripDtos.LatLng;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripDtos.TripDraft;

/** 옛 Node 백엔드 scripts/trip.test.mjs(커밋 0298e8d)의 고정 데이터 — 교토 검색 결과·모델 초안·지오코딩 표. */
public final class TripFixtures {
  private TripFixtures() {}

  public static final ObjectMapper OM = new ObjectMapper();

  /** trip.test.mjs:24-28 */
  public static List<SearchHit> hits() {
    return List.of(
      new SearchHit("교토 여행 가볼 만한 곳 10", "https://ex.com/kyoto", "기요미즈데라(Kiyomizu-dera), 후시미 이나리 신사(Fushimi Inari), 니시키 시장(Nishiki Market), 아라시야마 대나무숲, 교토 타워 호텔"),
      new SearchHit("교토 교통", "https://ex.com/kyoto-transport", "간사이 국제공항(Kansai International Airport)에서 하루카로 교토역(Kyoto Station)까지 75분. 시영 지하철 두 노선."),
      new SearchHit("Kyoto travel guide", "https://ex.com/en", "Gion, Kinkaku-ji, Philosopher's Path, % Arabica Arashiyama cafe, Kyoto Tower Hotel"));
  }

  /** trip.test.mjs:38-57 — 14개 초안 (중복 이름·둘째 호텔·범위 밖 src·틀린 유형·허브 유형 포함). */
  public static final String DRAFT_JSON = """
    {"key":"Kyoto","nameKo":"교토","nameEn":"Kyoto","country":"jp","tz":"Asia/Tokyo","stayNights":2,"hasSubway":true,
     "hubs":{"airport":{"nameKo":"간사이 국제공항","nameEn":"Kansai International Airport (KIX)","lat":34.43,"lng":135.24},"station":{"nameKo":"교토역","nameEn":"Kyoto Station"},"port":null},
     "places":[
      {"nameKo":"기요미즈데라","nameEn":"Kiyomizu-dera","type":"temple","area":"히가시야마","emoji":"⛩️","lat":34.9949,"lng":135.785,"src":1},
      {"nameKo":"후시미 이나리","nameEn":"Fushimi Inari Taisha","type":"temple","area":"후시미","emoji":"⛩️","lat":34.9671,"lng":135.7727,"src":1},
      {"nameKo":"니시키 시장","nameEn":"Nishiki Market","type":"market","area":"나카교","emoji":"🍢","lat":35.005,"lng":135.765,"src":1},
      {"nameKo":"니시키 시장","nameEn":"Nishiki Ichiba","type":"market","area":"나카교","emoji":"🍢","lat":35.005,"lng":135.765,"src":1},
      {"nameKo":"아라시야마 대나무숲","nameEn":"Arashiyama Bamboo Grove","type":"park","area":"아라시야마","emoji":"🎋","lat":35.0094,"lng":135.6722,"src":1},
      {"nameKo":"킨카쿠지","nameEn":"Kinkaku-ji","type":"museum","area":"기타","emoji":"🏯","lat":35.0394,"lng":135.7292,"src":3},
      {"nameKo":"아라비카 아라시야마","nameEn":"% Arabica Arashiyama","type":"cafe","area":"아라시야마","emoji":"☕","lat":35.0136,"lng":135.6778,"src":3},
      {"nameKo":"기온","nameEn":"Gion","type":"market","area":"기온","emoji":"🏮","lat":35.0037,"lng":135.7751,"src":3},
      {"nameKo":"철학의 길","nameEn":"Philosopher's Path","type":"park","area":"사쿄","emoji":"🌸","lat":35.0263,"lng":135.7947,"src":3},
      {"nameKo":"교토 타워 호텔","nameEn":"Kyoto Tower Hotel","type":"hotel","area":"교토역","emoji":"🏨","lat":34.9875,"lng":135.7593,"src":1},
      {"nameKo":"두 번째 호텔","nameEn":"Second Hotel","type":"hotel","area":"기온","emoji":"🏨","lat":35.0,"lng":135.77,"src":3},
      {"nameKo":"지어낸 곳","nameEn":"Made Up","type":"bar","area":"?","emoji":"🍻","lat":35.0,"lng":135.77,"src":9},
      {"nameKo":"유형 틀림","nameEn":"Bad Type","type":"office","area":"?","emoji":"💼","lat":35.0,"lng":135.77,"src":2},
      {"nameKo":"허브 유형","nameEn":"Kyoto Station","type":"station","area":"?","emoji":"🚄","lat":34.9858,"lng":135.7588,"src":2}
     ]}
    """;

  /** 초안 JSON의 최상위 필드 하나를 바꾼 것 (`{ ...draftJson, key: '교토!' }`). */
  public static String draftWith(String field, String jsonValue) throws Exception {
    var node = (com.fasterxml.jackson.databind.node.ObjectNode) OM.readTree(DRAFT_JSON);
    node.set(field, OM.readTree(jsonValue));
    return OM.writeValueAsString(node);
  }

  public static TripDraft draft() {
    return TripDraftParser.parse(DRAFT_JSON, 3);
  }

  /** 철학의 길의 근사 좌표를 NaN으로 (trip.test.mjs:86 draft2). */
  public static TripDraft draft2() {
    TripDraft d = draft();
    List<TripDtos.DraftPlace> ps = new ArrayList<>();
    for (TripDtos.DraftPlace p : d.places()) ps.add(p.nameEn().equals("Philosopher's Path") ? new TripDtos.DraftPlace(p.nameKo(), p.nameEn(), p.type(), p.area(), p.emoji(), Double.NaN, Double.NaN, p.src()) : p);
    return new TripDraft(d.key(), d.nameKo(), d.nameEn(), d.country(), d.tz(), d.stayNights(), d.hasSubway(), d.hubs(), ps);
  }

  public static final LatLng CENTRE = new LatLng(35.0116, 135.7681);

  public static GeoHit hit(double lat, double lng) { return new GeoHit(lat, lng, "", "JP"); }

  /** trip.test.mjs:72-85 지오코딩 표. */
  public static Map<String, GeoHit> geo() {
    Map<String, GeoHit> geo = new HashMap<>();
    geo.put(TripAssembler.hubQuery("Kansai International Airport", "JP"), hit(34.4347, 135.2440));   // 도심 100km — 허브는 200km까지
    geo.put(TripAssembler.hubQuery("Kyoto Station", "JP"), hit(34.9858, 135.7588));
    city(geo, "Kiyomizu-dera", 34.9949, 135.7850);
    city(geo, "Fushimi Inari Taisha", 34.9671, 135.7727);
    city(geo, "Nishiki Market", 35.0050, 135.7650);
    geo.put(TripAssembler.geoQuery("Arashiyama Bamboo Grove", "Kyoto", "JP"), null);   // 지오코딩 실패 → 모델 근사값
    city(geo, "Kinkaku-ji", 35.0394, 135.7292);
    city(geo, "% Arabica Arashiyama", 35.0136, 135.6778);
    city(geo, "Philosopher's Path", 43.0, 141.0);   // 다른 도시의 동명 → 버림 (근사값도 없다)
    geo.put(TripAssembler.hubQuery("Gion", "JP"), hit(35.0037, 135.7751));   // 도시 붙이면 없고 나라만 붙이면 있다
    geo.put(TripAssembler.geoQuery("Gion", "Kyoto", "JP"), null);
    city(geo, "Kyoto Tower Hotel", 34.9875, 135.7593);
    return geo;
  }

  static void city(Map<String, GeoHit> geo, String nameEn, double lat, double lng) {
    geo.put(TripAssembler.geoQuery(nameEn, "Kyoto", "JP"), hit(lat, lng));
  }
}
