package world.theworld.server.llm;

import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmDtos.ModelsResponse;
import world.theworld.server.llm.LlmDtos.TierInfo;
import world.theworld.server.llm.LlmDtos.Tiers;

/** GET /api/models → 어느 모델이 어느 단계인지, 설치돼 있는지 (docs/CONTRACT.md, server.ts:96-103). 공개 경로. */
@RestController
public class ModelsController {
  private final OllamaClient ollama;
  private final TheworldProps props;

  public ModelsController(OllamaClient ollama, TheworldProps props) {
    this.ollama = ollama;
    this.props = props;
  }

  @GetMapping("/api/models")
  public ModelsResponse models() {
    Set<String> have = ollama.installedModels();
    String small = props.models().small(), good = props.models().good();
    return new ModelsResponse(
      new Tiers(new TierInfo(small, have != null && have.contains(small)), new TierInfo(good, have != null && have.contains(good))),
      have != null);
  }
}
