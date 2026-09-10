package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import world.theworld.server.llm.LlmDtos.Look;
import world.theworld.server.llm.LlmDtos.LookParsed;

/** 사진 → 겉모습 파서. 빠지거나 enum 밖인 칸은 기본값(LlmDtos.LOOK_DEFAULT) — 사진 하나로 캐릭터가 깨지지 않게. */
public final class LookParser {
  private LookParser() {}

  private static final ObjectMapper OM = new ObjectMapper();
  private static final LookParsed NONE = new LookParsed(LlmDtos.LOOK_DEFAULT, "");

  public static LookParsed parse(String raw) {
    JsonNode j;
    try { j = OM.readTree(raw); }
    catch (Exception e) { return NONE; }
    if (j == null || !j.isObject()) return NONE;
    Look d = LlmDtos.LOOK_DEFAULT;
    Look look = new Look(
      pick(j, "skin", LlmDtos.LOOK_SKINS, d.skin()),
      pick(j, "hairColor", LlmDtos.LOOK_HAIR_COLORS, d.hairColor()),
      pick(j, "hairStyle", LlmDtos.LOOK_HAIR_STYLES, d.hairStyle()),
      pick(j, "glasses", LlmDtos.LOOK_GLASSES, d.glasses()),
      pick(j, "beard", LlmDtos.LOOK_BEARDS, d.beard()),
      pick(j, "top", LlmDtos.LOOK_TOPS, d.top()));
    String seen = j.path("seen").isTextual() ? Text.cut(Text.collapse(j.get("seen").asText()), LookPrompt.MAX_SEEN) : "";
    return new LookParsed(look, seen);
  }

  private static String pick(JsonNode j, String key, List<String> allowed, String fallback) {
    JsonNode n = j.path(key);
    return n.isTextual() && allowed.contains(n.asText()) ? n.asText() : fallback;
  }
}
