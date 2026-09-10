package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.Crush;
import world.theworld.server.llm.LlmDtos.RecentMsg;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.ReplyResponse;
import world.theworld.server.llm.LlmDtos.Situation;

/** 같은 (user, batch)의 진행 중 호출은 새 호출이 오면 취소한다 (BACKEND-CONTRACT §2.4). Ollama는 가짜다. */
class ReplyServiceTest {
  /** 첫 호출은 인터럽트될 때까지 기다리고, 그 다음 호출은 바로 답한다. */
  static class SlowThenFast extends OllamaClient {
    final AtomicInteger calls = new AtomicInteger();
    final AtomicBoolean interrupted = new AtomicBoolean();
    final CountDownLatch firstStarted = new CountDownLatch(1);
    final CountDownLatch firstInterrupted = new CountDownLatch(1);
    SlowThenFast() { super("http://127.0.0.1:9", 1_000, LlmFixtures.OM); }

    @Override
    public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs) {
      if (calls.incrementAndGet() == 1) {
        firstStarted.countDown();
        try { Thread.sleep(10_000); }
        catch (InterruptedException e) { interrupted.set(true); firstInterrupted.countDown(); throw new OllamaException("ollama: interrupted"); }
        return "{\"text\":\"늦은 답\",\"worry\":null,\"callMe\":false,\"trip\":null}";
      }
      return "{\"text\":\"빠른 답\",\"worry\":null,\"callMe\":true,\"trip\":\"교토\"}";
    }
  }

  private static ReplyRequest withBatch(String batch) {
    ReplyRequest r = LlmFixtures.replyReq();
    return new ReplyRequest(r.tier(), r.agent(), r.situation(), r.recent(), r.texts(), batch);
  }

  @Test
  void newerBatchCallCancelsOlder() throws Exception {
    SlowThenFast ollama = new SlowThenFast();
    ReplyService svc = new ReplyService(ollama, LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000));
    AtomicReference<Throwable> firstError = new AtomicReference<>();
    Thread first = new Thread(() -> { try { svc.reply("u1", withBatch("b1")); } catch (Throwable t) { firstError.set(t); } });
    first.start();
    assertThat(ollama.firstStarted.await(5, TimeUnit.SECONDS)).isTrue();

    ReplyResponse second = svc.reply("u1", withBatch("b1"));
    first.join(5_000);
    assertThat(second.text()).isEqualTo("빠른 답");
    assertThat(second.callMe()).isTrue();
    assertThat(second.trip()).isEqualTo("교토");
    assertThat(second.model()).isEqualTo("qwen3.5:9b");
    // 취소된 작업의 인터럽트는 가상 스레드에서 비동기로 도착한다 — 기다려서 본다
    assertThat(ollama.firstInterrupted.await(5, TimeUnit.SECONDS)).isTrue();
    assertThat(ollama.interrupted.get()).isTrue();
    assertThat(firstError.get()).isInstanceOf(ApiException.class);
    assertThat(((ApiException) firstError.get()).status()).isEqualTo(502);
    assertThat(svc.inflightCount()).isZero();
  }

  @Test
  void differentUserOrBatchIsNotCancelled() throws Exception {
    SlowThenFast ollama = new SlowThenFast();
    ReplyService svc = new ReplyService(ollama, LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000));
    Thread first = new Thread(() -> { try { svc.reply("u1", withBatch("b1")); } catch (Throwable ignored) { } });
    first.start();
    assertThat(ollama.firstStarted.await(5, TimeUnit.SECONDS)).isTrue();
    assertThat(svc.reply("u2", withBatch("b1")).text()).isEqualTo("빠른 답");
    assertThat(ollama.interrupted.get()).isFalse();
    assertThat(svc.inflightCount()).isEqualTo(1);
    first.interrupt();
    first.join(5_000);
  }

  /** 정해진 한 답만 내는 가짜 Ollama. */
  static class Fixed extends OllamaClient {
    final String raw;
    Fixed(String raw) { super("http://127.0.0.1:9", 1_000, LlmFixtures.OM); this.raw = raw; }
    @Override
    public String chatJson(String model, String system, String user, Map<String, Object> schema, List<String> images, double temperature, int numPredict, long timeoutMs) { return raw; }
  }

  private static ReplyRequest withCrush(ReplyRequest r, String name, List<String> texts, List<RecentMsg> recent) {
    Situation s = r.situation();
    return new ReplyRequest(r.tier(), r.agent(), new Situation(s.where(), s.doing(), s.hhmm(), null, s.mood(), s.fatigue(), null, new Crush(name, "like")), recent, texts, null);
  }

  /** AFFECTION_SPEC §4 "이름은 먼저 꺼내지 않는다"의 서버 쪽 뒷받침 — 아무도 안 꺼낸 설렘 대상의 이름이 답장에 나오면 답장 없음. 누가 꺼냈으면 그대로. */
  @Test
  void crushNameSaidFirstIsDropped() {
    ReplyRequest base = LlmFixtures.replyReq();
    ReplyService svc = new ReplyService(new Fixed("{\"text\":\"응 요즘 하늘이 좋아\",\"worry\":null,\"callMe\":false,\"trip\":null}"), LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000));
    ReplyResponse dropped = svc.reply("u1", withCrush(base, "하늘", List.of("뭐해"), List.of()));
    assertThat(dropped.text()).isNull();
    assertThat(svc.reply("u1", withCrush(base, "하늘", List.of("하늘이 어때?"), List.of())).text()).isEqualTo("응 요즘 하늘이 좋아");
    assertThat(svc.reply("u1", withCrush(base, "하늘", List.of("뭐해"), List.of(new RecentMsg("agent", "하늘이랑 카페 왔어")))).text()).isEqualTo("응 요즘 하늘이 좋아");
    assertThat(svc.reply("u1", withCrush(base, "유리", List.of("뭐해"), List.of())).text()).isEqualTo("응 요즘 하늘이 좋아");   // 다른 이름은 상관없다
    assertThat(svc.reply("u1", base).text()).isEqualTo("응 요즘 하늘이 좋아");   // 설렘이 없으면 손대지 않는다
  }

  /** 이름이 흔한 낱말이면(하나 = 1, 지우 ⊂ 지우개) 사람 이름꼴만 잡는다 — 안 그러면 "커피 하나만"에 답장이 통째로 사라진다. */
  @Test
  void crushNameOnlyAsNameForm() {
    ReplyRequest base = LlmFixtures.replyReq();
    java.util.function.BiFunction<String, String, String> out = (name, text) ->
      new ReplyService(new Fixed("{\"text\":\"" + text + "\",\"worry\":null,\"callMe\":false,\"trip\":null}"), LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000))
        .reply("u1", withCrush(base, name, List.of("뭐해"), List.of())).text();
    assertThat(out.apply("하나", "하나만 물어볼게")).isEqualTo("하나만 물어볼게");     // 숫자 하나
    assertThat(out.apply("하나", "커피 하나 마시는 중. 하나도 안 피곤해")).isEqualTo("커피 하나 마시는 중. 하나도 안 피곤해");
    assertThat(out.apply("하나", "하나가 좋아")).isNull();                          // 사람 이름꼴 — 먼저 꺼냈다
    assertThat(out.apply("하나", "요즘 하나랑 자주 봐")).isNull();
    assertThat(out.apply("지우", "지우고 싶은 기억이야")).isEqualTo("지우고 싶은 기억이야");
    assertThat(out.apply("지우", "지우개 샀어")).isEqualTo("지우개 샀어");
    assertThat(out.apply("지우", "지우는 카페 갔대")).isNull();
    assertThat(out.apply("하늘", "하늘이 파랗다")).isNull();                        // 받침 이름은 부르는 꼴(하늘이)이 곧 이름이다 — 날씨 얘기도 잡힌다 (감수)
    assertThat(out.apply("하늘", "하늘 보러 갈래")).isEqualTo("하늘 보러 갈래");      // 부르는 꼴이 아니면 낱말
    assertThat(out.apply("Amy", "Amy 보고 싶다")).isNull();
    assertThat(out.apply("Amy", "Amyx 앱 써 봤어")).isEqualTo("Amyx 앱 써 봤어");
  }

  @Test
  void llmFailureIs502() {
    OllamaClient dead = new OllamaClient("http://127.0.0.1:9", 1_000, LlmFixtures.OM);
    ReplyService svc = new ReplyService(dead, LlmFixtures.props("http://127.0.0.1:9", "", "http://127.0.0.1:9", 100_000));
    assertThatThrownBy(() -> svc.reply("u1", LlmFixtures.replyReq())).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502)).hasMessageStartingWith("ollama: ");
    assertThatThrownBy(() -> svc.reply("u1", withBatch("b9"))).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(502));
  }
}
