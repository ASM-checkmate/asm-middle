package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.CallDtos.CallTurnRequest;

/** server.ts validateCall — 검증 문자열과 관대한 정규화·상한 (docs/CONTRACT.md "POST /api/call/turn"). */
class CallValidatorTest {
  private static JsonNode j(String s) throws Exception { return LlmFixtures.OM.readTree(s); }

  private static final String SIT = "\"situation\":{\"where\":\"집\",\"doing\":\"자는 중\",\"hhmm\":\"02:00\"}";
  private static final String OK = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"ask\",\"user\":null}";

  private static void bad(String body, String msg) throws Exception {
    JsonNode n = body == null ? null : j(body);
    assertThatThrownBy(() -> CallValidator.validate(n)).isInstanceOf(ApiException.class)
      .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(400)).hasMessage(msg);
  }

  @Test
  void errorStrings() throws Exception {
    bad(null, "body must be an object");
    bad("[]", "body must be an object");
    bad("{}", "tier must be small|good");
    bad("{\"tier\":\"big\"}", "tier must be small|good");
    bad("{\"tier\":\"small\"}", "agent.name required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":1}}", "agent.name required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", "situation.where/doing/hhmm required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"situation\":{\"where\":\"집\",\"doing\":\"x\"}}", "situation.where/doing/hhmm required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + "}", "why must be worry|ask|friction|out");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"hello\"}", "why must be worry|ask|friction|out");
    // user는 없어도 안 된다 — 첫 턴은 null을 명시한다 (Node: o.user !== null && typeof o.user !== 'string')
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"ask\"}", "user must be string|null");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}," + SIT + ",\"why\":\"ask\",\"user\":1}", "user must be string|null");
  }

  @Test
  void defaultsAndClamps() throws Exception {
    CallTurnRequest r = CallValidator.validate(j(OK));
    assertThat(r.tier()).isEqualTo("small");
    assertThat(r.why()).isEqualTo("ask");
    assertThat(r.situation().mood()).isEqualTo(60);
    assertThat(r.situation().fatigue()).isEqualTo(30);
    assertThat(r.worry()).isNull();
    assertThat(r.user()).isNull();
    assertThat(r.transcript()).isEmpty();
    assertThat(r.agent().traits()).isEmpty();

    CallTurnRequest c = CallValidator.validate(j("{\"tier\":\"good\",\"agent\":{\"name\":\"모모\",\"traits\":[\"a\",1,null],\"likes\":\"x\"},"
      + "\"situation\":{\"where\":\"집\",\"doing\":\"x\",\"hhmm\":\"1\",\"mood\":120.6,\"fatigue\":-3},\"why\":\"worry\",\"worry\":\"love\",\"user\":\"야\"}"));
    assertThat(c.tier()).isEqualTo("good");
    assertThat(c.situation().mood()).isEqualTo(100);
    assertThat(c.situation().fatigue()).isEqualTo(0);
    assertThat(c.worry()).isNull();   // 모르는 갈래는 null
    assertThat(c.user()).isEqualTo("야");
    assertThat(c.agent().traits()).containsExactly("a");
    assertThat(c.agent().likes()).isEmpty();
    // 갈래는 why와 무관하게 받는다 (프롬프트가 why=worry일 때만 쓴다)
    assertThat(CallValidator.validate(j(OK.replace("\"user\":null", "\"worry\":\"work\",\"user\":null"))).worry()).isEqualTo("work");
    assertThat(CallValidator.validate(j(OK.replace("\"hhmm\":\"02:00\"", "\"hhmm\":\"02:00\",\"mood\":49.5"))).situation().mood()).isEqualTo(50);
  }

  @Test
  void capsAndTranscriptTail() throws Exception {
    StringBuilder transcript = new StringBuilder("[");
    for (int i = 0; i < 25; i++) transcript.append(i > 0 ? "," : "").append("{\"from\":\"me\",\"text\":\"m").append(i).append("\"}");
    transcript.append(",{\"from\":\"them\",\"text\":\"x\"},{\"from\":\"agent\"},\"junk\",null,[\"me\"],{\"from\":\"agent\",\"text\":\"")
      .append("가".repeat(300)).append("\"}]");
    String body = "{\"tier\":\"small\",\"agent\":{\"name\":\"" + "모".repeat(25) + "\"},"
      + "\"situation\":{\"where\":\"" + "집".repeat(50) + "\",\"doing\":\"" + "일".repeat(50) + "\",\"hhmm\":\"16:25:00\"},"
      + "\"why\":\"out\",\"transcript\":" + transcript + ",\"user\":\"" + "말".repeat(300) + "\"}";
    CallTurnRequest r = CallValidator.validate(j(body));
    assertThat(r.agent().name()).hasSize(20);
    assertThat(r.situation().where()).hasSize(40);
    assertThat(r.situation().doing()).hasSize(40);
    assertThat(r.situation().hhmm()).isEqualTo("16:25");
    assertThat(r.user()).hasSize(200);
    assertThat(r.transcript()).hasSize(20);
    assertThat(r.transcript().get(0).text()).isEqualTo("m6");   // 유효한 26줄 중 마지막 20줄
    assertThat(r.transcript().get(18).text()).isEqualTo("m24");
    assertThat(r.transcript().get(19).from()).isEqualTo("agent");
    assertThat(r.transcript().get(19).text()).hasSize(200);
  }
}
