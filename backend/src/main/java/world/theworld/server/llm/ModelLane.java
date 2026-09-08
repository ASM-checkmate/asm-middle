package world.theworld.server.llm;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import world.theworld.server.llm.OllamaClient.Cancel;

/**
 * 모델 앞의 차선 (옛 Node 백엔드 server.ts(커밋 2808024) lowPriority·yieldToCall, ADR-0011 결정 6). Ollama는 이 맥에서 요청을 한 번에 하나만
 * 돌린다(다른 모델이어도) — 27B 하루 계획이 돌고 있으면 9B 통화 첫마디가 19초 밀린다. 그래서 **낮은 우선순위**(하루 계획·여행지 추출)는
 * 여기 손잡이를 맡겨 두고, 통화 턴이 오면 전부 끊는다. 끊긴 쪽은 503 'yielded to call'로 답하고 프론트가 규칙으로 채우거나 나중에 다시 묻는다.
 */
@Component
public class ModelLane {
  private static final Logger log = LoggerFactory.getLogger(ModelLane.class);
  private final Set<Cancel> lowPriority = ConcurrentHashMap.newKeySet();

  /** 낮은 우선순위 호출 하나를 시작한다 — 끝나면(어떻게든) {@link #release}로 돌려준다. */
  public Cancel lowPriority() {
    Cancel c = new Cancel();
    lowPriority.add(c);
    return c;
  }

  public void release(Cancel c) { lowPriority.remove(c); }

  /** 통화가 먼저다 — 돌고 있던 낮은 우선순위 생성을 전부 끊는다. 끊은 수를 돌려준다. */
  public int yieldToCall() {
    int n = 0;
    for (Cancel c : lowPriority) { c.cancel(); lowPriority.remove(c); n++; }
    if (n > 0) log.info("[lane] yielded {} low-priority generation(s) to a call", n);
    return n;
  }

  /** 진행 중인 낮은 우선순위 호출 수 — 테스트용. */
  int pending() { return lowPriority.size(); }
}
