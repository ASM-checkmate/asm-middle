package world.theworld.server.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.LlmDtos.RecentMsg;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.Situation;
import world.theworld.server.llm.LlmDtos.SketchOption;
import world.theworld.server.llm.LlmDtos.SketchReadRequest;

/** 테스트 공통 — Node harness(옛 Node 백엔드 scripts/*.test.mjs(커밋 0298e8d))의 고정 요청과 로컬 HTTP 서버 도우미. */
public final class LlmFixtures {
  private LlmFixtures() {}

  public static final ObjectMapper OM = new ObjectMapper();

  /** reply.test.mjs:9-15 */
  public static ReplyRequest replyReq() {
    return new ReplyRequest("small",
      new Agent("모모", List.of("느긋한"), List.of("카페"), List.of()),
      new Situation("연남동 카페", "커피 마시는 중", "16:25", null, 70, 20, null),
      List.of(new RecentMsg("me", "잘 지내?"), new RecentMsg("agent", "나야 좋지! 너는?")),
      List.of("야", "어디야", "뭐해"), null);
  }

  public static ReplyRequest withSituation(ReplyRequest r, Situation s) {
    return new ReplyRequest(r.tier(), r.agent(), s, r.recent(), r.texts(), r.batch());
  }

  /** sketch.test.mjs:7-11 */
  public static SketchReadRequest sketchReq() {
    return new SketchReadRequest("good", "data:image/png;base64,AAAA", "play", List.of(
      new SketchOption("a", "레이어드에서 커피", "레이어드 연남", "cafe"),
      new SketchOption("b", "경의선숲길 산책", "경의선숲길", "park"),
      new SketchOption("c", "펀시티에서 오락실 한 판", "펀시티 홍대점", "arcade")));
  }

  /** 기본값 그대로의 설정 — 주소만 바꿔 끼운다. */
  public static TheworldProps props(String ollamaUrl, String apiKey, String nominatimUrl, long deadlineMs) {
    return new TheworldProps(
      new TheworldProps.Cors("http://localhost:5173"),
      new TheworldProps.Ollama(ollamaUrl, 25_000),
      new TheworldProps.Models("qwen3.5:9b", "qwen3.8:27b"),
      new TheworldProps.Trip("", 90_000, deadlineMs, 22_000),
      new TheworldProps.Plan(20_000, 120_000),
      new TheworldProps.Search(apiKey),
      new TheworldProps.Nominatim(nominatimUrl, "", 0),
      new TheworldProps.Docs(4_194_304));
  }

  /**
   * 골든 프롬프트 — backend/src/{reply,sketch,trip}.ts의 buildPrompt/buildSketchPrompt/buildTripPrompt를 같은 고정 요청으로 실행해 뽑은 전체 문자열
   * (src/test/resources/golden/*.txt). "글자 단위로 옮긴다"(BACKEND-CONTRACT §2.4)를 부분 문자열이 아니라 동일성으로 고정한다.
   */
  public static String golden(String name) {
    try (var in = LlmFixtures.class.getResourceAsStream("/golden/" + name + ".txt")) {
      if (in == null) throw new IllegalStateException("golden missing: " + name);
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  public static HttpServer server() throws IOException {
    HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    s.start();
    return s;
  }

  public static String url(HttpServer s) { return "http://127.0.0.1:" + s.getAddress().getPort(); }

  public static void respond(com.sun.net.httpserver.HttpExchange ex, int status, String body) throws IOException {
    byte[] b = body.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("content-type", "application/json");
    ex.sendResponseHeaders(status, b.length);
    ex.getResponseBody().write(b);
    ex.close();
  }
}
