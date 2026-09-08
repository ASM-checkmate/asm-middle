package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;

/**
 * POST /api/warm (docs/CONTRACT.md, 옛 Node 백엔드 server.ts(커밋 2808024):215-221). 모델 예열 — 벨이 울리거나 대화 실을 열 때 프론트가 부른다.
 * 본문 `{ tier }` — 없거나 이상하면 small. 답은 `{ ok:true, model }`, Ollama가 없으면 502.
 */
@RestController
public class WarmController {
  private static final Logger log = LoggerFactory.getLogger(WarmController.class);
  private final OllamaClient ollama;
  private final TheworldProps props;

  public WarmController(OllamaClient ollama, TheworldProps props) {
    this.ollama = ollama;
    this.props = props;
  }

  @PostMapping("/api/warm")
  public Map<String, Object> warm(@RequestBody(required = false) JsonNode body) {
    String tier = body != null && body.path("tier").isTextual() && body.get("tier").asText().equals("good") ? "good" : "small";
    String model = tier.equals("good") ? props.models().good() : props.models().small();
    try {
      ollama.warm(model);
    } catch (OllamaException e) {
      log.warn("[warm] {} failed: {}", model, e.getMessage());
      throw new ApiException(502, e.getMessage() == null ? "warm failed" : e.getMessage());
    }
    return Map.of("ok", true, "model", model);
  }
}
