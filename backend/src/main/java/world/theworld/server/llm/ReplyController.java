package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.llm.LlmDtos.ReplyResponse;

/** POST /api/chat/reply (docs/CONTRACT.md). 400 계약 위반, 502 Ollama 오류·제한 시간. */
@RestController
public class ReplyController {
  private final ReplyService service;

  public ReplyController(ReplyService service) { this.service = service; }

  @PostMapping("/api/chat/reply")
  public ReplyResponse reply(@CurrentUser AppUser me, @RequestBody(required = false) JsonNode body) {
    return service.reply(me.getId(), ReplyValidator.validate(body));
  }
}
