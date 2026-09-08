package world.theworld.server.llm;

import java.util.ArrayList;
import java.util.List;
import world.theworld.server.llm.CallDtos.CallLine;
import world.theworld.server.llm.CallDtos.CallSituation;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/**
 * 통화 프롬프트 (옛 Node 백엔드 call.ts(커밋 2808024) buildCallPrompt 글자 그대로, ADR-0011). 답장(ReplyPrompt)과 같은 페르소나지만
 * **말로 하는 한두 문장**이고, 문장이 완성될 때마다 바로 흘려보낸다 — 프론트가 그 문장을 TTS에 넣어 목소리로 낸다.
 * 언제 걸리고 받을 수 있는지는 여전히 프론트 규칙(sim/call.ts).
 */
public final class CallPrompt {
  private CallPrompt() {}

  private static String list(List<String> xs) {
    return xs.isEmpty() ? "딱히 없음" : String.join(", ", xs);
  }

  /**
   * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
   *
   * @param req 요청
   * @return system(누구이고 왜 통화 중인가 + 말하는 규칙)과 user(지금까지 오간 말 + 이번에 들은 말)
   */
  public static Prompt build(CallTurnRequest req) {
    Agent agent = req.agent();
    CallSituation s = req.situation();
    List<String> lines = new ArrayList<>();
    lines.add("너는 \"" + agent.name() + "\"이다. 사용자의 오랜 친구이고, 자기 하루를 사는 사람이다. 지금 사용자와 **전화 통화 중**이다.");
    lines.add("성격: " + list(agent.traits()) + ". 좋아하는 것: " + list(agent.likes()) + ". 싫어하는 것: " + list(agent.dislikes()) + ".");
    lines.add("지금 상황: " + s.hhmm() + ", " + s.where() + "에서 " + s.doing() + ". 기분 " + s.mood() + "/100, 피로 " + s.fatigue() + "/100.");
    lines.add(CallDtos.WHY_KO.getOrDefault(req.why(), ""));
    lines.add(req.why().equals("worry") && req.worry() != null && !req.worry().isEmpty()
      ? "사용자는 " + CallDtos.WORRY_KO.get(req.worry()) + " 때문에 힘들다고 했다. 먼저 그게 어땠는지 묻고, 듣고 나면 해결책이 아니라 **네가 오늘 뭘 하겠다**를 말한다 (\"오늘은 조용한 데로 잡아 놨어\")."
      : "");
    lines.add("");
    lines.add("규칙:");
    lines.add("- 말로 하는 통화다. 한국어 반말, 한 턴에 한두 문장, 문장은 짧게 (20자 안팎). 이모지·괄호·지문 금지. 존댓말·영어 금지.");
    lines.add("- 사용자가 말을 끝내면 그 말에 답한다. 물음이면 답하고, 힘든 얘기면 먼저 듣는다 (\"어… 그랬구나\").");
    lines.add("- 위치와 하는 일은 위의 \"지금 상황\"만 사실이다. 지어내지 않는다. 모르는 얘기면 모른다고 한다.");
    lines.add("- 사용자가 끊자고 하면 짧게 인사하고 끝낸다.");
    lines.add("- 답만 쓴다. 이름표·따옴표·설명 없이 네가 할 말만.");
    String system = String.join("\n", lines.stream().filter(l -> !l.isEmpty()).toList());

    List<String> userLines = new ArrayList<>();
    if (!req.transcript().isEmpty()) {
      userLines.add("[지금까지]");
      for (CallLine m : req.transcript()) userLines.add((m.from().equals("me") ? "사용자" : agent.name()) + ": " + m.text());
      userLines.add("");
    }
    if (req.user() == null) {
      userLines.add("[통화가 막 붙었다. 네가 먼저 말한다 — 여보세요 같은 첫마디부터.]");
    } else {
      userLines.add("[방금 들은 말]");
      userLines.add("사용자: " + req.user());
    }
    return new Prompt(system, String.join("\n", userLines));
  }
}
