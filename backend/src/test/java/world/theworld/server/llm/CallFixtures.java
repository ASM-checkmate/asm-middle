package world.theworld.server.llm;

import com.fasterxml.jackson.core.JsonProcessingException;
import java.io.UncheckedIOException;
import java.util.List;
import world.theworld.server.llm.CallDtos.CallLine;
import world.theworld.server.llm.CallDtos.CallSituation;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.LlmDtos.Agent;

/**
 * 통화 테스트 공통 — Node harness(옛 Node 백엔드 scripts/call.test.mjs(커밋 2808024))의 고정 요청·토큰. LlmFixtures와 나란히 둔다
 * (그 파일은 답장·그림·여행 것이고 다른 손이 같이 만진다).
 */
public final class CallFixtures {
  private CallFixtures() {}

  /** call.test.mjs:10-17 */
  public static CallTurnRequest callReq() {
    return new CallTurnRequest("small",
      new Agent("모모", List.of("느긋한"), List.of("카페"), List.of()),
      new CallSituation("연남동 카페", "커피 마시는 중", "16:25", 70, 20),
      "worry", "people",
      List.of(new CallLine("agent", "여보세요, 나야."), new CallLine("me", "어 왔어?")),
      "아 그냥 팀 사람들이 좀 그래");
  }

  /** 같은 요청을 JSON으로 (API 검사용) — 필드 순서는 docs/CONTRACT.md의 예와 같다. */
  public static final String REQ_JSON = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\",\"traits\":[\"느긋한\"],\"likes\":[\"카페\"],\"dislikes\":[]},"
    + "\"situation\":{\"where\":\"연남동 카페\",\"doing\":\"커피 마시는 중\",\"hhmm\":\"16:25\",\"mood\":70,\"fatigue\":20},"
    + "\"why\":\"worry\",\"worry\":\"people\","
    + "\"transcript\":[{\"from\":\"agent\",\"text\":\"여보세요, 나야.\"},{\"from\":\"me\",\"text\":\"어 왔어?\"}],"
    + "\"user\":\"아 그냥 팀 사람들이 좀 그래\"}";

  public static CallTurnRequest withTurn(CallTurnRequest r, List<CallLine> transcript, String user) {
    return new CallTurnRequest(r.tier(), r.agent(), r.situation(), r.why(), r.worry(), transcript, user);
  }

  public static CallTurnRequest withWhy(CallTurnRequest r, String why, String worry) {
    return new CallTurnRequest(r.tier(), r.agent(), r.situation(), why, worry, r.transcript(), r.user());
  }

  public static CallTurnRequest withTier(CallTurnRequest r, String tier) {
    return new CallTurnRequest(tier, r.agent(), r.situation(), r.why(), r.worry(), r.transcript(), r.user());
  }

  /** call.test.mjs '스트리밍'의 토큰 — 조각조각 오고, 문장이 끝날 때마다 onSentence가 불려야 한다. */
  public static final List<String> TOKENS = List.of("어… ", "그랬", "구나. ", "많이 ", "힘들었겠다", "! ", "오늘은 ", "내가 조용한 데로 잡아 놨어");
  /** 그 토큰들에서 나와야 하는 문장들 ('|'로 이음). */
  public static final String SENTENCES = "어… 그랬구나.|많이 힘들었겠다!|오늘은 내가 조용한 데로 잡아 놨어";

  /** Ollama의 ndjson 스트림 본문 — 토큰마다 한 줄, 끝에 done (call.test.mjs:52). */
  public static String ndjson(List<String> tokens) {
    try {
      StringBuilder b = new StringBuilder();
      for (String t : tokens) b.append("{\"message\":{\"content\":").append(LlmFixtures.OM.writeValueAsString(t)).append("},\"done\":false}\n");
      return b.append("{\"message\":{\"content\":\"\"},\"done\":true}\n").toString();
    } catch (JsonProcessingException e) {
      throw new UncheckedIOException(e);
    }
  }
}
