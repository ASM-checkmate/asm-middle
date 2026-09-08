package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.OllamaClient.Cancel;

/** 옛 Node 백엔드 scripts/call.test.mjs(커밋 2808024) '스트리밍' 3개 이관 + 차선 양보·오류 전파. Ollama는 가짜다. */
class CallServiceTest {
  /** 토큰을 순서대로 흘리고(조각 단위로 onDelta) 끝에 예외를 던질 수도 있는 가짜. 받은 인자를 전부 기억한다. */
  static class FakeOllama extends OllamaClient {
    final List<String> tokens;
    final RuntimeException failAfter;
    volatile String model;
    volatile String system;
    volatile String user;
    volatile Map<String, Object> schema = Map.of("unset", true);
    volatile List<String> images = List.of("unset");
    volatile double temperature;
    volatile int numPredict;
    volatile long timeoutMs;
    volatile Cancel cancel;
    volatile Runnable onCall;

    FakeOllama(List<String> tokens, RuntimeException failAfter) {
      super("http://127.0.0.1:9", 1_000, LlmFixtures.OM);
      this.tokens = tokens;
      this.failAfter = failAfter;
    }

    @Override
    public void chatStream(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs, Cancel cancel, Consumer<String> onDelta) {
      this.model = model; this.system = system; this.user = user; this.schema = schema; this.images = images;
      this.temperature = temperature; this.numPredict = numPredict; this.timeoutMs = timeoutMs; this.cancel = cancel;
      if (onCall != null) onCall.run();
      for (String t : tokens) onDelta.accept(t);
      if (failAfter != null) throw failAfter;
    }
  }

  private static TheworldProps props() { return LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000); }

  @Test
  void sentencesFlowAsTheyCompleteAndTheReturnMatches() {
    FakeOllama ollama = new FakeOllama(CallFixtures.TOKENS, null);
    CallService svc = new CallService(ollama, props(), new ModelLane());
    List<String> got = new ArrayList<>();
    Cancel cancel = new Cancel();
    List<String> out = svc.turn(CallFixtures.callReq(), got::add, cancel);
    assertThat(String.join("|", got)).isEqualTo(CallFixtures.SENTENCES);
    assertThat(out).isEqualTo(got);
    // 스트리밍으로, 짧게, 형식 없이 부른다 (call.test.mjs:70)
    assertThat(ollama.schema).isNull();
    assertThat(ollama.images).isNull();
    assertThat(ollama.numPredict).isLessThanOrEqualTo(120).isEqualTo(CallDtos.TURN_TOKENS);
    assertThat(ollama.temperature).isEqualTo(0.8);
    assertThat(ollama.timeoutMs).isEqualTo(20_000);
    assertThat(ollama.model).isEqualTo("qwen3.5:9b");
    assertThat(ollama.cancel).isSameAs(cancel);
    assertThat(ollama.system).isEqualTo(LlmFixtures.golden("call-system"));
    assertThat(ollama.user).isEqualTo(LlmFixtures.golden("call-user"));
  }

  @Test
  void goodTierUsesTheGoodModel() {
    FakeOllama ollama = new FakeOllama(List.of("여보세요."), null);
    CallService svc = new CallService(ollama, props(), new ModelLane());
    assertThat(svc.turn(CallFixtures.withTier(CallFixtures.callReq(), "good"), s -> { }, null)).containsExactly("여보세요.");
    assertThat(ollama.model).isEqualTo("qwen3.8:27b");
    assertThat(ollama.cancel).isNull();
  }

  /** 통화가 먼저다 — 모델을 부르기 전에 돌고 있던 낮은 우선순위 생성(하루 계획·여행지)을 전부 끊는다 (server.ts:228). */
  @Test
  void yieldsLowPriorityGenerationsBeforeGenerating() {
    ModelLane lane = new ModelLane();
    Cancel plan = lane.lowPriority();
    Cancel trip = lane.lowPriority();
    FakeOllama ollama = new FakeOllama(List.of("나야."), null);
    List<String> seenAtCall = new ArrayList<>();
    ollama.onCall = () -> seenAtCall.add(plan.cancelled() + "/" + trip.cancelled() + "/" + lane.pending());
    CallService svc = new CallService(ollama, props(), lane);
    svc.turn(CallFixtures.callReq(), s -> { }, new Cancel());
    assertThat(seenAtCall).containsExactly("true/true/0");
    assertThat(lane.pending()).isZero();
    assertThat(ollama.cancel.cancelled()).isFalse();   // 통화 자신의 손잡이는 멀쩡하다
  }

  /** Ollama 오류는 감싸지 않는다 — 헤더가 나간 뒤라 컨트롤러가 스트림 안의 error 줄로 적는다. 아무 문장도 안 나간다. */
  @Test
  void ollamaErrorPropagatesUntouched() {
    FakeOllama ollama = new FakeOllama(List.of(), new OllamaException("ollama: model 'm' not found"));
    CallService svc = new CallService(ollama, props(), new ModelLane());
    List<String> got = new ArrayList<>();
    assertThatThrownBy(() -> svc.turn(CallFixtures.callReq(), got::add, new Cancel())).isExactlyInstanceOf(OllamaException.class).hasMessage("ollama: model 'm' not found");
    assertThat(got).isEmpty();
  }

  /** 끊기면 그때까지 완성된 문장은 이미 나갔고, 꼬리(미완성)는 버린다 — 반쯤 말한 문장을 TTS에 넣지 않는다. */
  @Test
  void cancelledMidwayKeepsWhatWasSaidAndDropsTheTail() {
    FakeOllama ollama = new FakeOllama(List.of("하나. ", "둘"), new OllamaCancelledException());
    CallService svc = new CallService(ollama, props(), new ModelLane());
    List<String> got = new ArrayList<>();
    assertThatThrownBy(() -> svc.turn(CallFixtures.callReq(), got::add, new Cancel())).isInstanceOf(OllamaCancelledException.class);
    assertThat(got).containsExactly("하나.");
  }

  /** onSentence가 던진 예외(클라이언트가 끊어 쓰기가 실패)는 그대로 밖으로 — 컨트롤러가 그걸로 끊김을 안다. */
  @Test
  void onSentenceExceptionsPropagate() {
    FakeOllama ollama = new FakeOllama(CallFixtures.TOKENS, null);
    CallService svc = new CallService(ollama, props(), new ModelLane());
    List<String> got = new ArrayList<>();
    assertThatThrownBy(() -> svc.turn(CallFixtures.callReq(), s -> { got.add(s); throw new UncheckedIOException(new IOException("Broken pipe")); }, new Cancel()))
      .isInstanceOf(UncheckedIOException.class);
    assertThat(got).containsExactly("어… 그랬구나.");
  }

  /** 꼬리만 있고 문장 부호가 없어도(모델이 마침표를 안 찍음) 끝나면 한 문장으로 낸다. 빈 꼬리는 안 낸다. */
  @Test
  void tailWithoutPunctuationIsStillASentence() {
    CallTurnRequest req = CallFixtures.callReq();
    assertThat(new CallService(new FakeOllama(List.of("여보", "세요 나야"), null), props(), new ModelLane()).turn(req, s -> { }, null)).containsExactly("여보세요 나야");
    assertThat(new CallService(new FakeOllama(List.of("여보세요. ", "  "), null), props(), new ModelLane()).turn(req, s -> { }, null)).containsExactly("여보세요.");
    assertThat(new CallService(new FakeOllama(List.of(), null), props(), new ModelLane()).turn(req, s -> { }, null)).isEmpty();
  }
}
