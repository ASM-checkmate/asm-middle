package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.llm.PlanDtos.PlanOption;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanResponse;

/**
 * POST /api/plan/options (docs/CONTRACT.md, ADR-0010; 옛 Node 백엔드 server.ts(커밋 2808024):248-269). 400 계약 위반, 502 Ollama 오류·제한 시간,
 * 503 통화에 양보. 사용자는 필터가 확인하지만 여기서는 쓰지 않는다 — 계획은 요청에 실린 것만으로 짓는다.
 */
@RestController
public class PlanController {
  private static final Logger log = LoggerFactory.getLogger(PlanController.class);
  private final PlanService service;

  public PlanController(PlanService service) { this.service = service; }

  @PostMapping("/api/plan/options")
  public PlanResponse options(@RequestBody(required = false) JsonNode body) {
    PlanRequest req = PlanValidator.validate(body);
    PlanResponse out = service.plan(req);
    // INFO에는 도시·블록 id·범주·카드 수만 — 카드 제목(모델이 지은 말)은 DEBUG에만 (ReplyService와 같은 이유)
    log.info("[plan] {} {}ms {} {} → {}", out.model(), out.ms(), req.city().key(), asked(req), summary(out, false));
    if (log.isDebugEnabled()) log.debug("[plan] {}", summary(out, true));
    return out;
  }

  /** `am:?,lunch:meal` — 요청한 블록과 범주(없으면 ?). */
  static String asked(PlanRequest req) {
    return req.blocks().stream().map(b -> b.id() + ":" + (b.category() == null ? "?" : b.category())).collect(Collectors.joining(","));
  }

  /** Node의 `${id}:${category}[${titles | }]` — titles=false면 카드 수만. 하나도 없으면 'nothing'. */
  static String summary(PlanResponse out, boolean titles) {
    if (out.blocks().isEmpty()) return "nothing";
    return out.blocks().stream()
      .map(b -> b.id() + ":" + b.category() + "[" + (titles ? b.options().stream().map(PlanOption::title).collect(Collectors.joining(" | ")) : b.options().size() + " cards") + "]")
      .collect(Collectors.joining(" ; "));
  }
}
