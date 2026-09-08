package world.theworld.server.llm;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmDtos.ReplyParsed;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.ReplyResponse;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/**
 * 요청 하나에 답장 하나 (옛 Node 백엔드 reply.ts(커밋 0298e8d) replyFor). 모델을 부르고 결과를 다듬는다.
 * 같은 (user, batch)의 진행 중 호출은 새 호출이 오면 취소한다 (BACKEND-CONTRACT §2.4) — 프런트는 같은 묶음의 이전 요청을 abort하지만
 * 서블릿은 그 끊김을 Ollama까지 전하지 않으므로 서버가 직접 이전 Future를 cancel(true)해 27B 생성을 멈춘다.
 */
@Service
public class ReplyService {
  private static final Logger log = LoggerFactory.getLogger(ReplyService.class);

  private final OllamaClient ollama;
  private final TheworldProps props;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final ConcurrentHashMap<String, Future<?>> inflight = new ConcurrentHashMap<>();

  public ReplyService(OllamaClient ollama, TheworldProps props) {
    this.ollama = ollama;
    this.props = props;
  }

  @PreDestroy
  void shutdown() { executor.shutdownNow(); }

  /** tier → 모델 태그 (server.ts MODELS). */
  String modelFor(String tier) {
    return tier.equals("good") ? props.models().good() : props.models().small();
  }

  /** 진행 중인 묶음 수 — 테스트용. */
  int inflightCount() { return inflight.size(); }

  /**
   * @param userId 요청한 사용자 — 취소 키의 절반
   * @param req 검증된 요청
   * @throws ApiException 502 — Ollama 오류·제한 시간·같은 묶음의 새 호출에 밀려 취소됨 (프론트는 규칙 기반 답장을 그대로 쓴다)
   */
  public ReplyResponse reply(String userId, ReplyRequest req) {
    String model = modelFor(req.tier());
    if (req.batch() == null) return generate(req, model);
    String key = userId + ":" + req.batch();
    FutureTask<ReplyResponse> task = new FutureTask<>(() -> generate(req, model));
    Future<?> prev = inflight.put(key, task);
    if (prev != null) prev.cancel(true);   // 앞선 묶음 호출을 끊는다 — 답은 마지막 묶음에만 필요하다
    executor.execute(task);
    try {
      return task.get();
    } catch (CancellationException e) {
      throw new ApiException(502, "reply cancelled: newer request for batch " + req.batch());
    } catch (ExecutionException e) {
      Throwable c = e.getCause();
      if (c instanceof ApiException a) throw a;
      throw new ApiException(502, c == null || c.getMessage() == null ? "reply failed" : c.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      task.cancel(true);
      throw new ApiException(502, "reply interrupted");
    } finally {
      inflight.remove(key, task);
    }
  }

  ReplyResponse generate(ReplyRequest req, String model) {
    long t0 = System.currentTimeMillis();
    Prompt p = ReplyPrompt.build(req);
    String raw;
    try {
      raw = ollama.chatJson(model, p.system(), p.user(), ReplyPrompt.REPLY_SCHEMA, null, OllamaClient.DEFAULT_TEMPERATURE, OllamaClient.DEFAULT_NUM_PREDICT, props.ollama().timeoutMs());
    } catch (RuntimeException e) {
      log.warn("[reply] failed: {}", e.getMessage());
      throw new ApiException(502, e.getMessage() == null ? "reply failed" : e.getMessage());
    }
    ReplyParsed r = ReplyParser.parse(raw);
    ReplyResponse out = new ReplyResponse(r.text(), r.worry(), r.callMe(), r.trip(), model, System.currentTimeMillis() - t0);
    // INFO에는 크기·플래그만 — 사용자의 말과 답장 원문은 DEBUG에만 (Node 원본은 INFO에 찍었지만 프로덕션 로그에 대화가 쌓이지 않게)
    log.info("[reply] {} {}ms {} texts → {}{}{}{}", out.model(), out.ms(), req.texts().size(), out.text() == null ? "null" : out.text().length() + " chars",
      out.worry() != null ? " worry=" + out.worry() : "", out.callMe() ? " callMe" : "", out.trip() != null ? " trip" : "");
    if (log.isDebugEnabled()) {
      log.debug("[reply] {} → {}{}", req.texts(), out.text() == null ? "null" : "\"" + out.text() + "\"", out.trip() != null ? " trip=" + out.trip() : "");
    }
    return out;
  }
}
