package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmDtos.Crush;
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
    Prompt p = ReplyPrompt.build(LlmFixtures.withSituation(req, new Situation(s.where(), s.doing(), s.hhmm(), "자느라", s.mood(), s.fatigue(), s.worry(), null)));
    assertThat(p.system()).contains("자느라 못 봤고");
  }

  @Test
  void rememberWorry() {
    Situation s = req.situation();
    Prompt p = ReplyPrompt.build(LlmFixtures.withSituation(req, new Situation(s.where(), s.doing(), s.hhmm(), null, s.mood(), s.fatigue(), "work", null)));
    assertThat(p.system()).contains("일 때문에 힘들다고");
  }

  private Prompt withCrush(String name, String stage) {
    Situation s = req.situation();
    return ReplyPrompt.build(LlmFixtures.withSituation(req, new Situation(s.where(), s.doing(), s.hhmm(), null, s.mood(), s.fatigue(), null, new Crush(name, stage))));
  }

  /** AFFECTION_SPEC §4 마지막 줄 — 단계는 알려주되 "직접 인정하지 않는다"를 못 박는다. 상황 줄 바로 뒤, 규칙 앞. */
  @Test
  void crushLineAndRule() {
    Prompt p = withCrush("하늘", "like");
    assertThat(p.system()).contains("요즘 하늘이가 좋다.").contains("누가 물어도 직접 인정하지 않는다 — 얼버무리거나 딴청을 부린다. 이름은 먼저 꺼내지 않는다.");
    assertThat(p.system().indexOf("요즘 하늘이가 좋다.")).isGreaterThan(p.system().indexOf("지금 상황")).isLessThan(p.system().indexOf("규칙:"));
    assertThat(p.system()).isEqualTo(LlmFixtures.golden("reply-system-crush"));
    assertThat(p.user()).isEqualTo(LlmFixtures.golden("reply-user"));
  }

  /** 받침 있는 이름은 "하늘이가"·"하늘이를" (프런트 agentPosts의 iga·hante와 같은 이름꼴 — "하늘이 좋다"는 날씨로 읽힌다). 한글 아니면 "이(가)". */
  @Test
  void crushStagesAndParticles() {
    assertThat(withCrush("하늘", "interest").system()).contains("요즘 하늘이가 조금 신경 쓰인다.");
    assertThat(withCrush("유리", "interest").system()).contains("요즘 유리가 조금 신경 쓰인다.");
    assertThat(withCrush("유리", "like").system()).contains("요즘 유리가 좋다.");
    assertThat(withCrush("하늘", "love").system()).contains("하늘이를 많이 좋아한다.");
    assertThat(withCrush("유리", "love").system()).contains("유리를 많이 좋아한다.");
    assertThat(withCrush("봄", "like").system()).contains("요즘 봄이가 좋다.").doesNotContain("봄이 좋다");
    assertThat(withCrush("Amy", "like").system()).contains("요즘 Amy이(가) 좋다.");
    assertThat(withCrush("Amy", "love").system()).contains("Amy을(를) 많이 좋아한다.");
  }

  /** 설렘이 없으면 프롬프트는 예전과 글자 하나 다르지 않다 — 단계 이름·이름이 새지 않는다. */
  @Test
  void noCrushLeavesPromptUntouched() {
    Prompt p = ReplyPrompt.build(req);
    assertThat(req.situation().crush()).isNull();
    assertThat(p.system()).isEqualTo(LlmFixtures.golden("reply-system")).doesNotContain("인정하지 않는다");
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
