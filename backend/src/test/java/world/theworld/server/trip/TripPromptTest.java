package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripPrompt.Built;

/** trip.test.mjs '프롬프트' 5개 이관 + 결함 2(라운드로빈·예산 22_000)·결함 3(included 집합) 회귀. */
class TripPromptTest {
  private static List<SearchHit> many(int n, String prefix) {
    List<SearchHit> out = new ArrayList<>();
    for (int i = 0; i < n; i++) out.add(new SearchHit(prefix + i, "https://u/" + prefix + i, "y".repeat(500)));
    return out;
  }

  @Test
  void systemRules() {
    Built p = TripPrompt.build("교토", TripFixtures.hits());
    assertThat(p.system()).contains("hotel은 정확히 1개").contains("src").contains("지어내지 않는다");
    assertThat(p.system()).contains("- type은 다음 중 하나: cafe, restaurant, park, gym, library, cinema, mall, river, beach, museum, arcade, bar, temple, market, hotel, stadium, mountain, island.");
  }

  @Test
  void userHasNumberedSnippets() {
    Built p = TripPrompt.build("교토", TripFixtures.hits());
    // JS `['도시: …', '', '[검색 결과]', …lines].join('\n\n')` — 빈 원소 때문에 제목 뒤가 네 줄바꿈이다
    assertThat(p.user()).startsWith("도시: 교토\n\n\n\n[검색 결과]\n\n[1] 교토 여행 가볼 만한 곳 10 — https://ex.com/kyoto\n기요미즈데라");
    assertThat(p.user()).contains("[3] Kyoto travel guide");
    assertThat(p.included()).containsExactly(1, 2, 3);
  }

  /** Node buildTripPrompt(trip.test.mjs의 교토 검색 결과 3개)와 글자 단위로 같다 — 예산 안에서는 결함 2·3 수정이 문장을 바꾸지 않는다. */
  @Test
  void exactlyTheNodePrompt() {
    Built p = TripPrompt.build("교토", TripFixtures.hits());
    assertThat(p.system()).isEqualTo(world.theworld.server.llm.LlmFixtures.golden("trip-system"));
    assertThat(p.user()).isEqualTo(world.theworld.server.llm.LlmFixtures.golden("trip-user"));
  }

  @Test
  void budgetSkipsLinesAndReportsIncluded() {
    // 원본 예산(9000)으로 40×500자: 뒤쪽은 빠지고, 빠진 번호는 included에 없다 (결함 3)
    Built p = TripPrompt.build("x", many(40, "t"), 9_000);
    assertThat(p.user()).doesNotContain("[39]");
    assertThat(p.included()).doesNotContain(39, 40);
    assertThat(p.included()).contains(1, 2);
    assertThat(p.included().size()).isBetween(15, 18);
    int used = p.user().length();
    assertThat(used).isLessThan(9_000 + 200);
  }

  @Test
  void defaultBudgetFitsThreeSearches() {
    // 결함 2: 3검색 × 8결과 ≈ 17K가 기본 예산 22_000에 다 들어간다
    List<SearchHit> hits = new ArrayList<>();
    for (int q = 0; q < 3; q++) for (int i = 0; i < 8; i++) hits.add(new SearchHit("제목 " + q + "-" + i + " " + "t".repeat(60), "https://example.com/" + q + "/" + i + "/" + "p".repeat(60), "c".repeat(500)));
    Built p = TripPrompt.build("교토", hits);
    assertThat(p.included()).hasSize(24);
    assertThat(p.user()).contains("[24] 제목 2-7");
    assertThat(TripPrompt.DEFAULT_SNIPPETS_MAX_CHARS).isEqualTo(22_000);
  }

  @Test
  void roundRobinInterleavesQueries() {
    List<List<SearchHit>> groups = List.of(many(3, "a"), many(1, "b"), many(2, "c"));
    List<SearchHit> rr = TripPrompt.roundRobin(groups);
    assertThat(rr.stream().map(SearchHit::title)).containsExactly("a0", "b0", "c0", "a1", "c1", "a2");
    // 예산에 걸려도 세 검색이 고루 들어간다
    Built p = TripPrompt.build("x", TripPrompt.roundRobin(List.of(many(8, "a"), many(8, "b"), many(8, "c"))), 3_200);
    String u = p.user();
    assertThat(u).contains("a0").contains("b0").contains("c0").contains("a1").contains("b1").contains("c1");
    assertThat(u).doesNotContain("a7").doesNotContain("b7").doesNotContain("c7");
  }

  @Test
  @SuppressWarnings("unchecked")
  void schemaShape() throws Exception {
    Map<String, Object> s = TripPrompt.TRIP_SCHEMA;
    assertThat((List<String>) s.get("required")).contains("key", "tz", "hubs", "places");
    Map<String, Object> props = (Map<String, Object>) s.get("properties");
    Map<String, Object> places = (Map<String, Object>) props.get("places");
    assertThat(places.get("minItems")).isEqualTo(6);
    Map<String, Object> items = (Map<String, Object>) places.get("items");
    List<String> typeEnum = (List<String>) ((Map<String, Object>) ((Map<String, Object>) items.get("properties")).get("type")).get("enum");
    assertThat(typeEnum).doesNotContain("airport", "station", "port", "home", "office");
    assertThat(typeEnum).contains("hotel", "temple");
    String json = TripFixtures.OM.writeValueAsString(s);
    assertThat(json).contains("\"airport\":{\"type\":[\"object\",null]");
    assertThat(json).contains("\"stayNights\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":5}");
  }
}
