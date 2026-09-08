package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanRequest;

/** server.ts(커밋 2808024) validatePlan — 검증 문자열, 기본값·clamp, 크기 상한(장소 120·블록 6·문자열 길이). */
class PlanValidatorTest {
  private static JsonNode j(String s) throws Exception { return LlmFixtures.OM.readTree(s); }

  private static final String HEAD = "{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\",\"weekday\":\"화요일\"},\"city\":{\"key\":\"seoul\",\"nameKo\":\"서울\"}";
  private static final String PLACES = "\"places\":[{\"id\":\"home\",\"name\":\"우리 집\",\"type\":\"home\",\"area\":\"연남동\"},{\"id\":\"cafe\",\"name\":\"카페\",\"type\":\"cafe\"}]";
  private static final String OK = HEAD + "," + PLACES + ",\"blocks\":[{\"id\":\"am\"}]}";

  private static void bad(String body, String msg) throws Exception {
    JsonNode n = body == null ? null : j(body);
    assertThatThrownBy(() -> PlanValidator.validate(n)).isInstanceOf(ApiException.class)
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
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"}}", "day.dateKey/weekday required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\"}}", "day.dateKey/weekday required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\",\"weekday\":\"화요일\"}}", "city.key/nameKo required");
    bad("{\"tier\":\"small\",\"agent\":{\"name\":\"모모\"},\"day\":{\"dateKey\":\"2026-09-08\",\"weekday\":\"화요일\"},\"city\":{\"key\":\"seoul\"}}", "city.key/nameKo required");
    bad(HEAD + "}", "places must be a non-empty array");
    bad(HEAD + ",\"places\":[]}", "places must be a non-empty array");
    bad(HEAD + ",\"places\":\"x\"}", "places must be a non-empty array");
    bad(HEAD + ",\"places\":[{\"id\":\"x\",\"name\":\"y\",\"type\":\"spaceport\"},{\"id\":\"x\",\"type\":\"cafe\"},null,1]}", "places must be a non-empty array");
    bad(HEAD + "," + PLACES + "}", "blocks must have 1-6 known block ids");
    bad(HEAD + "," + PLACES + ",\"blocks\":[]}", "blocks must have 1-6 known block ids");
    bad(HEAD + "," + PLACES + ",\"blocks\":[{\"id\":\"sleep\"},{\"id\":\"brunch\"},null,\"am\"]}", "blocks must have 1-6 known block ids");
  }

  @Test
  void defaults() throws Exception {
    PlanRequest r = PlanValidator.validate(j(OK));
    assertThat(r.tier()).isEqualTo("small");
    assertThat(r.agent().name()).isEqualTo("모모");
    assertThat(r.agent().traits()).isEmpty();
    assertThat(r.day().dateKey()).isEqualTo("2026-09-08");
    assertThat(r.day().weekday()).isEqualTo("화요일");
    assertThat(r.city().key()).isEqualTo("seoul");
    assertThat(r.city().home()).isFalse();
    assertThat(r.status().money()).isZero();
    assertThat(r.status().fatigue()).isEqualTo(30);
    assertThat(r.status().mood()).isEqualTo(60);
    assertThat(r.worry()).isNull();
    assertThat(r.visited()).isEmpty();
    assertThat(r.places()).hasSize(2);
    assertThat(r.places().get(1).area()).isEmpty();   // area 없으면 ''
    PlanBlockRequest b = r.blocks().get(0);
    assertThat(b.id()).isEqualTo("am");
    assertThat(b.category()).isNull();
    assertThat(b.from()).isEmpty();
    assertThat(b.avoid()).isEmpty();
    assertThat(b.previous()).isNull();   // 키가 없으면 null — "다른 제안 보기"가 아니다
  }

  @Test
  void normalizesAndClamps() throws Exception {
    String body = HEAD.replace("\"tier\":\"small\"", "\"tier\":\"good\"").replace("\"nameKo\":\"서울\"", "\"nameKo\":\"서울\",\"home\":true")
      + ",\"status\":{\"money\":619999.6,\"fatigue\":120.4,\"mood\":-3},\"worry\":\"work\",\"visited\":[\"경의선숲길\",1,null,\"카페\"],"
      + PLACES + ",\"blocks\":[{\"id\":\"lunch\",\"category\":\"meal\",\"from\":\"우리 집\",\"avoid\":[\"home\",\"nope\",3],\"previous\":[\"툭툭누들에서 팟타이\",7]},"
      + "{\"id\":\"pm\",\"category\":\"sleep\",\"from\":5,\"avoid\":\"home\",\"previous\":[]}]}";
    PlanRequest r = PlanValidator.validate(j(body));
    assertThat(r.tier()).isEqualTo("good");
    assertThat(r.city().home()).isTrue();
    assertThat(r.status().money()).isEqualTo(620000);
    assertThat(r.status().fatigue()).isEqualTo(100);
    assertThat(r.status().mood()).isZero();
    assertThat(r.worry()).isEqualTo("work");
    assertThat(r.visited()).containsExactly("경의선숲길", "카페");
    PlanBlockRequest lunch = r.blocks().get(0);
    assertThat(lunch.category()).isEqualTo("meal");
    assertThat(lunch.from()).isEqualTo("우리 집");
    assertThat(lunch.avoid()).containsExactly("home");   // 카탈로그에 없는 id는 뺀다
    assertThat(lunch.previous()).containsExactly("툭툭누들에서 팟타이");
    PlanBlockRequest pm = r.blocks().get(1);
    assertThat(pm.category()).isNull();   // 모델이 고를 수 없는 범주는 null
    assertThat(pm.from()).isEmpty();
    assertThat(pm.avoid()).isEmpty();
    assertThat(pm.previous()).isEmpty();   // 빈 배열은 빈 목록 (null이 아니다)

    // 모르는 worry·home이 true가 아닌 것·status가 객체가 아닌 것 → 기본값
    PlanRequest d = PlanValidator.validate(j(HEAD.replace("\"nameKo\":\"서울\"", "\"nameKo\":\"서울\",\"home\":\"yes\"") + ",\"status\":\"x\",\"worry\":\"love\"," + PLACES + ",\"blocks\":[{\"id\":\"am\"}]}"));
    assertThat(d.city().home()).isFalse();
    assertThat(d.worry()).isNull();
    assertThat(d.status().money()).isZero();
    assertThat(d.status().fatigue()).isEqualTo(30);
    assertThat(PlanValidator.validate(j(OK.replace("\"blocks\"", "\"status\":{\"mood\":49.5},\"blocks\""))).status().mood()).isEqualTo(50);
  }

  @Test
  void capsAndTrims() throws Exception {
    StringBuilder traits = new StringBuilder("[");
    for (int i = 0; i < 15; i++) traits.append(i > 0 ? "," : "").append("\"t").append(i).append("가".repeat(50)).append("\"");
    traits.append(",1,null]");
    StringBuilder places = new StringBuilder("[");
    for (int i = 0; i < 130; i++) places.append(i > 0 ? "," : "").append("{\"id\":\"p").append(i).append("\",\"name\":\"").append("가".repeat(50)).append("\",\"type\":\"cafe\",\"area\":\"").append("나".repeat(30)).append("\"}");
    places.append("]");
    StringBuilder avoid = new StringBuilder("[");
    for (int i = 0; i < 15; i++) avoid.append(i > 0 ? "," : "").append("\"p").append(i).append("\"");
    avoid.append("]");
    StringBuilder previous = new StringBuilder("[");
    for (int i = 0; i < 8; i++) previous.append(i > 0 ? "," : "").append("\"c").append(i).append("\"");
    previous.append("]");
    StringBuilder visited = new StringBuilder("[");
    for (int i = 0; i < 12; i++) visited.append(i > 0 ? "," : "").append("\"v").append(i).append("\"");
    visited.append("]");
    String blocks = "[{\"id\":\"morning\"},{\"id\":\"am\",\"avoid\":" + avoid + ",\"previous\":" + previous + ",\"from\":\"" + "다".repeat(50) + "\"},{\"id\":\"lunch\"},{\"id\":\"pm\"},{\"id\":\"evening\"},{\"id\":\"night\"},{\"id\":\"morning\"},{\"id\":\"am\"}]";
    String body = "{\"tier\":\"small\",\"agent\":{\"name\":\"" + "모".repeat(30) + "\",\"traits\":" + traits + ",\"likes\":\"x\"},"
      + "\"day\":{\"dateKey\":\"2026-09-08T00\",\"weekday\":\"화요일입니다\"},\"city\":{\"key\":\"" + "k".repeat(50) + "\",\"nameKo\":\"" + "서".repeat(30) + "\"},"
      + "\"visited\":" + visited + ",\"places\":" + places + ",\"blocks\":" + blocks + "}";
    PlanRequest r = PlanValidator.validate(j(body));
    assertThat(r.agent().name()).hasSize(20);
    assertThat(r.agent().traits()).hasSize(12);
    assertThat(r.agent().traits().get(0)).hasSize(40).startsWith("t0");
    assertThat(r.agent().likes()).isEmpty();
    assertThat(r.day().dateKey()).isEqualTo("2026-09-08");
    assertThat(r.day().weekday()).isEqualTo("화요일입");
    assertThat(r.city().key()).hasSize(40);
    assertThat(r.city().nameKo()).hasSize(20);
    assertThat(r.visited()).hasSize(10);
    assertThat(r.places()).hasSize(120);
    assertThat(r.places().get(0).name()).hasSize(40);
    assertThat(r.places().get(0).area()).hasSize(20);
    assertThat(r.places().get(119).id()).isEqualTo("p119");
    assertThat(r.blocks()).hasSize(6);
    assertThat(r.blocks()).extracting(PlanBlockRequest::id).containsExactly("morning", "am", "lunch", "pm", "evening", "night");
    PlanBlockRequest am = r.blocks().get(1);
    assertThat(am.from()).hasSize(40);
    assertThat(am.avoid()).hasSize(12);
    assertThat(am.previous()).hasSize(6);
    assertThat(am.previous()).isEqualTo(List.of("c0", "c1", "c2", "c3", "c4", "c5"));
  }
}
