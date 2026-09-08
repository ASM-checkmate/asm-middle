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
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.ReplyResponse;

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
