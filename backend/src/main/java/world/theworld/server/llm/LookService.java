package world.theworld.server.llm;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmDtos.Look;
import world.theworld.server.llm.LlmDtos.LookParsed;
import world.theworld.server.llm.LlmDtos.LookRequest;
import world.theworld.server.llm.LlmDtos.LookResponse;

/** 사진 한 장을 캐릭터 겉모습 옵션으로 옮긴다 (docs/CONTRACT.md POST /api/character/look). 옵션은 낮은 온도(0.2)·짧은 출력(200). */
@Service
public class LookService {
  private static final Logger log = LoggerFactory.getLogger(LookService.class);
  static final double TEMPERATURE = 0.2;
  static final int NUM_PREDICT = 200;

  private final OllamaClient ollama;
  private final TheworldProps props;

  public LookService(OllamaClient ollama, TheworldProps props) {
    this.ollama = ollama;
    this.props = props;
  }

  /** @throws ApiException 502 — Ollama 오류·제한 시간 */
  public LookResponse read(LookRequest req) {
    long t0 = System.currentTimeMillis();
    String model = req.tier().equals("good") ? props.models().good() : props.models().small();
    String image = req.photo().replaceFirst("^data:image/\\w+;base64,", "");
    String raw;
    try {
      raw = ollama.chatJson(model, LookPrompt.SYSTEM, LookPrompt.build(), LookSchema.of(), List.of(image), TEMPERATURE, NUM_PREDICT, props.ollama().timeoutMs());
    } catch (RuntimeException e) {
      log.warn("[look] failed: {}", e.getMessage());
      throw new ApiException(502, e.getMessage() == null ? "look failed" : e.getMessage());
    }
    LookParsed p = LookParser.parse(raw);
    LookResponse out = new LookResponse(p.look(), p.seen(), model, System.currentTimeMillis() - t0);
    Look l = out.look();
    // INFO에는 옵션만 — 모델이 본 문장(seen)은 사람의 겉모습 묘사라 DEBUG에만
    log.info("[look] {} {}ms skin={} hair={}/{} glasses={} beard={} top={}", out.model(), out.ms(), l.skin(), l.hairColor(), l.hairStyle(), l.glasses(), l.beard(), l.top());
    if (log.isDebugEnabled()) log.debug("[look] seen=\"{}\"", out.seen());
    return out;
  }
}
