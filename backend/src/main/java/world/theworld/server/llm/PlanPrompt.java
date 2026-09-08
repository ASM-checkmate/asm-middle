package world.theworld.server.llm;

import static world.theworld.server.llm.PlanDtos.BLOCK_KO;
import static world.theworld.server.llm.PlanDtos.CATEGORY_KO;
import static world.theworld.server.llm.PlanDtos.MAX_REASON;
import static world.theworld.server.llm.PlanDtos.MAX_TITLE;
import static world.theworld.server.llm.PlanDtos.OPTIONS_PER_BLOCK;
import static world.theworld.server.llm.PlanDtos.PLAN_CATEGORIES;
import static world.theworld.server.llm.PlanDtos.TYPE_KO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanStatus;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/**
 * 하루 계획 프롬프트와 스키마 (옛 Node 백엔드 plan.ts(커밋 2808024) buildPlanPrompt·planSchema 글자 그대로, ADR-0010).
 * 블록마다 "무엇을 할지" 카드 3장을 모델이 짓는다. 장소는 프론트가 보낸 카탈로그의 id만 쓸 수 있고(스키마 enum), 범주가 정해진 블록은 그 안에서,
 * 비어 있으면 모델이 범주도 고른다. 언제 시작하고 어디를 거쳐 가는지, 돈·피로에 막히는지는 여전히 프론트의 규칙(review·timeline)이 본다 —
 * 모델은 "하고 싶은 것"을 낼 뿐이다. 프롬프트 두 장은 답장과 같은 {@link Prompt}(system, user)로 돌려준다.
 */
public final class PlanPrompt {
  private PlanPrompt() {}

  private static String list(List<String> xs) {
    return xs.isEmpty() ? "딱히 없음" : String.join(", ", xs);
  }

  /** `${Math.round(n / 10000)}만 원` — JS Math.round와 같이 .5는 올린다. */
  private static String won(long n) {
    return Math.round(n / 10000.0) + "만 원";
  }

  /**
   * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
   *
   * @param req 검증된 요청
   * @return system(누구이고 어떤 하루인가 + 규칙)과 user(카탈로그 + 블록들)
   */
  public static Prompt build(PlanRequest req) {
    Agent a = req.agent();
    PlanStatus s = req.status();
    List<String> lines = new ArrayList<>();
    lines.add("너는 \"" + a.name() + "\"이다. 자기 하루를 사는 사람이고, 오늘 하루의 시간대마다 무엇을 할지 스스로 정한다.");
    lines.add("성격: " + list(a.traits()) + ". 좋아하는 것: " + list(a.likes()) + ". 싫어하는 것: " + list(a.dislikes()) + ".");
    lines.add("오늘은 " + req.day().dateKey() + " " + req.day().weekday() + ". 지금 " + req.city().nameKo() + "에 있다" + (req.city().home() ? " (집이 있는 도시)" : " (여행 중)")
      + ". 지갑 " + won(s.money()) + ", 피로 " + s.fatigue() + "/100, 기분 " + s.mood() + "/100.");
    lines.add(req.worry() != null && !req.worry().isEmpty()
      ? "며칠 안에 친구(사용자)가 " + ReplyPrompt.WORRY_KO.getOrDefault(req.worry(), req.worry()) + " 때문에 힘들다고 했다. 오늘 하루에 그게 조금 묻어나도 좋다." : "");
    lines.add(!req.visited().isEmpty() ? "최근에 간 곳: " + String.join(", ", req.visited()) + ". 갔던 곳은 \"또 가고 싶다\"는 이유가 있을 때만." : "");
    lines.add("");
    lines.add("규칙:");
    lines.add("- 시간대마다 카드 3장. 카드 = 장소(카탈로그 id) + 제목 + 이유 + 이모지. 장소는 반드시 카탈로그의 id만 쓴다.");
    lines.add("- 제목은 \"장소에서 무엇\" 꼴로 " + MAX_TITLE + "자 안 (\"레이어드에서 그림 그리기\", \"경의선숲길 산책\"). 장소 이름을 넣는다.");
    lines.add("- 이유는 취향·기억·상황에 기대는 한 줄, " + MAX_REASON + "자 안, 반말체 명사형 (\"창가 자리 좋았음\", \"요즘 몸이 무거움\"). 존댓말 금지.");
    lines.add("- 범주가 정해진 시간대는 그 범주 안에서만. 비어 있으면 네가 고른다: 아침·점심·저녁 시간대는 식사(meal), 나머지는 성격과 상태에 맞게 (피곤하면 쉬기, 기분이 처지면 좋아하는 것, 돈이 없으면 일이나 싼 것).");
    lines.add("- 범주와 장소 유형이 맞아야 한다: 식사는 식당·카페·시장·집, 운동은 헬스장·공원·강변·산, 공부는 도서관·카페·집, 일은 일터·카페·집, 쉬기는 집·카페·공원.");
    lines.add("- 아침·점심은 가까운 곳(같은 동네), 오후는 멀리 가도 된다. 밤은 집 근처나 집.");
    lines.add("- 한 시간대의 카드 3장은 서로 다른 장소. 오늘 이미 잡힌 장소(avoid)와 방금 보여 준 카드(previous)는 피한다.");
    lines.add("- 카드 3장이 다 같은 느낌이면 재미없다 — 하나는 무난하게, 하나는 취향에 딱, 하나는 조금 뜻밖에.");
    lines.add("- JSON으로만 답한다.");
    // 원본의 filter(l => l !== '') — 빈 줄(고민·최근 간 곳이 없을 때와 '규칙:' 앞의 칸)은 다 빠진다
    String system = String.join("\n", lines.stream().filter(l -> !l.isEmpty()).toList());

    List<String> catalog = new ArrayList<>();
    for (PlanPlace p : req.places()) catalog.add("- " + p.id() + ": " + p.name() + " (" + TYPE_KO.getOrDefault(p.type(), p.type()) + ", " + p.area() + ")");
    List<String> blocks = new ArrayList<>();
    for (PlanBlockRequest b : req.blocks()) {
      List<String> ls = new ArrayList<>();
      ls.add("· " + b.id() + " " + BLOCK_KO.get(b.id()) + " — 범주 " + (b.category() != null && !b.category().isEmpty() ? CATEGORY_KO.get(b.category()) : "(네가 고른다)")
        + ", 시작할 때 있는 곳: " + b.from());
      if (!b.avoid().isEmpty()) ls.add("  avoid: " + String.join(", ", b.avoid()));
      if (b.previous() != null && !b.previous().isEmpty()) ls.add("  previous: " + String.join(" / ", b.previous()));
      blocks.add(String.join("\n", ls));
    }
    String user = String.join("\n", List.of("[갈 수 있는 곳]", String.join("\n", catalog), "", "[정할 시간대]", String.join("\n", blocks)));
    return new Prompt(system, user);
  }

  /**
   * 모델에게 강제하는 응답 형식 (plan.ts planSchema). placeId는 카탈로그의 id 중 하나만 — 지어낸 장소가 들어올 길이 없다.
   * 블록 수는 요청한 만큼 고정, 카드는 블록마다 3장.
   *
   * @param placeIds 카탈로그 id들
   * @param blockIds 지어 달라는 블록들
   */
  public static Map<String, Object> schema(List<String> placeIds, List<String> blockIds) {
    return Schema.of(
      "type", "object",
      "properties", Schema.of(
        "blocks", Schema.of(
          "type", "array", "minItems", blockIds.size(), "maxItems", blockIds.size(),
          "items", Schema.of(
            "type", "object",
            "properties", Schema.of(
              "id", Schema.of("type", "string", "enum", List.copyOf(blockIds)),
              "category", Schema.of("type", "string", "enum", PLAN_CATEGORIES),
              "options", Schema.of(
                "type", "array", "minItems", OPTIONS_PER_BLOCK, "maxItems", OPTIONS_PER_BLOCK,
                "items", Schema.of(
                  "type", "object",
                  "properties", Schema.of(
                    "placeId", Schema.of("type", "string", "enum", List.copyOf(placeIds)),
                    "title", Schema.of("type", "string"),
                    "reason", Schema.of("type", "string"),
                    "emoji", Schema.of("type", "string")),
                  "required", List.of("placeId", "title", "reason", "emoji")))),
            "required", List.of("id", "category", "options")))),
      "required", List.of("blocks"));
  }
}
