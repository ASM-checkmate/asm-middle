package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;

/** 겹침 조회 규칙 (BACKEND-CONTRACT §2.3 POST /api/agents/at): 자기 제외·30분·프로필 없는 사용자 제외·id 정렬·슬롯당 8명. */
class AgentsAtApiTest extends ApiTest {
  static final long H = 3_600_000L;
  static final long M = 60_000L;

  private JsonNode ask(Session me, String placeId, long from, long to) throws Exception {
    MvcResult r = call(HttpMethod.POST, "/api/agents/at", me, Map.of("slots", List.of(Map.of("key", "slot", "placeId", placeId, "from", from, "to", to)))).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    return json(r).get("hits").get("slot");
  }

  @Test
  void rules() throws Exception {
    long day = 1_900_000_000_000L;
    String place = "place-" + System.nanoTime();
    Session me = newUser();
    putAgent(me, "나");
    putSchedule(me, day, day + 24 * H, acts(activity("d@Asia/Seoul:pm", place, day + 14 * H, day + 17 * H)));   // 나 자신 — 제외

    Session long45 = newUser();
    putAgent(long45, "긴");
    putSchedule(long45, day, day + 24 * H, acts(activity("d@Asia/Seoul:pm", place, day + 14 * H + 15 * M, day + 18 * H)));   // 45분 겹침

    Session short10 = newUser();
    putAgent(short10, "짧");
    putSchedule(short10, day, day + 24 * H, acts(activity("d@Asia/Seoul:pm", place, day + 14 * H + 50 * M, day + 18 * H)));   // 10분 겹침

    Session noProfile = newUser();
    putSchedule(noProfile, day, day + 24 * H, acts(activity("d@Asia/Seoul:pm", place, day + 14 * H, day + 18 * H)));   // 프로필 없음

    Session elsewhere = newUser();
    putAgent(elsewhere, "딴곳");
    putSchedule(elsewhere, day, day + 24 * H, acts(activity("d@Asia/Seoul:pm", place + "-other", day + 14 * H, day + 18 * H)));

    JsonNode hits = ask(me, place, day + 14 * H, day + 15 * H);
    assertThat(hits).hasSize(1);
    JsonNode hit = hits.get(0);
    assertThat(hit.get("agent").get("id").asText()).isEqualTo(long45.userId());
    assertThat(hit.get("agent").get("name").asText()).isEqualTo("긴");
    assertThat(hit.get("agent").get("home").get("type").asText()).isEqualTo("friend_home");
    assertThat(hit.get("overlapMs").asLong()).isEqualTo(45 * M);
    assertThat(hit.get("activity").get("agentId").asText()).isEqualTo(long45.userId());
    assertThat(hit.get("activity").get("placeId").asText()).isEqualTo(place);
    assertThat(hit.get("activity").get("key").asText()).isEqualTo("d@Asia/Seoul:pm");

    // 정확히 30분은 포함
    assertThat(ask(me, place, day + 14 * H + 15 * M, day + 14 * H + 45 * M)).hasSize(1);
    // 29분은 제외
    assertThat(ask(me, place, day + 14 * H + 15 * M, day + 14 * H + 44 * M)).isEmpty();
  }

  @Test
  void sortedByIdAndCappedAtEight() throws Exception {
    long day = 1_900_000_000_000L;
    String place = "busy-" + System.nanoTime();
    Session me = newUser();
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < 9; i++) {
      Session u = newUser();
      putAgent(u, "u" + i);
      putSchedule(u, day, day + 24 * H, acts(activity("d@Asia/Seoul:am", place, day + 9 * H, day + 11 * H)));
      ids.add(u.userId());
    }
    JsonNode hits = ask(me, place, day + 9 * H, day + 11 * H);
    assertThat(hits).hasSize(8);
    List<String> got = new ArrayList<>();
    hits.forEach(h -> got.add(h.get("agent").get("id").asText()));
    List<String> expected = ids.stream().sorted().limit(8).toList();
    assertThat(got).isEqualTo(expected);
  }

  @Test
  void multipleSlotsAndValidation() throws Exception {
    long day = 1_900_000_000_000L;
    String place = "multi-" + System.nanoTime();
    Session me = newUser();
    Session other = newUser();
    putAgent(other, "상대");
    putSchedule(other, day, day + 24 * H, acts(
      activity("d@Asia/Seoul:am", place, day + 9 * H, day + 11 * H),
      activity("d@Asia/Seoul:pm", place, day + 14 * H, day + 16 * H)));
    MvcResult r = call(HttpMethod.POST, "/api/agents/at", me, Map.of("slots", List.of(
      Map.of("key", "a", "placeId", place, "from", day + 9 * H, "to", day + 10 * H),
      Map.of("key", "b", "placeId", place, "from", day + 12 * H, "to", day + 13 * H),
      Map.of("key", "c", "placeId", place, "from", day + 10 * H, "to", day + 15 * H)))).andReturn();
    JsonNode hits = json(r).get("hits");
    assertThat(hits.get("a")).hasSize(1);
    assertThat(hits.get("b")).isEmpty();
    assertThat(hits.get("c")).hasSize(1);   // 한 사람은 한 번 — 더 오래 겹친 활동(am 1h vs pm 1h → 먼저 본 am)
    assertThat(hits.get("c").get(0).get("overlapMs").asLong()).isEqualTo(H);

    List<Map<String, Object>> tooMany = new ArrayList<>();
    for (int i = 0; i < 17; i++) tooMany.add(Map.of("key", "k" + i, "placeId", place, "from", day, "to", day + H));
    MvcResult bad = call(HttpMethod.POST, "/api/agents/at", me, Map.of("slots", tooMany)).andReturn();
    assertThat(bad.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(bad).get("error").asText()).isEqualTo("slots must have ≤ 16 items");
    assertThat(json(call(HttpMethod.POST, "/api/agents/at", me, Map.of()).andReturn()).get("error").asText()).isEqualTo("slots required");
  }
}
