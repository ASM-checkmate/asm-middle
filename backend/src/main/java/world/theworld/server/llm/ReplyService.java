package world.theworld.server.llm;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.regex.Pattern;
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
    String text = r.text();
    if (text != null && leaksCrushName(req, text)) {
      log.debug("[reply] dropped: crush name came up unprompted");
      text = null;   // 틀린 말보다 침묵 — 프론트는 규칙 기반 답장을 쓴다
    }
    ReplyResponse out = new ReplyResponse(text, r.worry(), r.callMe(), r.trip(), model, System.currentTimeMillis() - t0);
    // INFO에는 크기·플래그만 — 사용자의 말과 답장 원문은 DEBUG에만 (Node 원본은 INFO에 찍었지만 프로덕션 로그에 대화가 쌓이지 않게)
    log.info("[reply] {} {}ms {} texts → {}{}{}{}", out.model(), out.ms(), req.texts().size(), out.text() == null ? "null" : out.text().length() + " chars",
      out.worry() != null ? " worry=" + out.worry() : "", out.callMe() ? " callMe" : "", out.trip() != null ? " trip" : "");
    if (log.isDebugEnabled()) {
      log.debug("[reply] {} → {}{}", req.texts(), out.text() == null ? "null" : "\"" + out.text() + "\"", out.trip() != null ? " trip=" + out.trip() : "");
    }
    return out;
  }

  /**
   * "이름은 먼저 꺼내지 않는다"(ReplyPrompt.CRUSH_RULE, AFFECTION_SPEC §4)의 서버 쪽 뒷받침 — 모델이 프롬프트에만 있던 설렘 대상의 이름을 답장에
   * 냈는데 사용자·최근 대화 어디에도 그 이름이 없으면 먼저 꺼낸 것이다. 누가 이미 그 이름을 꺼냈으면(“하늘이 어때?”) 답장은 그대로.
   * 답장에서는 **사람 이름꼴**만 본다({@link #nameForm}) — 이름이 흔한 낱말이면(하나 = 1, 지우 ⊂ 지우개·지우고) "커피 하나만"이 이름으로 잡혀 답장이 통째로
   * 사라진다. 사용자·최근 대화 쪽은 느슨하게(부분 일치) — 누가 꺼냈는지 애매하면 답장을 살리는 쪽이다.
   */
  static boolean leaksCrushName(ReplyRequest req, String text) {
    if (req.situation().crush() == null) return false;
    String name = req.situation().crush().name();
    if (!nameForm(name).matcher(text).find()) return false;
    if (req.texts().stream().anyMatch(t -> t.contains(name))) return false;
    return req.recent().stream().noneMatch(m -> m.text().contains(name));
  }

  /** 뒤에 붙을 수 있는 조사 — 사람 이름 뒤에 오는 것만 (만·도·고는 뺀다: "하나만"·"하나도"·"지우고"). */
  private static final String NAME_JOSA = "(?:이가|가|는|은|을|를|이랑|랑|와|과|한테|에게|야|의|네|보고|하고)";

  /**
   * 답장 속 이름꼴. 한글 이름은 부르는 꼴({@link Text#calling}: 하늘이·유리) 뒤에 조사가 오거나 글자가 끝나야 하고 앞뒤에 다른 한글이 붙으면 안 된다;
   * 받침 없는 이름(하나·유리)은 부르는 꼴이 이름 그대로라 조사가 있어야 이름이다 ("하나가 좋아"는 잡고 "커피 하나 마셔"는 안 잡는다).
   * 한글이 아닌 이름(Amy)은 단어 경계.
   */
  static Pattern nameForm(String name) {
    char c = name.isEmpty() ? ' ' : name.charAt(name.length() - 1);
    boolean hangul = c >= 0xAC00 && c <= 0xD7A3;
    if (!hangul) return Pattern.compile("(?<![\\p{L}\\p{N}])" + Pattern.quote(name) + "(?![\\p{L}\\p{N}])");
    String who = Text.calling(name);
    String josa = who.equals(name) ? NAME_JOSA : NAME_JOSA + "?";
    return Pattern.compile("(?<![가-힣])" + Pattern.quote(who) + josa + "(?![가-힣])");
  }
}
