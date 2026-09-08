package world.theworld.server.llm;

import java.util.List;
import java.util.Map;
import world.theworld.server.llm.LlmDtos.Agent;

/**
 * 통화 한 턴의 JSON 모양과 상수 (옛 Node 백엔드 contract.ts(커밋 2808024) CallTurnRequest·call.ts 상수, docs/CONTRACT.md "POST /api/call/turn").
 * 필드명은 프런트 sim/callvoice.ts와 글자 그대로. 응답은 DTO가 아니라 ndjson 줄들이다 — {@link CallController}.
 */
public final class CallDtos {
  private CallDtos() {}

  /** 한 턴에 낼 최대 토큰 (call.ts:9). 두 문장이면 넉넉하다 — 길면 통화가 독백이 된다. */
  public static final int TURN_TOKENS = 90;
  /** 한 문장의 최대 길이 (문자, call.ts:11). 넘으면 자른다 — TTS 한 조각의 상한이기도 하다. */
  public static final int MAX_SENTENCE = 60;
  /** 왜 붙은 통화인가 — worry(약속한 전화) · ask(걸어 달래서) · friction(어긋남 통보) · out(사용자가 걸었다). */
  public static final List<String> WHY_KEYS = List.of("worry", "ask", "friction", "out");

  /** 고민 갈래의 한국어 (call.ts:13). */
  public static final Map<String, String> WORRY_KO = Map.of("work", "일", "people", "사람", "body", "몸", "money", "돈", "focus", "집중", "blue", "기분", "bored", "심심함");
  /** 왜 통화 중인지를 모델에게 (call.ts:14-19). */
  public static final Map<String, String> WHY_KO = Map.of(
    "worry", "아까 사용자가 힘들다고 해서 \"이따가 전화할게\"라고 약속했고, 지금 그 전화를 걸었다.",
    "ask", "사용자가 전화해 달라고 해서 걸었다.",
    "friction", "계획이 어긋나서(문이 닫혔거나 자리가 없어서) 딴 데로 갔다고 알려 주려고 걸었다.",
    "out", "사용자가 먼저 걸어 왔다. 받았다.");

  /** 지금까지 오간 말 한 줄 — from은 me|agent. */
  public record CallLine(String from, String text) {}
  /** 에이전트의 지금. mood·fatigue는 0..100. */
  public record CallSituation(String where, String doing, String hhmm, int mood, int fatigue) {}
  /**
   * 검증·정규화를 거친 요청. worry는 why=worry일 때의 갈래(없으면 null). transcript는 오래된 것부터 최대 20줄.
   * user가 null이면 첫 턴 — 에이전트가 먼저 말한다.
   */
  public record CallTurnRequest(String tier, Agent agent, CallSituation situation, String why, String worry, List<CallLine> transcript, String user) {}
}
