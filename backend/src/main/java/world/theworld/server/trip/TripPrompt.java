package world.theworld.server.trip;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import world.theworld.server.llm.Schema;
import world.theworld.server.trip.TripDtos.SearchHit;

/**
 * 여행지 추출 프롬프트·스키마 (옛 Node 백엔드 trip.ts(커밋 0298e8d) 글자 그대로, ADR-0009). 모델은 검색 스니펫에 있는 장소만 적고 근거 번호(src)를 단다.
 * 결함 2·3 수정: 히트는 검색어별 라운드로빈으로 섞어 넣고(영어 검색 결과가 잘리지 않게), 예산(theworld.trip.snippets-max-chars, 기본 22_000)에
 * 걸려 빠진 번호를 파서가 알도록 **실제로 들어간 번호 집합**을 돌려준다.
 */
public final class TripPrompt {
  private TripPrompt() {}

  /** 스니펫이 프롬프트에 들어가는 최대 길이 (문자). 세 검색 × 여덟 결과 ≈ 17K가 다 들어가는 크기 — 9B의 32K 컨텍스트 안이다. */
  public static final int DEFAULT_SNIPPETS_MAX_CHARS = 22_000;

  private static final Map<String, Object> STR = Map.of("type", "string");
  private static final Map<String, Object> NUM = Map.of("type", "number");
  private static final Map<String, Object> HUB_SCHEMA = Schema.of(
    "type", java.util.Arrays.asList("object", null),
    "properties", Schema.of("nameKo", STR, "nameEn", STR, "lat", NUM, "lng", NUM),
    "required", List.of("nameKo", "nameEn", "lat", "lng"));

  /** 모델에게 강제하는 응답 형식 (Ollama structured output). */
  public static final Map<String, Object> TRIP_SCHEMA = Collections.unmodifiableMap(Schema.of(
    "type", "object",
    "properties", Schema.of(
      "key", STR, "nameKo", STR, "nameEn", STR, "country", STR, "tz", STR,
      "stayNights", Schema.of("type", "integer", "minimum", 0, "maximum", 5),
      "hasSubway", Schema.of("type", "boolean"),
      "hubs", Schema.of("type", "object", "properties", Schema.of("airport", HUB_SCHEMA, "station", HUB_SCHEMA, "port", HUB_SCHEMA), "required", List.of("airport", "station", "port")),
      "places", Schema.of(
        "type", "array", "minItems", 6, "maxItems", 14,
        "items", Schema.of(
          "type", "object",
          "properties", Schema.of(
            "nameKo", STR, "nameEn", STR,
            "type", Schema.of("type", "string", "enum", TripDtos.NON_HUB_TYPES),
            "area", STR, "emoji", STR,
            "lat", NUM, "lng", NUM, "src", Schema.of("type", "integer")),
          "required", List.of("nameKo", "nameEn", "type", "area", "emoji", "lat", "lng", "src")))),
    "required", List.of("key", "nameKo", "nameEn", "country", "tz", "stayNights", "hasSubway", "hubs", "places")));

  /** 프롬프트 두 장과, 예산 안에 실제로 들어간 결과 번호들 (1부터). */
  public record Built(String system, String user, Set<Integer> included) {}

  /**
   * 검색어별 결과를 번갈아 섞는다 (결함 2): 1번 검색 1개, 2번 1개, 3번 1개, 1번 2개… 예산에 걸려도 세 검색이 고루 들어간다.
   * 번호는 섞인 순서대로 1부터 — src는 프롬프트 안에서만 뜻이 있다.
   */
  public static List<SearchHit> roundRobin(List<List<SearchHit>> groups) {
    List<SearchHit> out = new ArrayList<>();
    int max = 0;
    for (List<SearchHit> g : groups) max = Math.max(max, g.size());
    for (int i = 0; i < max; i++) for (List<SearchHit> g : groups) if (i < g.size()) out.add(g.get(i));
    return out;
  }

  /** 기본 예산으로. */
  public static Built build(String cityKo, List<SearchHit> hits) {
    return build(cityKo, hits, DEFAULT_SNIPPETS_MAX_CHARS);
  }

  /**
   * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
   *
   * @param cityKo 사용자가 말한 도시 이름
   * @param hits 검색 결과 (번호는 배열 순서 + 1)
   * @param maxChars 스니펫 예산 — 넘치는 줄은 건너뛰고(끊지 않고) 다음 줄을 계속 본다
   */
  public static Built build(String cityKo, List<SearchHit> hits, int maxChars) {
    String types = String.join(", ", TripDtos.NON_HUB_TYPES);
    String system = String.join("\n", List.of(
      "너는 여행 가이드북 편집자다. 아래 검색 결과만 근거로, 한 도시의 \"장소 목록\"을 JSON으로 만든다.",
      "",
      "규칙:",
      "- 검색 결과에 실제로 나오는 장소만 적는다. 지어내지 않는다. 각 장소에 근거가 된 결과 번호를 src에 적는다.",
      "- 고유명사가 있는 장소만. \"역 앞 카페\", \"시내 식당\"처럼 이름 없는 자리 채우기는 적지 않는다 — 6개밖에 없으면 6개만 적는다.",
      "- 장소는 6~14개. 서로 다른 유형을 섞는다 (카페·식당·시장·공원·박물관/명소·절/신사·쇼핑몰·산·해변·술집 등).",
      "- type은 다음 중 하나: " + types + ". 명소·유적·전망대는 museum, 절·신사·성당은 temple, 거리·골목·상점가는 market으로 적는다.",
      "- hotel은 정확히 1개 — 실제 있는 호텔 이름으로. 없으면 검색 결과에 나온 숙소 지역의 대표 호텔.",
      "- nameKo는 한국에서 흔히 쓰는 한국어 표기 (\"기요미즈데라\", \"니시키 시장\"), nameEn은 지도 검색용 로마자/영문 이름 (\"Kiyomizu-dera\").",
      "- area는 동네·구 이름 한국어 한 단어 (\"기온\", \"아라시야마\"). emoji는 그 장소에 어울리는 이모지 하나.",
      "- lat/lng는 아는 만큼 대략 적는다 (나중에 지도로 다시 확인한다).",
      "- hubs: airport는 이 도시에서 가장 가까운 **국제공항** (옆 도시여도 된다 — 교토면 간사이). station은 고속철·주요 역. port는 실제 여객선 항구가 있을 때만, 없으면 null. 허브에도 nameEn(공항 코드 같은 괄호는 빼고)과 대략 lat/lng를 적는다.",
      "- key는 도시의 영문 소문자 슬러그 (\"kyoto\", \"chiang-mai\"). country는 ISO 3166-1 alpha-2 (\"JP\"). tz는 IANA 시간대 (\"Asia/Tokyo\").",
      "- stayNights는 서울에서 가는 여행의 적당한 박수 (국내 1, 가까운 해외 2, 먼 해외 3). hasSubway는 시내 지하철·전철망이 있으면 true.",
      "- JSON으로만 답한다."));
    int used = 0;
    List<String> lines = new ArrayList<>();
    Set<Integer> included = new LinkedHashSet<>();
    for (int i = 0; i < hits.size(); i++) {
      SearchHit h = hits.get(i);
      String line = "[" + (i + 1) + "] " + h.title() + " — " + h.url() + "\n" + h.content();
      if (used + line.length() > maxChars) continue;
      used += line.length();
      lines.add(line);
      included.add(i + 1);
    }
    List<String> parts = new ArrayList<>(List.of("도시: " + cityKo, "", "[검색 결과]"));
    parts.addAll(lines);
    return new Built(system, String.join("\n\n", parts), Collections.unmodifiableSet(included));
  }
}
