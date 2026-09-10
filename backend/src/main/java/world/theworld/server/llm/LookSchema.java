package world.theworld.server.llm;

import java.util.List;
import java.util.Map;

/** 사진 → 겉모습 응답 형식. 여섯 칸은 enum, seen은 문자열. 전부 필수 — 빠지거나 벗어난 값은 파서가 기본값으로 메운다. */
public final class LookSchema {
  private LookSchema() {}

  public static Map<String, Object> of() {
    return Schema.of(
      "type", "object",
      "properties", Schema.of(
        "skin", Schema.of("type", "string", "enum", LlmDtos.LOOK_SKINS),
        "hairColor", Schema.of("type", "string", "enum", LlmDtos.LOOK_HAIR_COLORS),
        "hairStyle", Schema.of("type", "string", "enum", LlmDtos.LOOK_HAIR_STYLES),
        "glasses", Schema.of("type", "string", "enum", LlmDtos.LOOK_GLASSES),
        "beard", Schema.of("type", "string", "enum", LlmDtos.LOOK_BEARDS),
        "top", Schema.of("type", "string", "enum", LlmDtos.LOOK_TOPS),
        "seen", Schema.of("type", "string")),
      "required", List.of("skin", "hairColor", "hairStyle", "glasses", "beard", "top", "seen"));
  }
}
