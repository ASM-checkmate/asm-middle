package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import world.theworld.server.llm.CallSentences.Split;

/** 옛 Node 백엔드 scripts/call.test.mjs(커밋 2808024) '문장 나누기' 4개·'다듬기' 4개 이관. */
class CallSentencesTest {
  // ── 문장 나누기 ──

  @Test
  void splitsAtPeriodAndBangAndKeepsTheTail() {
    Split r = CallSentences.split("어 그랬구나. 많이 힘들었겠다! 오늘은 조용");
    assertThat(String.join("|", r.sentences())).isEqualTo("어 그랬구나.|많이 힘들었겠다!");
    assertThat(r.rest()).isEqualTo("오늘은 조용");
  }

  @Test
  void questionMarkAndNewline() {
    Split r = CallSentences.split("누가 그랬어?\n");
    assertThat(String.join("|", r.sentences())).isEqualTo("누가 그랬어?");
    assertThat(r.rest()).isEmpty();
  }

  @Test
  void ellipsisIsNotABoundary() {
    Split r = CallSentences.split("음… 듣고 있어. ");
    assertThat(r.sentences()).containsExactly("음… 듣고 있어.");
    assertThat(r.rest()).isEmpty();
  }

  @Test
  void noEndMeansEverythingIsTail() {
    Split r = CallSentences.split("아직 안 끝난 문장");
    assertThat(r.sentences()).isEmpty();
    assertThat(r.rest()).isEqualTo("아직 안 끝난 문장");
  }

  /** 닫는 따옴표·괄호는 문장 쪽에 붙는다 — 그래야 다음 문장이 따옴표로 시작하지 않는다. 줄바꿈만 있는 조각은 문장이 아니다. */
  @Test
  void closingQuotesStayWithTheSentenceAndBlankLinesVanish() {
    Split r = CallSentences.split("\"여보세요.\" 응\n\n나야!");
    assertThat(r.sentences()).containsExactly("여보세요.", "응", "나야!");
    assertThat(r.rest()).isEmpty();
    Split many = CallSentences.split("어?! 진짜?!");
    assertThat(many.sentences()).containsExactly("어?!", "진짜?!");
  }

  // ── 다듬기 ──

  @Test
  void stripsNameLabelAndQuotes() {
    assertThat(CallSentences.tidy("모모: \"여보세요\"")).isEqualTo("여보세요");
    assertThat(CallSentences.tidy("Momo : 「나야」")).isEqualTo("나야");
  }

  @Test
  void stripsStageDirectionsAndEmoji() {
    assertThat(CallSentences.tidy("(웃음) 나야 😊 *손 흔들며*")).isEqualTo("나야");
    assertThat(CallSentences.tidy("[한숨] 그래… 🙂 알았어.")).isEqualTo("그래… 알았어.");
    // ZWJ 묶음(🙂‍↕️)은 Node도 그림 문자만 걷어 내고 ZWJ·변형 선택자는 남긴다 — 그대로 옮겼다
    assertThat(CallSentences.tidy("응 🙂‍↕️")).isEqualTo("응 ‍️");
  }

  @Test
  void cutsWhatIsTooLong() {
    String t = CallSentences.tidy("가 ".repeat(60));
    assertThat(t.length()).isLessThanOrEqualTo(CallDtos.MAX_SENTENCE + 1);
    assertThat(t).endsWith("…").doesNotEndWith(" …");
    // 60자 안이면 그대로
    assertThat(CallSentences.tidy("가".repeat(60))).hasSize(60).doesNotContain("…");
  }

  @Test
  void stripsLeakedHanzi() {
    assertThat(CallSentences.tidy("지금 집沙发上에서 쉬고 있어.")).isEqualTo("지금 집에서 쉬고 있어.");
  }

  @Test
  void collapsesWhitespaceAndKeepsKoreanPunctuation() {
    assertThat(CallSentences.tidy("  어…   그랬구나?  \n")).isEqualTo("어… 그랬구나?");
    assertThat(CallSentences.tidy("   ")).isEmpty();
  }
}
