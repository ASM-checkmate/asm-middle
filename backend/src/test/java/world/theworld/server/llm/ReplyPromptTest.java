package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.Situation;
import world.theworld.server.llm.ReplyPrompt.Prompt;

/** 옛 Node 백엔드 scripts/reply.test.mjs(커밋 0298e8d) '프롬프트' 7개 이관. */
class ReplyPromptTest {
  private final ReplyRequest req = LlmFixtures.replyReq();

  @Test
  void nameAndSituationInSystem() {
    Prompt p = ReplyPrompt.build(req);
    assertThat(p.system()).contains("\"모모\"").contains("연남동 카페에서 커피 마시는 중");
  }

  @Test
  void noApologyUnlessLate() {
    assertThat(ReplyPrompt.build(req).system()).doesNotContain("미안");
  }

  @Test
  void apologyWhenLate() {
    Situation s = req.situation();
    Prompt p = ReplyPrompt.build(LlmFixtures.withSituation(req, new Situation(s.where(), s.doing(), s.hhmm(), "자느라", s.mood(), s.fatigue(), s.worry())));
    assertThat(p.system()).contains("자느라 못 봤고");
  }

  @Test
  void rememberWorry() {
    Situation s = req.situation();
    Prompt p = ReplyPrompt.build(LlmFixtures.withSituation(req, new Situation(s.where(), s.doing(), s.hhmm(), null, s.mood(), s.fatigue(), "work")));
    assertThat(p.system()).contains("일 때문에 힘들다고");
  }

  @Test
  void recentBeforeBatch() {
    Prompt p = ReplyPrompt.build(req);
    assertThat(p.user()).contains("[최근 대화]").contains("[방금 온 말]");
    assertThat(p.user().indexOf("[최근 대화]")).isLessThan(p.user().indexOf("[방금 온 말]"));
  }

  @Test
  void allThreeTextsIncluded() {
    Prompt p = ReplyPrompt.build(req);
    assertThat(p.user()).contains("사용자: 야", "사용자: 어디야", "사용자: 뭐해");
  }

  @Test
  void noRecentSection() {
    Prompt p = ReplyPrompt.build(new ReplyRequest(req.tier(), req.agent(), req.situation(), List.of(), req.texts(), null));
    assertThat(p.user()).doesNotContain("[최근 대화]");
  }

  /** Node buildPrompt(reply.test.mjs의 고정 요청)와 글자 단위로 같다 — 부분 문자열 검사가 놓치는 줄 바뀜을 잡는다. */
  @Test
  void exactlyTheNodePrompt() {
    Prompt p = ReplyPrompt.build(req);
    assertThat(p.system()).isEqualTo(LlmFixtures.golden("reply-system"));
    assertThat(p.user()).isEqualTo(LlmFixtures.golden("reply-user"));
  }

  @Test
  void schemaKeepsNulls() throws Exception {
    String json = LlmFixtures.OM.writeValueAsString(ReplyPrompt.REPLY_SCHEMA);
    assertThat(json).contains("\"text\":{\"type\":[\"string\",null]}");
    assertThat(json).contains("\"enum\":[\"work\",\"people\",\"body\",\"money\",\"focus\",\"blue\",\"bored\",null]");
    assertThat(json).contains("\"required\":[\"text\",\"worry\",\"callMe\",\"trip\"]");
  }
}
