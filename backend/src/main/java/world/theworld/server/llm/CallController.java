package world.theworld.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.OllamaClient.Cancel;

/**
 * POST /api/call/turn (docs/CONTRACT.md, 옛 Node 백엔드 server.ts(커밋 2808024):222-243). ndjson 스트림 — 문장이 완성될 때마다 {@code {"s":"…"}} 한 줄,
 * 끝에 {@code {"done":true,"model":…,"ms":…}}. 검증(400)은 첫 바이트를 쓰기 전에 끝나므로 보통의 JSON 오류로 나가고, 그 뒤의 Ollama 오류는
 * 헤더가 이미 나간 터라 {@code {"error":"…"}} 한 줄로 끝난다(상태는 200 그대로 — 프론트는 통화를 이어 간다).
 *
 * <p>응답은 요청 스레드에서 동기로 쓴다(비동기 디스패치 없음) — 가상 스레드라 기다리는 값이 싸고, MockMvc도 본문을 그대로 본다.
 * 끼어들기: 사용자가 말을 시작하면 프론트가 요청을 닫는다. 서블릿은 그 닫힘을 이벤트로 주지 않으므로(Node의 req.on('close')) 다음 문장을 쓰다
 * IOException이 나는 순간 {@link Cancel}로 Ollama 생성을 멈춘다 — 한 문장 늦지만 27B가 독백을 끝까지 돌리지는 않는다.
 */
@RestController
public class CallController {
  private static final Logger log = LoggerFactory.getLogger(CallController.class);
  public static final String NDJSON = "application/x-ndjson";

  private final CallService service;
  private final ObjectMapper om;

  public CallController(CallService service, ObjectMapper om) {
    this.service = service;
    this.om = om;
  }

  @PostMapping(value = "/api/call/turn", produces = NDJSON)
  public void turn(@RequestBody(required = false) JsonNode body, HttpServletResponse res) {
    CallTurnRequest req = CallValidator.validate(body);   // 여기까지의 예외는 GlobalExceptionHandler의 보통 JSON(400)
    String model = service.modelFor(req.tier());
    res.setStatus(200);
    res.setContentType(NDJSON + "; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    ServletOutputStream out;
    try {
      out = res.getOutputStream();
      res.flushBuffer();   // 헤더를 먼저 보낸다 — 프론트의 fetch가 첫 문장 전에 풀린다 (writeHead)
    } catch (IOException e) {
      log.debug("[call] client gone before the first byte: {}", e.getMessage());
      return;
    }
    Cancel cancel = new Cancel();
    long t0 = System.currentTimeMillis();
    try {
      List<String> lines = service.turn(req, s -> line(out, Map.of("s", s)), cancel);
      long ms = System.currentTimeMillis() - t0;
      Map<String, Object> done = new LinkedHashMap<>();
      done.put("done", true);
      done.put("model", model);
      done.put("ms", ms);
      // INFO에는 크기만 — 들은 말과 한 말의 원문은 DEBUG에만 (ReplyService와 같은 규칙). done 줄을 쓰기 전에 남긴다 — 마지막 문장 뒤에 끊겨도 기록은 남게
      log.info("[call] {} {}ms {} user={} → {} sentence(s)", model, ms, req.why(), req.user() == null ? "null" : req.user().length() + " chars", lines.size());
      if (log.isDebugEnabled()) log.debug("[call] {} → {}", req.user() == null ? "null" : "\"" + req.user() + "\"", lines);
      line(out, done);
    } catch (UncheckedIOException e) {
      // 프론트가 요청을 닫았다(끼어들기) — Ollama도 멈추고 조용히 끝낸다 (server.ts:232, 239)
      cancel.cancel();
      log.debug("[call] client closed the stream: {}", e.getMessage());
    } catch (RuntimeException e) {
      if (!cancel.cancelled()) log.warn("[call] failed: {}", e.getMessage());
      try { line(out, Map.of("error", e.getMessage() == null ? "call failed" : e.getMessage())); }
      catch (UncheckedIOException ignored) { /* 닫힘 */ }
    }
  }

  /** ndjson 한 줄 — 쓰고 바로 밀어낸다. 클라이언트가 끊었으면 IOException을 UncheckedIOException으로 감싸 생성 루프 밖으로 던진다. */
  private void line(ServletOutputStream out, Map<String, ?> obj) {
    try {
      out.write((om.writeValueAsString(obj) + "\n").getBytes(StandardCharsets.UTF_8));
      out.flush();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
