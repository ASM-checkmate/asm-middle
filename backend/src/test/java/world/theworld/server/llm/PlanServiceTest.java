package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.PlanDtos.PlanBlock;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanResponse;

/**
 * 생성 옵션·제한 시간 선택·차선 등록과 양보 (plan.ts planBlocks, server.ts /api/plan/options). Ollama는 가짜다 — 인자를 기록하고,
 * 시키면 끊길 때까지 기다린다.
 */
class PlanServiceTest {
  /** 파서가 그대로 받는 정상 출력 — am 3장, lunch 2장. */
  static final String OK_RAW = "{\"blocks\":["
    + "{\"id\":\"am\",\"category\":\"study\",\"options\":[{\"placeId\":\"mapo-central-library\",\"title\":\"마포중앙도서관에서 책 읽기\",\"reason\":\"조용한 자리 좋아함\",\"emoji\":\"📚\"},"
    + "{\"placeId\":\"layered-yeonnam\",\"title\":\"레이어드에서 스케치\",\"reason\":\"창가 자리\",\"emoji\":\"☕\"},{\"placeId\":\"home\",\"title\":\"집에서 책\",\"reason\":\"\",\"emoji\":\"🏠\"}]},"
    + "{\"id\":\"lunch\",\"category\":\"meal\",\"options\":[{\"placeId\":\"tuktuk-noodle\",\"title\":\"툭툭누들에서 팟타이\",\"reason\":\"매운 건 빼고\",\"emoji\":\"🍜\"},"
    + "{\"placeId\":\"home\",\"title\":\"집밥\",\"reason\":\"\",\"emoji\":\"🍚\"}]}]}";

  static class FakeOllama extends OllamaClient {
    final AtomicInteger calls = new AtomicInteger();
    final CountDownLatch entered = new CountDownLatch(1);
    volatile String raw = OK_RAW;
    volatile boolean waitForCancel;
    volatile String lastModel;
    volatile double lastTemperature;
    volatile int lastNumPredict;
    volatile long lastTimeout;
    volatile Map<String, Object> lastSchema;
    volatile int pendingDuringCall = -1;
    ModelLane lane;
    FakeOllama() { super("http://127.0.0.1:9", 1_000, LlmFixtures.OM); }

    @Override
    public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs, OllamaClient.Cancel cancel) {
      calls.incrementAndGet();
      lastModel = model; lastTemperature = temperature; lastNumPredict = numPredict; lastTimeout = timeoutMs; lastSchema = schema;
      assertThat(images).isNull();
      assertThat(cancel).isNotNull();
      pendingDuringCall = lane.pending();   // 호출하는 동안 차선에 올라 있다
      entered.countDown();
      if (waitForCancel) {
        long end = System.currentTimeMillis() + 5_000;
        while (!cancel.cancelled() && System.currentTimeMillis() < end) { try { Thread.sleep(10); } catch (InterruptedException e) { break; } }
        if (cancel.cancelled()) throw new OllamaCancelledException();
      }
      if (raw == null) throw new OllamaException("ollama: boom");
      return raw;
    }
  }

  /** 한 벌의 가짜와 서비스. */
  static class Rig {
    final FakeOllama ollama = new FakeOllama();
    final ModelLane lane = new ModelLane();
    final PlanService svc;
    Rig() {
      ollama.lane = lane;
      svc = new PlanService(ollama, LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000), lane);
    }
  }

  private static PlanRequest oneBlock() {
    PlanRequest r = PlanFixtures.planReq();
    return PlanFixtures.withBlocks(r, List.of(r.blocks().get(1)));
  }

  @Test
  @SuppressWarnings("unchecked")
  void oneBlockIsQuickAndOnTheLane() {
    Rig r = new Rig();
    PlanResponse out = r.svc.plan(oneBlock());
    assertThat(r.ollama.calls.get()).isEqualTo(1);
    assertThat(r.ollama.lastModel).isEqualTo("qwen3.5:9b");
    assertThat(r.ollama.lastTemperature).isEqualTo(0.7);
    assertThat(r.ollama.lastNumPredict).isEqualTo(120 + 260);
    assertThat(r.ollama.lastTimeout).isEqualTo(20_000);   // 블록 하나 — theworld.plan.one-timeout-ms
    assertThat(r.ollama.pendingDuringCall).isEqualTo(1);
    assertThat(r.lane.pending()).isZero();   // 끝나면 내려온다
    Map<String, Object> blocks = (Map<String, Object>) ((Map<String, Object>) r.ollama.lastSchema.get("properties")).get("blocks");
    assertThat(blocks.get("minItems")).isEqualTo(1);
    assertThat(out.model()).isEqualTo("qwen3.5:9b");
    assertThat(out.ms()).isGreaterThanOrEqualTo(0);
    assertThat(out.blocks()).extracting(PlanBlock::id).containsExactly("lunch");   // 요청에 없는 am은 파서가 버린다
    assertThat(out.blocks().get(0).options()).hasSize(2);
  }

  @Test
  void wholeDayIsSlowAndUsesTierModel() {
    Rig r = new Rig();
    PlanRequest req = PlanFixtures.planReq();
    PlanResponse out = r.svc.plan(new PlanRequest("good", req.agent(), req.day(), req.city(), req.status(), req.worry(), req.visited(), req.places(), req.blocks()));
    assertThat(r.ollama.lastModel).isEqualTo("qwen3.8:27b");
    assertThat(r.ollama.lastNumPredict).isEqualTo(120 + 260 * 2);
    assertThat(r.ollama.lastTimeout).isEqualTo(120_000);   // 하루 — theworld.plan.day-timeout-ms
    assertThat(out.blocks()).extracting(PlanBlock::id).containsExactly("am", "lunch");
    assertThat(out.blocks().get(0).options()).hasSize(3);
    assertThat(r.lane.pending()).isZero();
  }

  @Test
  void yieldToCallIs503AndLeavesTheLane() throws Exception {
    Rig r = new Rig();
    r.ollama.waitForCancel = true;
    AtomicReference<Throwable> err = new AtomicReference<>();
    Thread t = new Thread(() -> { try { r.svc.plan(PlanFixtures.planReq()); } catch (Throwable e) { err.set(e); } });
    t.start();
    assertThat(r.ollama.entered.await(5, TimeUnit.SECONDS)).isTrue();
    assertThat(r.lane.pending()).isEqualTo(1);
    assertThat(r.lane.yieldToCall()).isEqualTo(1);   // 통화 턴이 왔다
    t.join(5_000);
    assertThat(t.isAlive()).isFalse();
    assertThat(err.get()).isInstanceOf(ApiException.class);
    assertThat(((ApiException) err.get()).status()).isEqualTo(503);
    assertThat(err.get()).hasMessage("yielded to call");
    assertThat(r.lane.pending()).isZero();
  }

  @Test
  void ollamaErrorIs502AndLeavesTheLane() {
    Rig r = new Rig();
    r.ollama.raw = null;
    assertThatThrownBy(() -> r.svc.plan(PlanFixtures.planReq())).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502)).hasMessage("ollama: boom");
    assertThat(r.lane.pending()).isZero();
    // 진짜 클라이언트가 닫힌 포트를 만나도 502 'ollama: …'
    ModelLane lane = new ModelLane();
    PlanService dead = new PlanService(new OllamaClient("http://127.0.0.1:9", 1_000, LlmFixtures.OM), LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000), lane);
    assertThatThrownBy(() -> dead.plan(oneBlock())).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502)).hasMessageStartingWith("ollama: ");
    assertThat(lane.pending()).isZero();
  }

  @Test
  void unusableOutputIsNotAnError() {
    Rig r = new Rig();
    r.ollama.raw = "{";
    PlanResponse out = r.svc.plan(PlanFixtures.planReq());
    assertThat(out.blocks()).isEmpty();   // 프론트가 규칙으로 채운다
    assertThat(out.model()).isEqualTo("qwen3.5:9b");
  }
}
