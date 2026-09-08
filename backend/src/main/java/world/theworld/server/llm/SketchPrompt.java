package world.theworld.server.llm;

import java.util.ArrayList;
import java.util.List;
import world.theworld.server.llm.LlmDtos.SketchOption;
import world.theworld.server.llm.LlmDtos.SketchReadRequest;

/**
 * 그림 읽기 프롬프트 (옛 Node 백엔드 sketch.ts(커밋 0298e8d), docs/adr/0007-sketch-vision.md). 사용자가 붓으로 그린 240px 낙서를 비전 모델에게
 * 보여 주고, 그 블록의 카드 3장 중 어느 것을 가리키는지 묻는다. 못 알아보면 null — 프론트는 시드로 고르고 "못 알아봐서 내 맘대로 골랐어"를 남긴다.
 */
public final class SketchPrompt {
  private SketchPrompt() {}

  public static final String SYSTEM = "너는 친구의 낙서를 알아보는 사람이다. 모르면 모른다고 한다.";
  /** `seen`의 최대 길이 — 활동 로그 한 줄에 끼워 넣는 조각이다. */
  public static final int MAX_SEEN = 12;

  /** 프롬프트. 그림이 무엇인지 먼저 말하고, 그 뜻이 옵션 중 하나로 이어지는지 고르게 한다. 순수 함수 — 검사에서 그대로 본다. */
  public static String build(SketchReadRequest req) {
    List<String> items = new ArrayList<>();
    int i = 0;
    for (SketchOption o : req.options()) items.add((++i) + ". id=\"" + o.id() + "\" — " + o.title() + " (" + o.placeName() + ", " + o.placeType() + ")");
    return String.join("\n", List.of(
      "이 그림은 사용자가 손가락으로 대충 그린 낙서다. 오늘의 한 시간대에 무엇을 할지 말 대신 그림으로 알려 준 것이다.",
      "시간대의 범주: " + req.category() + ". 고를 수 있는 것은 아래 셋뿐이다.",
      String.join("\n", items),
      "",
      "먼저 그림이 무엇으로 보이는지 한국어 명사 한두 단어로 적는다 (\"seen\"). 예: \"컵\", \"자전거\", \"책\".",
      "그 다음 그 뜻이 위 옵션 중 하나를 분명히 가리키면 그 id를, 어느 것과도 이어지지 않거나 뭘 그렸는지 모르겠으면 null을 \"optionId\"에 둔다.",
      "그리고 그림이 어떤 종류의 활동으로 읽히는지 \"category\"에 둔다: meal(먹는 것), play(놀기·카페·산책·구경), exercise(운동), study(공부·책), work(일), rest(쉬기·잠·집), travel(여행·비행기·기차). 활동이 아니거나(하트, 낙서, 글자) 모르겠으면 null.",
      "억지로 고르지 않는다. 확신이 없으면 null이다.",
      "JSON으로만 답한다: {\"seen\": string, \"optionId\": string|null, \"category\": string|null}"));
  }
}
