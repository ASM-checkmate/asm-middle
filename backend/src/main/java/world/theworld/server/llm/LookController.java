package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.llm.LlmDtos.LookResponse;

/** POST /api/character/look (docs/CONTRACT.md). 본문 상한 1.5 MB는 common/BodyLimitFilter가 본다. */
@RestController
public class LookController {
  private final LookService service;

  public LookController(LookService service) { this.service = service; }

  @PostMapping("/api/character/look")
  public LookResponse read(@RequestBody(required = false) JsonNode body) {
    return service.read(LookValidator.validate(body));
  }
}
