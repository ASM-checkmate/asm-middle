package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.regex.Pattern;
import world.theworld.server.llm.LlmDtos.ReplyParsed;

/** 답장 파서 (옛 Node 백엔드 reply.ts(커밋 0298e8d) parseReply). 형식이 어긋나면 **답장 없음**으로 본다 (틀린 말보다 침묵이 낫다). */
public final class ReplyParser {
  private ReplyParser() {}

  private static final ObjectMapper OM = new ObjectMapper();
  /** 80자에서 잘린 마지막 불완전 단어(쉼표/공백 뒤 조각) 제거 — `/[,\s]+\S*$/`. */
  private static final Pattern TAIL = Pattern.compile("[,\\s]+\\S*$", Pattern.UNICODE_CHARACTER_CLASS);
  /** 도시 이름 뒤에 붙은 두 글자 조사 — 한 글자 조사("로"·"에")는 안 뗀다: 오슬로가 오슬이 된다. */
  private static final Pattern JOSA = Pattern.compile("(으로|까지|에는|에서)$");
  private static final ReplyParsed NONE = new ReplyParsed(null, null, false, null);

  /**
   * 모델이 낸 JSON을 계약대로 다듬는다.
   *
   * @param raw 모델 출력
   * @return text·worry·callMe·trip. 파싱 실패면 `{ text: null, worry: null, callMe: false, trip: null }`
   */
  public static ReplyParsed parse(String raw) {
    JsonNode j;
    try { j = OM.readTree(raw); }
    catch (Exception e) { return NONE; }
    if (j == null || !j.isObject()) return NONE;
    String text = j.path("text").isTextual() ? Text.oneLine(j.get("text").asText()) : null;
    if (text != null) {
      if (text.length() > ReplyPrompt.MAX_REPLY) text = TAIL.matcher(Text.cut(text, ReplyPrompt.MAX_REPLY)).replaceFirst("") + "…";
      if (text.isEmpty()) text = null;
    }
    JsonNode w = j.path("worry");
    String worry = w.isTextual() && LlmDtos.WORRY_KEYS.contains(w.asText()) ? w.asText() : null;
    // 도시 이름만 — 모델이 "교토으로"·"교토까지"처럼 조사를 붙이면 뗀다
    String trip = j.path("trip").isTextual() ? JOSA.matcher(Text.collapse(j.get("trip").asText())).replaceFirst("").strip() : null;
    if (trip != null && (trip.isEmpty() || trip.length() > ReplyPrompt.MAX_TRIP)) trip = null;
    JsonNode c = j.path("callMe");
    return new ReplyParsed(text, worry, c.isBoolean() && c.booleanValue(), trip);
  }
}
