package world.theworld.server.trip;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.Normalizer;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import world.theworld.server.llm.Text;
import world.theworld.server.trip.TripDtos.DraftHub;
import world.theworld.server.trip.TripDtos.DraftHubs;
import world.theworld.server.trip.TripDtos.DraftPlace;
import world.theworld.server.trip.TripDtos.TripDraft;

/**
 * 모델 출력을 다듬는다 (옛 Node 백엔드 trip.ts(커밋 0298e8d) parseTripDraft). 순수 함수. 근거 번호가 프롬프트에 없거나 유형이 틀린 장소는 버리고, 이름이 겹치면
 * 앞 것만, 호텔은 첫 하나만 남긴다. 도시 자체가 틀렸으면(키·나라·시간대) null.
 * 결함 3 수정: src는 hits.length가 아니라 프롬프트에 **실제로 들어간 번호 집합**으로 검사한다.
 */
public final class TripDraftParser {
  private TripDraftParser() {}

  private static final ObjectMapper OM = new ObjectMapper();
  private static final Pattern SLUG_RE = Pattern.compile("^[a-z][a-z0-9-]{1,30}$");
  private static final Pattern COUNTRY_RE = Pattern.compile("^[A-Z]{2}$");
  /** JS 원본이 떼는 결합 문자 범위 U+0300–U+036F — \p{M} 전체가 아니다(id가 프런트 저장본에 박히므로 파리티 유지). */
  private static final Pattern COMBINING = Pattern.compile("[\\u0300-\\u036F]");
  private static final Pattern NON_ALNUM = Pattern.compile("[^a-z0-9]+");
  private static final Pattern EDGE_DASH = Pattern.compile("^-+|-+$");
  private static final Pattern PAREN = Pattern.compile("\\s*\\([^)]*\\)", Pattern.UNICODE_CHARACTER_CLASS);
  /** IANA 시간대만 — ZoneId.of()는 '+09:00' 같은 오프셋도 받아 프런트(Intl)보다 관대하다. */
  private static final Set<String> ZONES = ZoneId.getAvailableZoneIds();

  /** "Kiyomizu-dera Temple" → "kiyomizu-dera-temple". 로마자가 아니면 빈 문자열. */
  public static String slugify(String s) {
    String t = COMBINING.matcher(Normalizer.normalize(s, Normalizer.Form.NFKD)).replaceAll("").toLowerCase(Locale.ROOT);
    t = EDGE_DASH.matcher(NON_ALNUM.matcher(t).replaceAll("-")).replaceAll("");
    return Text.cut(t, 40);
  }

  static boolean isTz(JsonNode tz) {
    return tz != null && tz.isTextual() && !tz.asText().isEmpty() && ZONES.contains(tz.asText());
  }

  /** `typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''` */
  static String str(JsonNode v) {
    return v != null && v.isTextual() ? Text.collapse(v.asText()) : "";
  }

  /** 지오코딩용 이름 — "Kansai International Airport (KIX)"의 괄호는 Nominatim을 헷갈리게 한다. */
  static String nameForGeo(JsonNode v) {
    return Text.collapse(PAREN.matcher(str(v)).replaceAll(""));
  }

  static double finiteOrNaN(JsonNode v) {
    return v != null && v.isNumber() && Double.isFinite(v.doubleValue()) ? v.doubleValue() : Double.NaN;
  }

  /** JS `Number.isInteger` — 3.0도 정수다. */
  static Integer integer(JsonNode v) {
    if (v == null || !v.isNumber()) return null;
    double d = v.doubleValue();
    return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) < Integer.MAX_VALUE ? (int) d : null;
  }

  private static DraftHub hub(JsonNode v) {
    if (v == null || !v.isObject()) return null;
    String nk = str(v.get("nameKo")), ne = nameForGeo(v.get("nameEn"));
    return !nk.isEmpty() && !ne.isEmpty() ? new DraftHub(nk, ne, finiteOrNaN(v.get("lat")), finiteOrNaN(v.get("lng"))) : null;
  }

  /** 번호 1..hitCount 전부가 들어간 경우 (원본 시그니처). */
  public static TripDraft parse(String raw, int hitCount) {
    return parse(raw, IntStream.rangeClosed(1, hitCount).boxed().collect(Collectors.toSet()));
  }

  /**
   * @param raw 모델 출력
   * @param included 프롬프트에 실제로 들어간 결과 번호들 (src의 허용 집합)
   */
  public static TripDraft parse(String raw, Set<Integer> included) {
    JsonNode o;
    try { o = OM.readTree(raw); }
    catch (Exception e) { return null; }
    if (o == null || !o.isObject()) return null;
    String nameEn = str(o.get("nameEn"));
    String key = str(o.get("key")).toLowerCase(Locale.ROOT);
    if (!SLUG_RE.matcher(key).matches()) key = slugify(nameEn);
    if (!SLUG_RE.matcher(key).matches()) return null;
    String country = str(o.get("country")).toUpperCase(Locale.ROOT);
    if (!COUNTRY_RE.matcher(country).matches() || !isTz(o.get("tz"))) return null;
    String nameKo = str(o.get("nameKo"));
    if (nameKo.isEmpty()) return null;
    JsonNode hubs0 = o.get("hubs");
    if (hubs0 == null || !hubs0.isObject()) hubs0 = OM.createObjectNode();
    List<DraftPlace> places = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    boolean hotel = false;
    JsonNode arr = o.get("places");
    if (arr != null && arr.isArray()) {
      for (JsonNode p : arr) {
        if (!p.isObject()) continue;
        String nk = str(p.get("nameKo")), ne = nameForGeo(p.get("nameEn"));
        String type = str(p.get("type"));
        if (nk.isEmpty() || ne.isEmpty() || !TripDtos.TRIP_PLACE_TYPES.contains(type) || TripDtos.HUB_TYPES.contains(type)) continue;
        Integer src = integer(p.get("src"));
        if (src == null || src < 1 || !included.contains(src)) continue;
        String dup = nk.toLowerCase(Locale.ROOT);
        if (seen.contains(dup)) continue;
        if (type.equals("hotel")) { if (hotel) continue; hotel = true; }
        seen.add(dup);
        places.add(new DraftPlace(nk, ne, type, str(p.get("area")), Text.cut(str(p.get("emoji")), 4), finiteOrNaN(p.get("lat")), finiteOrNaN(p.get("lng")), src));
        if (places.size() >= 14) break;
      }
    }
    JsonNode sn = o.get("stayNights");
    int stayNights = sn != null && sn.isNumber() && Double.isFinite(sn.doubleValue())
      ? (int) Math.max(0, Math.min(5, Math.round(sn.doubleValue())))
      : (country.equals("KR") ? 1 : 2);
    JsonNode hs = o.get("hasSubway");
    return new TripDraft(key, nameKo, nameEn, country, o.get("tz").asText(), stayNights, hs != null && hs.isBoolean() && hs.booleanValue(),
      new DraftHubs(hub(hubs0.get("airport")), hub(hubs0.get("station")), hub(hubs0.get("port"))), places);
  }
}
