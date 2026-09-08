package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmDtos.ReplyParsed;

/** 옛 Node 백엔드 scripts/reply.test.mjs(커밋 0298e8d) '파서' 9개 + trip.test.mjs '답장의 trip' 5개 이관. */
class ReplyParserTest {
  @Test
  void normalJson() {
    assertThat(ReplyParser.parse("{\"text\":\"나 카페야. 커피 마시는 중\",\"worry\":null,\"callMe\":false}"))
      .isEqualTo(new ReplyParsed("나 카페야. 커피 마시는 중", null, false, null));
  }

  @Test
  void nullTextIsSilence() {
    assertThat(ReplyParser.parse("{\"text\":null,\"worry\":null,\"callMe\":false}").text()).isNull();
  }

  @Test
  void newlinesCollapse() {
    assertThat(ReplyParser.parse("{\"text\":\"나 카페야\\n커피 마시는 중\",\"worry\":null,\"callMe\":false}").text()).isEqualTo("나 카페야 커피 마시는 중");
  }

  @Test
  void tooLongIsCut() {
    String t = ReplyParser.parse("{\"text\":\"" + "가".repeat(200) + "\",\"worry\":null,\"callMe\":false}").text();
    assertThat(t.length()).isLessThanOrEqualTo(ReplyPrompt.MAX_REPLY + 1);
    assertThat(t).endsWith("…");
  }

  @Test
  void cutDropsPartialWord() {
    String words = "안녕 ".repeat(30);   // 90자 — 80에서 자르면 "안녕 안녕 … 안" 조각이 남는다
    String t = ReplyParser.parse("{\"text\":\"" + words + "\",\"worry\":null,\"callMe\":false}").text();
    assertThat(t).endsWith("안녕…");
    assertThat(t).doesNotEndWith("안…");
  }

  @Test
  void unknownWorryDropped() {
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":\"love\",\"callMe\":false}").worry()).isNull();
  }

  @Test
  void knownWorryKept() {
    assertThat(ReplyParser.parse("{\"text\":\"헉 왜, 이따 전화할게\",\"worry\":\"people\",\"callMe\":false}").worry()).isEqualTo("people");
  }

  @Test
  void callMeOnlyWhenTrue() {
    assertThat(ReplyParser.parse("{\"text\":\"지금 걸게\",\"worry\":null,\"callMe\":\"yes\"}").callMe()).isFalse();
    assertThat(ReplyParser.parse("{\"text\":\"지금 걸게\",\"worry\":null,\"callMe\":true}").callMe()).isTrue();
  }

  @Test
  void brokenJsonIsSilence() {
    assertThat(ReplyParser.parse("나 카페야").text()).isNull();
    assertThat(ReplyParser.parse("")).isEqualTo(new ReplyParsed(null, null, false, null));
    assertThat(ReplyParser.parse("[1]")).isEqualTo(new ReplyParsed(null, null, false, null));
  }

  @Test
  void blankIsSilence() {
    assertThat(ReplyParser.parse("{\"text\":\"  \",\"worry\":null,\"callMe\":false}").text()).isNull();
  }

  // ── 답장의 trip (trip.test.mjs:131-136) ──
  @Test
  void tripCity() {
    assertThat(ReplyParser.parse("{\"text\":\"오 좋다 찾아볼게\",\"worry\":null,\"callMe\":false,\"trip\":\"교토\"}").trip()).isEqualTo("교토");
  }

  @Test
  void tripStripsJosa() {
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":\"교토까지\"}").trip()).isEqualTo("교토");
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":\"파리으로\"}").trip()).isEqualTo("파리");
  }

  @Test
  void tripKeepsOneCharJosa() {
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":\"오슬로\"}").trip()).isEqualTo("오슬로");
  }

  @Test
  void tripNullWhenMissing() {
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":null}").trip()).isNull();
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false}").trip()).isNull();
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":\"  \"}").trip()).isNull();
  }

  @Test
  void tripTooLongIsNull() {
    assertThat(ReplyParser.parse("{\"text\":\"x\",\"worry\":null,\"callMe\":false,\"trip\":\"" + "가".repeat(40) + "\"}").trip()).isNull();
  }
}
