package world.theworld.server.llm;

import static world.theworld.server.llm.PlanDtos.MAX_REASON;
import static world.theworld.server.llm.PlanDtos.MAX_TITLE;
import static world.theworld.server.llm.PlanDtos.OPTIONS_PER_BLOCK;
import static world.theworld.server.llm.PlanDtos.PLAN_CATEGORIES;
import static world.theworld.server.llm.PlanDtos.TYPES_FOR;
import static world.theworld.server.llm.PlanDtos.TYPE_EMOJI;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import world.theworld.server.llm.PlanDtos.PlanBlock;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanOption;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;

/**
 * 하루 계획 파서 (옛 Node 백엔드 plan.ts(커밋 2808024) parsePlan). 모델 출력을 계약대로 다듬는다 — 순수 함수.
 * 요청에 없는 블록·카탈로그 밖 장소·범주에 안 맞는 장소·겹치는 장소는 버리고, 카드가 2장 미만으로 남은 블록은 통째로 뺀다
 * (프론트가 규칙으로 채운다). 범주가 정해진 블록은 그 범주로 고정한다. 깨진 JSON은 빈 목록.
 */
public final class PlanParser {
  private PlanParser() {}

  private static final ObjectMapper OM = new ObjectMapper();
  /**
   * 이모지 하나 (ZWJ·변형 선택자 포함) — Node의 {@code /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\/u}.
   * Java 21의 {@code \p{IsExtended_Pictographic}}이 같은 유니코드 속성이다.
   */
  private static final Pattern ONE_EMOJI = Pattern.compile("^\\p{IsExtended_Pictographic}(?:\\uFE0F|\\u200D\\p{IsExtended_Pictographic})*");
  /** 이유가 비었을 때. */
  static final String DEFAULT_REASON = "왠지 오늘은 여기";
  /** 이모지가 없고 유형 이모지도 없을 때. */
  static final String DEFAULT_EMOJI = "✨";

  /** `typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''` */
  private static String str(JsonNode v) {
    return v != null && v.isTextual() ? Text.collapse(v.asText()) : "";
  }

  /** 이모지 하나만 (ZWJ·변형 선택자 포함). 아니면 빈 문자열. */
  static String oneEmoji(JsonNode v) {
    Matcher m = ONE_EMOJI.matcher(str(v));
    return m.find() ? m.group() : "";
  }

  /**
   * @param raw 모델 출력
   * @param req 요청 (카탈로그와 블록 목록)
   * @return 제대로 지어진 블록만, 요청 순서가 아니라 모델이 낸 순서
   */
  public static List<PlanBlock> parse(String raw, PlanRequest req) {
    JsonNode j;
    try { j = OM.readTree(raw); }
    catch (Exception e) { return List.of(); }
    if (j == null) return List.of();
    JsonNode blocks = j.path("blocks");
    if (!blocks.isArray()) return List.of();
    Map<String, PlanPlace> byId = new HashMap<>();
    for (PlanPlace p : req.places()) byId.put(p.id(), p);
    Map<String, PlanBlockRequest> asked = new HashMap<>();
    for (PlanBlockRequest b : req.blocks()) asked.put(b.id(), b);
    List<PlanBlock> out = new ArrayList<>();
    Set<String> done = new HashSet<>();
    for (JsonNode b : blocks) {
      if (!b.isObject()) continue;
      String id = str(b.get("id"));
      PlanBlockRequest ask = asked.get(id);
      if (ask == null || done.contains(id)) continue;
      // 정해진 범주가 있으면 그것으로 고정, 없으면 모델이 낸 것 — 아는 범주일 때만
      String said = str(b.get("category"));
      String category = ask.category() != null ? ask.category() : PLAN_CATEGORIES.contains(said) ? said : null;
      if (category == null) continue;
      List<String> types = TYPES_FOR.get(category);
      Set<String> seen = new HashSet<>();
      List<PlanOption> options = new ArrayList<>();
      JsonNode os = b.get("options");
      if (os != null && os.isArray()) {
        for (JsonNode o : os) {
          if (!o.isObject()) continue;
          String placeId = str(o.get("placeId"));
          PlanPlace place = byId.get(placeId);
          if (place == null || seen.contains(placeId) || !types.contains(place.type())) continue;
          String title = Text.cut(str(o.get("title")), MAX_TITLE);
          if (title.isEmpty()) continue;
          seen.add(placeId);
          String reason = Text.cut(str(o.get("reason")), MAX_REASON);
          String emoji = oneEmoji(o.get("emoji"));
          if (emoji.isEmpty()) emoji = TYPE_EMOJI.getOrDefault(place.type(), DEFAULT_EMOJI);
          options.add(new PlanOption(placeId, title, reason.isEmpty() ? DEFAULT_REASON : reason, emoji));
          if (options.size() >= OPTIONS_PER_BLOCK) break;
        }
      }
      if (options.size() < 2) continue;
      done.add(id);
      out.add(new PlanBlock(id, category, options));
    }
    return out;
  }
}
