package world.theworld.server.llm;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmDtos.SketchOption;
import world.theworld.server.llm.LlmDtos.SketchParsed;
import world.theworld.server.llm.LlmDtos.SketchReadRequest;
import world.theworld.server.llm.LlmDtos.SketchReadResponse;

/** 그림 하나를 읽는다 (옛 Node 백엔드 sketch.ts(커밋 0298e8d) readSketch). 옵션은 답장용 기본값(0.9·160·LLM_TIMEOUT_MS). */
@Service
public class SketchService {
  private static final Logger log = LoggerFactory.getLogger(SketchService.class);

  private final OllamaClient ollama;
  private final TheworldProps props;

  public SketchService(OllamaClient ollama, TheworldProps props) {
    this.ollama = ollama;
    this.props = props;
  }

  /** @throws ApiException 502 — Ollama 오류·제한 시간 (프론트는 못 읽은 것으로 본다) */
  public SketchReadResponse read(SketchReadRequest req) {
    long t0 = System.currentTimeMillis();
    String model = req.tier().equals("good") ? props.models().good() : props.models().small();
    List<String> ids = req.options().stream().map(SketchOption::id).toList();
    String image = req.sketch().replaceFirst("^data:image/\\w+;base64,", "");
    String raw;
    try {
      raw = ollama.chatJson(model, SketchPrompt.SYSTEM, SketchPrompt.build(req), SketchSchema.of(ids), List.of(image),
        OllamaClient.DEFAULT_TEMPERATURE, OllamaClient.DEFAULT_NUM_PREDICT, props.ollama().timeoutMs());
    } catch (RuntimeException e) {
      log.warn("[sketch] failed: {}", e.getMessage());
      throw new ApiException(502, e.getMessage() == null ? "sketch failed" : e.getMessage());
    }
    SketchParsed p = SketchParser.parse(raw, ids);
    SketchReadResponse out = new SketchReadResponse(p.optionId(), p.seen(), p.category(), model, System.currentTimeMillis() - t0);
    // INFO에는 결과 id·범주만 — 모델이 본 것(seen)과 사용자의 계획 제목들은 DEBUG에만 (ReplyService와 같은 이유)
    log.info("[sketch] {} {}ms cat={} → {} of {}", out.model(), out.ms(), out.category() == null ? "null" : out.category(),
      out.optionId() == null ? "null" : out.optionId(), req.options().size());
    if (log.isDebugEnabled()) log.debug("[sketch] seen=\"{}\" options=[{}]", out.seen(), String.join(" | ", req.options().stream().map(SketchOption::title).toList()));
    return out;
  }
}
