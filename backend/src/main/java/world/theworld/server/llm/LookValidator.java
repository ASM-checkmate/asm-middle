package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.regex.Pattern;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.LookRequest;

/** POST /api/character/look 요청 검증. 오류 문자열은 계약에 고정. */
public final class LookValidator {
  private LookValidator() {}

  /** 프런트가 줄여 보낸 사진 dataURL (JPEG·PNG·WebP). */
  public static final Pattern DATA_URL = Pattern.compile("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$");

  public static LookRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (!ReplyValidator.isText(tier) || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode photo = b.get("photo");
    if (!ReplyValidator.isText(photo) || !DATA_URL.matcher(photo.asText()).matches()) throw ApiException.badRequest("photo must be an image dataURL");
    return new LookRequest(tier.asText(), photo.asText());
  }
}
