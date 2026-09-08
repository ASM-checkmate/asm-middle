package world.theworld.server.llm;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.springframework.stereotype.Service;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.CallSentences.Split;
import world.theworld.server.llm.OllamaClient.Cancel;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/**
 * 통화 한 턴을 짓는다 (옛 Node 백엔드 call.ts(커밋 2808024) callTurn, ADR-0011). Ollama를 스트리밍으로 받아 문장이 완성될 때마다 {@code onSentence}를
 * 부른다 — 컨트롤러가 그 문장을 ndjson 한 줄로 흘려보내고 프론트가 TTS에 넣는다.
 * 통화가 먼저다 — 시작하기 전에 {@link ModelLane#yieldToCall}로 돌고 있던 하루 계획·여행지 추출을 끊고 모델을 가져온다 (server.ts:228).
 * 오류는 감싸지 않고 그대로 던진다({@link OllamaException}) — 헤더가 이미 나간 뒤라 502가 아니라 스트림 안의 {@code error} 줄이 된다 (컨트롤러).
 */
@Service
public class CallService {
  /** 통화 생성 온도 (call.ts:101) — 답장(0.9)보다 조금 차분하게. */
  public static final double TEMPERATURE = 0.8;
  /** 한 턴 제한 시간 (call.ts:93 timeoutMs 기본값). 토큰 사이의 침묵에 걸린다. */
  public static final long TIMEOUT_MS = 20_000;

  private final OllamaClient ollama;
  private final TheworldProps props;
  private final ModelLane lane;

  public CallService(OllamaClient ollama, TheworldProps props, ModelLane lane) {
    this.ollama = ollama;
    this.props = props;
    this.lane = lane;
  }

  /** tier → 모델 태그 (server.ts MODELS). */
  String modelFor(String tier) {
    return tier.equals("good") ? props.models().good() : props.models().small();
  }

  /**
   * @param req 검증된 요청
   * @param onSentence 문장 하나가 완성될 때마다 — 같은 스레드에서, 순서대로. 여기서 던진 예외는 그대로 밖으로 나간다(컨트롤러가 끊김을 그렇게 안다)
   * @param cancel 끊기 손잡이 — 사용자가 말을 끊으면 프론트가 요청을 닫고, 컨트롤러가 이 손잡이로 Ollama 생성을 멈춘다. null이면 못 끊는다
   * @return 이 턴의 전체 문장들 (onSentence에 준 것과 같다)
   * @throws OllamaException Ollama 오류·제한 시간·연결 실패. {@link OllamaCancelledException}이면 끊긴 것 — 그때까지의 문장은 이미 나갔고 꼬리는 버린다
   */
  public List<String> turn(CallTurnRequest req, Consumer<String> onSentence, Cancel cancel) {
    lane.yieldToCall();
    Prompt p = CallPrompt.build(req);
    List<String> out = new ArrayList<>();
    StringBuilder buf = new StringBuilder();
    Consumer<String> emit = s -> { out.add(s); onSentence.accept(s); };
    ollama.chatStream(modelFor(req.tier()), p.system(), p.user(), null, null, TEMPERATURE, CallDtos.TURN_TOKENS, TIMEOUT_MS, cancel, delta -> {
      buf.append(delta);
      Split sp = CallSentences.split(buf.toString());
      sp.sentences().forEach(emit);
      buf.setLength(0);
      buf.append(sp.rest());
    });
    String tail = CallSentences.tidy(buf.toString());
    if (!tail.isEmpty()) emit.accept(tail);
    return out;
  }
}
