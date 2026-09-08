package world.theworld.server.llm;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** 그림 읽기 응답 형식 (옛 Node 백엔드 sketch.ts(커밋 0298e8d) sketchSchema). optionId는 옵션 id 중 하나거나 null. */
public final class SketchSchema {
  private SketchSchema() {}

  public static Map<String, Object> of(List<String> ids) {
    return Schema.of(
      "type", "object",
      "properties", Schema.of(
        "seen", Schema.of("type", "string"),
        "optionId", Schema.of("type", Arrays.asList("string", null), "enum", Schema.withNull(ids)),
        "category", Schema.of("type", Arrays.asList("string", null), "enum", Schema.withNull(LlmDtos.SKETCH_CATEGORIES))),
      "required", List.of("seen", "optionId", "category"));
  }
}
