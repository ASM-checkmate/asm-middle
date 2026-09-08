package world.theworld.server.llm;

import static world.theworld.server.llm.ReplyValidator.isText;
import static world.theworld.server.llm.ReplyValidator.num;
import static world.theworld.server.llm.ReplyValidator.strs;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.CallDtos.CallLine;
import world.theworld.server.llm.CallDtos.CallSituation;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.LlmDtos.Agent;

/**
 * POST /api/call/turn 요청 검증·정규화 (옛 Node 백엔드 server.ts(커밋 2808024) validateCall 그대로). 답장(ReplyValidator)과 같은 결 — 틀린 필드는
 * 거부하기보다 기본값·잘라내기로 받는다. 오류 문자열은 계약(docs/CONTRACT.md)에 고정.
 * 상한: transcript 마지막 20줄·한 줄 200자, user 200자, 이름 20자, where/doing 40자, hhmm 5자. mood/fatigue는 0..100(기본 60/30).
 */
public final class CallValidator {
  private CallValidator() {}

  /** 요청이 계약대로인지. 틀리면 400 한 줄. */
  public static CallTurnRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (!isText(tier) || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode a = b.get("agent");
    if (a == null || !a.isObject() || !isText(a.get("name"))) throw ApiException.badRequest("agent.name required");
    JsonNode s = b.get("situation");
    if (s == null || !s.isObject() || !isText(s.get("where")) || !isText(s.get("doing")) || !isText(s.get("hhmm"))) throw ApiException.badRequest("situation.where/doing/hhmm required");
    JsonNode why = b.get("why");
    if (!isText(why) || !CallDtos.WHY_KEYS.contains(why.asText())) throw ApiException.badRequest("why must be worry|ask|friction|out");
    // 없으면(undefined) Node의 `o.user !== null`에 걸린다 — 첫 턴은 null을 명시해야 한다
    JsonNode user = b.get("user");
    if (user == null || !(user.isNull() || user.isTextual())) throw ApiException.badRequest("user must be string|null");

    List<CallLine> transcript = new ArrayList<>();
    JsonNode t = b.get("transcript");
    if (t != null && t.isArray()) {
      for (JsonNode m : t) {
        if (!m.isObject()) continue;
        JsonNode from = m.get("from");
        if (!isText(from) || !(from.asText().equals("me") || from.asText().equals("agent")) || !isText(m.get("text"))) continue;
        transcript.add(new CallLine(from.asText(), m.get("text").asText()));
      }
    }
    if (transcript.size() > 20) transcript = new ArrayList<>(transcript.subList(transcript.size() - 20, transcript.size()));
    transcript = transcript.stream().map(m -> new CallLine(m.from(), Text.cut(m.text(), 200))).toList();

    JsonNode worry = b.get("worry");
    return new CallTurnRequest(
      tier.asText(),
      new Agent(Text.cut(a.get("name").asText(), 20), strs(a.get("traits")), strs(a.get("likes")), strs(a.get("dislikes"))),
      new CallSituation(Text.cut(s.get("where").asText(), 40), Text.cut(s.get("doing").asText(), 40), Text.cut(s.get("hhmm").asText(), 5), num(s.get("mood"), 60), num(s.get("fatigue"), 30)),
      why.asText(),
      isText(worry) && LlmDtos.WORRY_KEYS.contains(worry.asText()) ? worry.asText() : null,
      transcript,
      user.isNull() ? null : Text.cut(user.asText(), 200));
  }
}
