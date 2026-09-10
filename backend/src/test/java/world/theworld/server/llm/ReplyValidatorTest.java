package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.Crush;
import world.theworld.server.llm.LlmDtos.ReplyRequest;

/** server.ts validate — 검증 문자열과 관대한 정규화 (BACKEND-CONTRACT §2.4). */
class ReplyValidatorTest {
  private static JsonNode j(String s) throws Exception { return LlmFixtures.OM.readTree(s); }

  private static final String OK = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"자는 중\",\"hhmm\":\"02:00\"},\"texts\":[\"야\"]}";

  private static void bad(String body, String msg) throws Exception {
    JsonNode n = body == null ? null : j(body);
    assertThatThrownBy(() -> ReplyValidator.validate(n)).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(400)).hasMessage(msg);
  }

  @Test
  void errorStrings() throws Exception {
    bad(null, "body must be an object");
    bad("[]", "body must be an object");
    bad("{}", "tier must be small|good");
    bad("{\"tier\":\"big\"}", "tier must be small|good");
    bad("{\"tier\":\"small\"}", "agent.name required");
    bad("{\"tier\":\"small\",\"agent\":\"모모\"}", "agent.name required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", "situation.where/doing/hhmm required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\"}}", "situation.where/doing/hhmm required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\"}}", "texts must be a non-empty string[]");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\"},\"texts\":[]}", "texts must be a non-empty string[]");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\"},\"texts\":[1]}", "texts must be a non-empty string[]");
  }

  @Test
  void defaultsAndClamps() throws Exception {
    ReplyRequest r = ReplyValidator.validate(j(OK));
    assertThat(r.situation().mood()).isEqualTo(60);
    assertThat(r.situation().fatigue()).isEqualTo(30);
    assertThat(r.situation().worry()).isNull();
    assertThat(r.situation().lateWhy()).isNull();
    assertThat(r.agent().traits()).isEmpty();
    assertThat(r.recent()).isEmpty();
    assertThat(r.batch()).isNull();

    ReplyRequest c = ReplyValidator.validate(j("{\"tier\":\"good\",\"batch\":\"b1\",\"agent\":{\"name\":\"모모\",\"traits\":[\"a\",1,null],\"likes\":\"x\"},"
      + "\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\",\"mood\":120.6,\"fatigue\":-3,\"worry\":\"love\",\"lateWhy\":\"자느라\"},\"texts\":[\"야\"]}"));
    assertThat(c.situation().mood()).isEqualTo(100);
    assertThat(c.situation().fatigue()).isEqualTo(0);
    assertThat(c.situation().worry()).isNull();
    assertThat(c.situation().lateWhy()).isEqualTo("자느라");
    assertThat(c.agent().traits()).containsExactly("a");
    assertThat(c.agent().likes()).isEmpty();
    assertThat(c.batch()).isEqualTo("b1");
    assertThat(ReplyValidator.validate(j(OK.replace("\"texts\"", "\"situation2\":1,\"texts\"").replace("\"hhmm\":\"02:00\"", "\"hhmm\":\"02:00\",\"worry\":\"work\",\"mood\":49.5"))).situation().mood()).isEqualTo(50);
  }

  private static ReplyRequest withCrush(String crushJson) throws Exception {
    return ReplyValidator.validate(j(OK.replace("\"hhmm\":\"02:00\"", "\"hhmm\":\"02:00\",\"crush\":" + crushJson)));
  }

  /** situation.crush — 없음·null·틀린 모양은 전부 조용히 없음(400 아님). 이름은 공백을 접고 1~40자, 단계는 세 값뿐. */
  @Test
  void crushOptionalAndLenient() throws Exception {
    assertThat(ReplyValidator.validate(j(OK)).situation().crush()).isNull();
    assertThat(withCrush("null").situation().crush()).isNull();
    assertThat(withCrush("\"하늘\"").situation().crush()).isNull();
    assertThat(withCrush("{}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":\"하늘\"}").situation().crush()).isNull();
    assertThat(withCrush("{\"stage\":\"like\"}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":\"하늘\",\"stage\":\"crush\"}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":\"하늘\",\"stage\":0.7}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":1,\"stage\":\"like\"}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":\"  \",\"stage\":\"like\"}").situation().crush()).isNull();
    assertThat(withCrush("{\"name\":\"" + "가".repeat(41) + "\",\"stage\":\"like\"}").situation().crush()).isNull();

    assertThat(withCrush("{\"name\":\"하늘\",\"stage\":\"interest\"}").situation().crush()).isEqualTo(new Crush("하늘", "interest"));
    assertThat(withCrush("{\"name\":\" 하늘 \\n \",\"stage\":\"love\"}").situation().crush()).isEqualTo(new Crush("하늘", "love"));
    assertThat(withCrush("{\"name\":\"" + "가".repeat(40) + "\",\"stage\":\"like\"}").situation().crush().name()).hasSize(40);
  }

  @Test
  void recentAndTextsTrimmed() throws Exception {
    StringBuilder recent = new StringBuilder("[");
    for (int i = 0; i < 15; i++) recent.append(i > 0 ? "," : "").append("{\"from\":\"me\",\"text\":\"m").append(i).append("\"}");
    recent.append(",{\"from\":\"them\",\"text\":\"x\"},{\"from\":\"agent\"},\"junk\"]");
    StringBuilder texts = new StringBuilder("[");
    for (int i = 0; i < 10; i++) texts.append(i > 0 ? "," : "").append("\"").append("t").append(i).append("가".repeat(300)).append("\"");
    texts.append("]");
    ReplyRequest r = ReplyValidator.validate(j(OK.replace("\"texts\":[\"야\"]", "\"recent\":" + recent + ",\"texts\":" + texts)));
    assertThat(r.recent()).hasSize(12);
    assertThat(r.recent().get(0).text()).isEqualTo("m3");
    assertThat(r.recent().get(11).text()).isEqualTo("m14");
    assertThat(r.texts()).hasSize(8);
    assertThat(r.texts().get(0)).startsWith("t2");
    assertThat(r.texts().get(0)).hasSize(200);
  }
}
