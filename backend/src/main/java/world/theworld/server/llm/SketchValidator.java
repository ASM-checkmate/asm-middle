package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.SketchOption;
import world.theworld.server.llm.LlmDtos.SketchReadRequest;

/** POST /api/sketch/read 요청 검증 (옛 Node 백엔드 server.ts(커밋 0298e8d) validateSketch 그대로). 오류 문자열은 계약(§2.4)에 고정. */
public final class SketchValidator {
  private SketchValidator() {}

  /** 240px PNG dataURL — 프론트 SketchOverlay가 만든 그대로. */
  public static final Pattern DATA_URL = Pattern.compile("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$");

  public static SketchReadRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (!ReplyValidator.isText(tier) || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode sketch = b.get("sketch");
    if (!ReplyValidator.isText(sketch) || !DATA_URL.matcher(sketch.asText()).matches()) throw ApiException.badRequest("sketch must be an image dataURL");
    JsonNode category = b.get("category");
    if (!ReplyValidator.isText(category)) throw ApiException.badRequest("category required");
    JsonNode options = b.get("options");
    if (options == null || !options.isArray() || options.isEmpty() || options.size() > 8) throw ApiException.badRequest("options must have 1-8 items");
    for (JsonNode x : options) if (!x.isObject() || !ReplyValidator.isText(x.get("id")) || !ReplyValidator.isText(x.get("title"))) throw ApiException.badRequest("option.id/title required");
    List<SketchOption> out = new ArrayList<>();
    for (JsonNode x : options) {
      JsonNode pn = x.get("placeName"), pt = x.get("placeType");
      out.add(new SketchOption(x.get("id").asText(), Text.cut(x.get("title").asText(), 80),
        ReplyValidator.isText(pn) ? Text.cut(pn.asText(), 40) : "", ReplyValidator.isText(pt) ? pt.asText() : ""));
    }
    return new SketchReadRequest(tier.asText(), sketch.asText(), category.asText(), out);
  }
}
