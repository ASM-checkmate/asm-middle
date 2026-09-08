package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanCity;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/** 옛 Node 백엔드 scripts/plan.test.mjs(커밋 2808024) '프롬프트' 7개 이관 + 골든 동일성. */
class PlanPromptTest {
  private final PlanRequest req = PlanFixtures.planReq();

  @Test
  void nameTasteAndStatusInSystem() {
    Prompt p = PlanPrompt.build(req);
    assertThat(p.system()).contains("\"모모\"").contains("그림 그리기").contains("62만 원").contains("화요일");
  }

  @Test
  void recentlyVisited() {
    assertThat(PlanPrompt.build(req).system()).contains("경의선숲길");
  }

  @Test
  void worryLineOnlyWhenWorried() {
    assertThat(PlanPrompt.build(PlanFixtures.withWorry(req, "work")).system()).contains("일 때문에");
    assertThat(PlanPrompt.build(req).system()).doesNotContain("때문에 힘들다고");
  }

  @Test
  void catalogCarriesIds() {
    assertThat(PlanPrompt.build(req).user()).contains("- layered-yeonnam: 카페 레이어드 연남 (카페, 연남동)");
  }

  @Test
  void blockLinesFixedOrFree() {
    String u = PlanPrompt.build(req).user();
    assertThat(u).contains("· am 오전(09–12) — 범주 (네가 고른다)").contains("· lunch 점심(12–14) — 범주 식사");
  }

  @Test
  void avoidAndPreviousListed() {
    assertThat(PlanPrompt.build(req).user()).contains("avoid: tuktuk-noodle").contains("previous: 툭툭누들에서 팟타이");
  }

  /** Node buildPlanPrompt(plan.test.mjs의 고정 요청)와 글자 단위로 같다 — 부분 문자열 검사가 놓치는 줄 바뀜·빈 줄을 잡는다. */
  @Test
  void exactlyTheNodePrompt() {
    Prompt p = PlanPrompt.build(req);
    assertThat(p.system()).isEqualTo(LlmFixtures.golden("plan-system"));
    assertThat(p.user()).isEqualTo(LlmFixtures.golden("plan-user"));
    Prompt worried = PlanPrompt.build(PlanFixtures.withWorry(req, "work"));
    assertThat(worried.system()).isEqualTo(LlmFixtures.golden("plan-system-worry"));
    assertThat(worried.user()).isEqualTo(LlmFixtures.golden("plan-user"));
  }

  /** 빈 줄은 다 빠진다(plan.ts filter) — 여행 중·최근 간 곳 없음·avoid/previous 없음. */
  @Test
  void optionalLinesDropOut() {
    PlanRequest r = new PlanRequest(req.tier(), req.agent(), req.day(), new PlanCity("kyoto", "교토", false), req.status(), null, List.of(),
      List.of(new PlanPlace("kyoto-hotel", "교토 타워 호텔", "hotel", "시모교")),
      List.of(new PlanBlockRequest("night", "rest", "교토역", List.of(), null)));
    Prompt p = PlanPrompt.build(r);
    assertThat(p.system()).contains("지금 교토에 있다 (여행 중)").doesNotContain("최근에 간 곳").doesNotContain("\n\n");
    assertThat(p.system()).contains("기분 58/100.\n규칙:");
    assertThat(p.user()).isEqualTo("[갈 수 있는 곳]\n- kyoto-hotel: 교토 타워 호텔 (호텔, 시모교)\n\n[정할 시간대]\n· night 밤(20–24) — 범주 쉬기, 시작할 때 있는 곳: 교토역");
  }

  @Test
  @SuppressWarnings("unchecked")
  void schemaFixesPlacesBlocksAndCards() throws Exception {
    Map<String, Object> s = PlanPrompt.schema(req.places().stream().map(PlanPlace::id).toList(), List.of("am", "lunch"));
    Map<String, Object> blocks = (Map<String, Object>) ((Map<String, Object>) s.get("properties")).get("blocks");
    assertThat(blocks.get("minItems")).isEqualTo(2);
    assertThat(blocks.get("maxItems")).isEqualTo(2);
    Map<String, Object> block = (Map<String, Object>) ((Map<String, Object>) blocks.get("items")).get("properties");
    assertThat(((Map<String, Object>) block.get("id")).get("enum")).isEqualTo(List.of("am", "lunch"));
    assertThat(((Map<String, Object>) block.get("category")).get("enum")).isEqualTo(PlanDtos.PLAN_CATEGORIES);
    Map<String, Object> options = (Map<String, Object>) block.get("options");
    assertThat(options.get("minItems")).isEqualTo(3);
    assertThat(options.get("maxItems")).isEqualTo(3);
    Map<String, Object> card = (Map<String, Object>) ((Map<String, Object>) options.get("items")).get("properties");
    assertThat((List<String>) ((Map<String, Object>) card.get("placeId")).get("enum")).contains("home").hasSize(7);
    String json = LlmFixtures.OM.writeValueAsString(s);
    assertThat(json).contains("\"required\":[\"placeId\",\"title\",\"reason\",\"emoji\"]").contains("\"required\":[\"id\",\"category\",\"options\"]").endsWith("\"required\":[\"blocks\"]}");
  }
}
