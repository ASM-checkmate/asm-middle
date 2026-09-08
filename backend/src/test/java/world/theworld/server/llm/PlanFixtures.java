package world.theworld.server.llm;

import java.util.List;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanCity;
import world.theworld.server.llm.PlanDtos.PlanDay;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanStatus;

/**
 * 하루 계획 테스트 공통 — 옛 Node 백엔드 scripts/plan.test.mjs(커밋 2808024)의 고정 요청. 골든 파일(golden/plan-*.txt)은 Node의
 * buildPlanPrompt를 바로 이 요청으로 돌려 뽑았으므로 여기서 한 글자라도 바꾸면 골든 검사가 깨진다.
 */
public final class PlanFixtures {
  private PlanFixtures() {}

  /** plan.test.mjs:9-30 — am 블록에는 previous 키가 없다(null), lunch에는 있다. */
  public static PlanRequest planReq() {
    return new PlanRequest("small",
      new Agent("모모", List.of("느긋한", "호기심 많은"), List.of("그림 그리기", "카페"), List.of("줄 서기")),
      new PlanDay("2026-09-08", "화요일"),
      new PlanCity("seoul", "서울", true),
      new PlanStatus(620000, 22, 58),
      null,
      List.of("경의선숲길"),
      List.of(
        new PlanPlace("home", "우리 집", "home", "연남동"),
        new PlanPlace("layered-yeonnam", "카페 레이어드 연남", "cafe", "연남동"),
        new PlanPlace("gyeongui-line-forest", "경의선숲길", "park", "연남동"),
        new PlanPlace("tuktuk-noodle", "툭툭누들타이", "restaurant", "연남동"),
        new PlanPlace("the-climb-yeonnam", "더클라임 연남", "gym", "연남동"),
        new PlanPlace("mapo-central-library", "마포중앙도서관", "library", "성산동"),
        new PlanPlace("wework-hongdae", "위워크 홍대", "office", "서교동")),
      List.of(
        new PlanBlockRequest("am", null, "우리 집", List.of("tuktuk-noodle"), null),
        new PlanBlockRequest("lunch", "meal", "카페 레이어드 연남", List.of(), List.of("툭툭누들에서 팟타이"))));
  }

  public static PlanRequest withWorry(PlanRequest r, String worry) {
    return new PlanRequest(r.tier(), r.agent(), r.day(), r.city(), r.status(), worry, r.visited(), r.places(), r.blocks());
  }

  public static PlanRequest withBlocks(PlanRequest r, List<PlanBlockRequest> blocks) {
    return new PlanRequest(r.tier(), r.agent(), r.day(), r.city(), r.status(), r.worry(), r.visited(), r.places(), blocks);
  }

  /** 요청 JSON 한 장 — API 검사용. plan.test.mjs의 고정 요청과 같은 내용. */
  public static String planJson() {
    try { return LlmFixtures.OM.writeValueAsString(planReq()); }
    catch (Exception e) { throw new IllegalStateException(e); }
  }
}
