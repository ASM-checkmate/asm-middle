package world.theworld.server.llm;

import static world.theworld.server.llm.PlanDtos.PLAN_BLOCKS;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.OllamaClient.Cancel;
import world.theworld.server.llm.PlanDtos.PlanBlock;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanResponse;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/**
 * 블록들의 카드를 짓는다 (옛 Node 백엔드 plan.ts(커밋 2808024) planBlocks와 server.ts의 /api/plan/options 처리, ADR-0010).
 * 낮은 우선순위 생성이다 — 하루 계획은 20~60초라 통화 앞을 막으므로 {@link ModelLane}에 손잡이를 맡겨 두고, 통화 턴이 오면 끊긴다
 * (503 'yielded to call'). 제한 시간은 블록 하나면 카드 고르는 몇 초(20초), 하루면 넉넉히(120초) — 프론트의 기다림도 그에 맞춘다
 * (docs/CONTRACT.md). 어느 쪽이든 실패하면 프론트는 규칙 카드를 쓴다.
 */
@Service
public class PlanService {
  private static final Logger log = LoggerFactory.getLogger(PlanService.class);
  /** 생성 옵션 (plan.ts:139) — 답장보다 차분하게, 최대 토큰은 블록 수에 비례 (`120 + 260 * blocks`). */
  public static final double TEMPERATURE = 0.7;
  public static final int NUM_PREDICT_BASE = 120;
  public static final int NUM_PREDICT_PER_BLOCK = 260;

  private final OllamaClient ollama;
  private final TheworldProps props;
  private final ModelLane lane;

  public PlanService(OllamaClient ollama, TheworldProps props, ModelLane lane) {
    this.ollama = ollama;
    this.props = props;
    this.lane = lane;
  }

  /** tier → 모델 태그 (server.ts MODELS). */
  String modelFor(String tier) {
    return tier.equals("good") ? props.models().good() : props.models().small();
  }

  /** 블록 수에 따른 최대 토큰. */
  static int numPredict(int blocks) {
    return NUM_PREDICT_BASE + NUM_PREDICT_PER_BLOCK * blocks;
  }

  /**
   * @param req 검증된 요청
   * @throws ApiException 503 통화에 양보해 끊김 · 502 Ollama 오류·제한 시간
   */
  public PlanResponse plan(PlanRequest req) {
    long t0 = System.currentTimeMillis();
    String model = modelFor(req.tier());
    Prompt p = PlanPrompt.build(req);
    List<String> blockIds = req.blocks().stream().map(PlanBlockRequest::id).filter(PLAN_BLOCKS::contains).toList();
    List<String> placeIds = req.places().stream().map(PlanPlace::id).toList();
    // 블록 하나면 카드 고르는 몇 초, 하루면 넉넉히 (server.ts:258)
    long timeoutMs = req.blocks().size() == 1 ? props.plan().oneTimeoutMs() : props.plan().dayTimeoutMs();
    // 낮은 우선순위 — 통화 턴이 오면 끊긴다 (ModelLane, ADR-0011 결정 6)
    Cancel cancel = lane.lowPriority();
    String raw;
    try {
      raw = ollama.chatJson(model, p.system(), p.user(), PlanPrompt.schema(placeIds, blockIds), null, TEMPERATURE, numPredict(blockIds.size()), timeoutMs, cancel);
    } catch (OllamaCancelledException e) {
      log.info("[plan] yielded");
      throw new ApiException(503, "yielded to call");
    } catch (RuntimeException e) {
      log.warn("[plan] failed: {}", e.getMessage());
      throw new ApiException(502, e.getMessage() == null ? "plan failed" : e.getMessage());
    } finally {
      lane.release(cancel);
    }
    List<PlanBlock> blocks = PlanParser.parse(raw, req);
    return new PlanResponse(blocks, model, System.currentTimeMillis() - t0);
  }
}
