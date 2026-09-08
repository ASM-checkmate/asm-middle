package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import world.theworld.server.llm.LlmDtos.SketchParsed;

/** 그림 읽기 파서 (옛 Node 백엔드 sketch.ts(커밋 0298e8d) parseSketchRead). optionId가 옵션에 없으면 null. */
public final class SketchParser {
  private SketchParser() {}

  private static final ObjectMapper OM = new ObjectMapper();
  private static final SketchParsed NONE = new SketchParsed(null, "", null);

  /**
   * @param raw 모델 출력
   * @param ids 유효한 옵션 id
   */
  public static SketchParsed parse(String raw, List<String> ids) {
    JsonNode j;
    try { j = OM.readTree(raw); }
    catch (Exception e) { return NONE; }
    if (j == null || !j.isObject()) return NONE;
    String seen = j.path("seen").isTextual() ? Text.cut(Text.collapse(j.get("seen").asText()), SketchPrompt.MAX_SEEN) : "";
    JsonNode o = j.path("optionId");
    String optionId = o.isTextual() && ids.contains(o.asText()) ? o.asText() : null;
    JsonNode c = j.path("category");
    String category = c.isTextual() && LlmDtos.SKETCH_CATEGORIES.contains(c.asText()) ? c.asText() : null;
    return new SketchParsed(optionId, seen, category);
  }
}
