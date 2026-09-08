package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.llm.LlmDtos.SketchReadResponse;

/** POST /api/sketch/read (docs/CONTRACT.md, ADR-0007). 본문 상한 512 KB는 common/BodyLimitFilter가 본다. */
@RestController
public class SketchController {
  private final SketchService service;

  public SketchController(SketchService service) { this.service = service; }

  @PostMapping("/api/sketch/read")
  public SketchReadResponse read(@RequestBody(required = false) JsonNode body) {
    return service.read(SketchValidator.validate(body));
  }
}
