package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.LlmDtos.Crush;
import world.theworld.server.llm.LlmDtos.RecentMsg;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.Situation;

/**
 * POST /api/chat/reply 요청 검증·정규화 (옛 Node 백엔드 server.ts(커밋 0298e8d) validate 그대로). 틀린 필드를 거부하기보다 기본값으로 바꾸는
 * 규칙이 많아(mood/fatigue/worry/recent) Bean Validation 대신 손으로 본다. 오류 문자열은 계약(§2.4)에 고정.
 */
public final class ReplyValidator {
  private ReplyValidator() {}

  static boolean isText(JsonNode n) { return n != null && n.isTextual(); }

  /** 문자열만 남긴다 (없으면 []). */
  static List<String> strs(JsonNode v) {
    List<String> out = new ArrayList<>();
    if (v != null && v.isArray()) for (JsonNode x : v) if (x.isTextual()) out.add(x.asText());
    return out;
  }

  /** finite 숫자면 반올림 후 0..100, 아니면 기본값. */
  static int num(JsonNode v, int fb) {
    if (v == null || !v.isNumber()) return fb;
    return (int) Math.max(0, Math.min(100, Math.round(v.doubleValue())));
  }

  /** 요청이 계약대로인지. 틀리면 400 한 줄. */
  public static ReplyRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (!isText(tier) || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode a = b.get("agent");
    if (a == null || !a.isObject() || !isText(a.get("name"))) throw ApiException.badRequest("agent.name required");
    JsonNode s = b.get("situation");
    if (s == null || !s.isObject() || !isText(s.get("where")) || !isText(s.get("doing")) || !isText(s.get("hhmm"))) throw ApiException.badRequest("situation.where/doing/hhmm required");
    JsonNode texts = b.get("texts");
    if (texts == null || !texts.isArray() || texts.isEmpty()) throw ApiException.badRequest("texts must be a non-empty string[]");
    for (JsonNode t : texts) if (!t.isTextual()) throw ApiException.badRequest("texts must be a non-empty string[]");

    List<RecentMsg> recent = new ArrayList<>();
    JsonNode r = b.get("recent");
    if (r != null && r.isArray()) {
      for (JsonNode m : r) {
        if (!m.isObject()) continue;
        JsonNode from = m.get("from");
        if (!isText(from) || !(from.asText().equals("me") || from.asText().equals("agent")) || !isText(m.get("text"))) continue;
        recent.add(new RecentMsg(from.asText(), m.get("text").asText()));
      }
    }
    if (recent.size() > 12) recent = new ArrayList<>(recent.subList(recent.size() - 12, recent.size()));

    List<String> texts8 = new ArrayList<>();
    for (JsonNode t : texts) texts8.add(t.asText());
    if (texts8.size() > 8) texts8 = new ArrayList<>(texts8.subList(texts8.size() - 8, texts8.size()));
    texts8 = texts8.stream().map(t -> Text.cut(t, 200)).toList();

    JsonNode worry = s.get("worry");
    JsonNode lateWhy = s.get("lateWhy");
    JsonNode batch = b.get("batch");
    return new ReplyRequest(
      tier.asText(),
      new Agent(a.get("name").asText(), strs(a.get("traits")), strs(a.get("likes")), strs(a.get("dislikes"))),
      new Situation(
        s.get("where").asText(), s.get("doing").asText(), s.get("hhmm").asText(),
        isText(lateWhy) ? lateWhy.asText() : null,
        num(s.get("mood"), 60), num(s.get("fatigue"), 30),
        isText(worry) && LlmDtos.WORRY_KEYS.contains(worry.asText()) ? worry.asText() : null,
        crush(s.get("crush"))),
      recent,
      texts8,
      isText(batch) ? batch.asText() : null);
  }

  /** 설렘 대상 — 없거나(null/생략) 모양이 틀리면(이름 1~40자·단계 enum 밖) 조용히 없음으로. 400은 내지 않는다 (ADR-0027: 숫자는 서버에 안 온다). */
  static Crush crush(JsonNode v) {
    if (v == null || !v.isObject()) return null;
    JsonNode name = v.get("name");
    JsonNode stage = v.get("stage");
    if (!isText(name) || !isText(stage) || !LlmDtos.CRUSH_STAGES.contains(stage.asText())) return null;
    String n = Text.collapse(name.asText());
    if (n.isEmpty() || n.length() > 40) return null;
    return new Crush(n, stage.asText());
  }
}
