package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.CallDtos.CallTurnRequest;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/** 옛 Node 백엔드 scripts/call.test.mjs(커밋 2808024) '프롬프트' 6개 이관 + 골든 동일성. */
class CallPromptTest {
  private final CallTurnRequest req = CallFixtures.callReq();

  @Test
  void inACallAndSituationInSystem() {
    Prompt p = CallPrompt.build(req);
    assertThat(p.system()).contains("전화 통화 중").contains("연남동 카페에서 커피 마시는 중");
  }

  @Test
  void promisedCallAsksAboutTheWorryThenSaysWhatIWillDo() {
    Prompt p = CallPrompt.build(req);
    assertThat(p.system()).contains("사람 때문에 힘들다고").contains("네가 오늘 뭘 하겠다");
  }

  @Test
  void spokenRulesShortNoEmojiNoStageDirections() {
    Prompt p = CallPrompt.build(req);
    assertThat(p.system()).contains("한 턴에 한두 문장").contains("지문 금지");
  }

  @Test
  void soFarAndJustHeardAreSeparated() {
    Prompt p = CallPrompt.build(req);
    assertThat(p.user()).contains("[지금까지]").contains("모모: 여보세요, 나야.").contains("[방금 들은 말]").contains("사용자: 아 그냥 팀 사람들이 좀 그래");
    assertThat(p.user().indexOf("[지금까지]")).isLessThan(p.user().indexOf("[방금 들은 말]"));
  }

  @Test
  void firstTurnTellsTheAgentToSpeakFirst() {
    Prompt first = CallPrompt.build(CallFixtures.withTurn(req, List.of(), null));
    assertThat(first.user()).contains("네가 먼저 말한다").doesNotContain("[지금까지]").doesNotContain("[방금 들은 말]");
  }

  @Test
  void outgoingFromTheUserIsSaidSo() {
    assertThat(CallPrompt.build(CallFixtures.withWhy(req, "out", req.worry())).system()).contains("사용자가 먼저 걸어 왔다");
  }

  /** worry 줄은 약속한 전화(why=worry)에만 — 걸어 달라고 한 통화면 갈래가 있어도 안 적는다 (call.ts:34). */
  @Test
  void worryLineOnlyOnPromisedCall() {
    assertThat(CallPrompt.build(CallFixtures.withWhy(req, "ask", "people")).system()).contains("사용자가 전화해 달라고 해서 걸었다.").doesNotContain("때문에 힘들다고");
    assertThat(CallPrompt.build(CallFixtures.withWhy(req, "worry", null)).system()).doesNotContain("때문에 힘들다고");
    assertThat(CallPrompt.build(CallFixtures.withWhy(req, "friction", null)).system()).contains("계획이 어긋나서");
  }

  /** 첫 턴이라도 지금까지 오간 말이 있으면(끊겼다 다시 붙음) 그대로 앞에 둔다. */
  @Test
  void firstTurnWithTranscriptKeepsIt() {
    Prompt p = CallPrompt.build(CallFixtures.withTurn(req, req.transcript(), null));
    assertThat(p.user()).startsWith("[지금까지]\n모모: 여보세요, 나야.\n사용자: 어 왔어?\n\n[통화가 막 붙었다.");
  }

  /** Node buildCallPrompt(call.test.mjs의 고정 요청)와 글자 단위로 같다 — 부분 문자열 검사가 놓치는 줄 바뀜·빈 줄을 잡는다. */
  @Test
  void exactlyTheNodePrompt() {
    Prompt p = CallPrompt.build(req);
    assertThat(p.system()).isEqualTo(LlmFixtures.golden("call-system"));
    assertThat(p.user()).isEqualTo(LlmFixtures.golden("call-user"));
    assertThat(CallPrompt.build(CallFixtures.withTurn(req, List.of(), null)).user()).isEqualTo(LlmFixtures.golden("call-user-first"));
    assertThat(CallPrompt.build(CallFixtures.withWhy(req, "out", req.worry())).system()).isEqualTo(LlmFixtures.golden("call-system-out"));
  }
}
