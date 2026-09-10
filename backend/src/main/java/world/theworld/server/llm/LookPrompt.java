package world.theworld.server.llm;

import java.util.List;

/**
 * 사진 → 겉모습 프롬프트 (docs/CONTRACT.md POST /api/character/look). 사람 사진 한 장을 비전 모델에게 보여 주고 캐릭터 옵션(피부·머리·안경·
 * 수염·상의)만 고르게 한다. 누구인지는 묻지도 답하지도 않는다 — 겉모습만 옮긴다.
 */
public final class LookPrompt {
  private LookPrompt() {}

  public static final String SYSTEM = "너는 사진 속 사람의 겉모습을 캐릭터 옵션으로 옮기는 사람이다. 신원은 말하지 않는다.";
  /** `seen`의 최대 길이 — 한 문장. */
  public static final int MAX_SEEN = 60;

  /**
   * 프롬프트. 순수 함수 — 검사에서 그대로 본다. 피부·머리 색의 값 목록은 일부러 적지 않는다(스키마가 강제한다): 2026-09-10 실측에서
   * 값을 나열하자 27B가 어두운 피부의 사진을 두 번 다 tan/gray로 읽었고, 이 문장으로는 두 번 다 dark/black이었다.
   */
  public static String build() {
    return String.join("\n", List.of(
      "이 사진 속 사람의 겉모습을 귀여운 캐릭터로 옮기려 한다. 사람이 누구인지는 답하지 않는다. 겉모습만 본다.",
      "skin: 피부 밝기 (light 가장 밝음 … dark 가장 어두움). hairColor: 머리 색. hairStyle: 머리 모양 — bowl(바가지·앞머리), short(짧은 머리, 이마 보임), buzz(아주 짧게 민 머리), bob(턱선 단발), long(어깨 아래), curly(곱슬), bald(대머리).",
      "glasses: 안경 (none/round/square). beard: 수염 (none/stubble 짧은 수염/mustache 콧수염만/full 턱수염).",
      "top: 상의 색을 다음 중 가장 가까운 것 — coral(빨강·주황·분홍), sun(노랑), mint(초록), sky(파랑·하늘), night(검정·남색·짙은 정장), paper(흰색·베이지), leaf(연두).",
      "seen: 이 사람의 겉모습을 한국어 한 문장으로 (누구인지는 쓰지 않는다).",
      "JSON으로만 답한다: {\"skin\":…,\"hairColor\":…,\"hairStyle\":…,\"glasses\":…,\"beard\":…,\"top\":…,\"seen\":string}"));
  }
}
