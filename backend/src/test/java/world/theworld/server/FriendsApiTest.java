package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;

/** 친구 관계 (BACKEND-CONTRACT §2.3): 대칭·멱등·403·하루 창. */
class FriendsApiTest extends ApiTest {
  static final long H = 3_600_000L;

  @Test
  void symmetricIdempotentWithNow() throws Exception {
    Session a = newUser();
    Session b = newUser();
    putAgent(a, "에이");
    putAgent(b, "비");
    long day = 1_950_000_000_000L;
    putSchedule(b, day, day + 24 * H, acts(activity("d@Asia/Seoul:am", "cafe-x", day + 9 * H, day + 11 * H)));

    MvcResult add = call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", b.userId(), "metAt", day + 10 * H, "metPlaceId", "cafe-x")).andReturn();
    assertThat(add.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(add).get("ok").asBoolean()).isTrue();
    assertThat(json(add).get("created").asBoolean()).isTrue();

    // 멱등 — 반대쪽에서 다시 넣어도 created:false, 처음 기록이 남는다
    MvcResult again = call(HttpMethod.POST, "/api/friends", b, Map.of("otherId", a.userId(), "metAt", 1, "metPlaceId", "other")).andReturn();
    assertThat(json(again).get("created").asBoolean()).isFalse();

    // 대칭 — 양쪽 목록에 서로 보인다
    JsonNode fa = json(call(HttpMethod.GET, "/api/friends?at=" + (day + 10 * H), a, null).andReturn()).get("friends");
    assertThat(fa).hasSize(1);
    assertThat(fa.get(0).get("agent").get("id").asText()).isEqualTo(b.userId());
    assertThat(fa.get(0).get("agent").get("name").asText()).isEqualTo("비");
    assertThat(fa.get(0).get("metAt").asLong()).isEqualTo(day + 10 * H);
    assertThat(fa.get(0).get("metPlaceId").asText()).isEqualTo("cafe-x");
    assertThat(fa.get(0).get("now").get("key").asText()).isEqualTo("d@Asia/Seoul:am");

    JsonNode fb = json(call(HttpMethod.GET, "/api/friends?at=" + (day + 12 * H), b, null).andReturn()).get("friends");
    assertThat(fb).hasSize(1);
    assertThat(fb.get(0).get("agent").get("id").asText()).isEqualTo(a.userId());
    assertThat(fb.get(0).has("now")).isTrue();
    assertThat(fb.get(0).get("now").isNull()).isTrue();   // 그 시각엔 발행 활동 없음 → null
    assertThat(fb.get(0).get("metAt").asLong()).isEqualTo(day + 10 * H);

    // metAt 없이도 된다 — null로 돌아온다
    Session c = newUser();
    putAgent(c, "씨");
    call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", c.userId())).andReturn();
    JsonNode fa2 = json(call(HttpMethod.GET, "/api/friends", a, null).andReturn()).get("friends");
    assertThat(fa2).hasSize(2);
    JsonNode cEntry = fa2.get(0).get("agent").get("id").asText().equals(c.userId()) ? fa2.get(0) : fa2.get(1);
    assertThat(cEntry.get("metAt").isNull()).isTrue();
    assertThat(cEntry.get("metPlaceId").isNull()).isTrue();
  }

  @Test
  void selfAndUnknownAreRejected() throws Exception {
    Session a = newUser();
    MvcResult self = call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", a.userId())).andReturn();
    assertThat(self.getResponse().getStatus()).isEqualTo(400);
    MvcResult unknown = call(HttpMethod.POST, "/api/friends", a, Map.of("otherId", "nobody-here")).andReturn();
    assertThat(unknown.getResponse().getStatus()).isEqualTo(404);
    assertThat(json(unknown).get("error").asText()).isEqualTo("user not found");
    MvcResult missing = call(HttpMethod.POST, "/api/friends", a, Map.of()).andReturn();
    assertThat(missing.getResponse().getStatus()).isEqualTo(400);
  }

  @Test
  void dayNeedsFriendshipAndSmallWindow() throws Exception {
    Session a = newUser();
    Session b = newUser();
    putAgent(b, "비");
    long day = 1_950_000_000_000L;
    putSchedule(b, day, day + 24 * H, acts(activity("d@Asia/Seoul:am", "cafe-y", day + 9 * H, day + 11 * H)));

    MvcResult forbidden = call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), a, null).andReturn();
    assertThat(forbidden.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(forbidden).get("error").asText()).isEqualTo("not friends");
    // 친구가 아니면 창이 7일을 넘어도 403 — 권한이 검증보다 먼저
    MvcResult forbiddenWide = call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day + "&to=" + (day + 8 * 24 * H), a, null).andReturn();
    assertThat(forbiddenWide.getResponse().getStatus()).isEqualTo(403);

    call(HttpMethod.POST, "/api/friends", b, Map.of("otherId", a.userId())).andReturn();
    MvcResult ok = call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), a, null).andReturn();
    assertThat(ok.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(ok).get("activities")).hasSize(1);

    MvcResult tooWide = call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day + "&to=" + (day + 8 * 24 * H), a, null).andReturn();
    assertThat(tooWide.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(tooWide).get("error").asText()).isEqualTo("window must be ≤ 7 days");
    MvcResult noParam = call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day, a, null).andReturn();
    assertThat(noParam.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(noParam).get("error").asText()).isEqualTo("to required");

    // 삭제하면 204, 목록에서 사라지고 하루는 다시 403
    MvcResult del = call(HttpMethod.DELETE, "/api/friends/" + b.userId(), a, null).andReturn();
    assertThat(del.getResponse().getStatus()).isEqualTo(204);
    assertThat(json(call(HttpMethod.GET, "/api/friends", b, null).andReturn()).get("friends")).isEmpty();
    assertThat(call(HttpMethod.GET, "/api/friends/" + b.userId() + "/day?from=" + day + "&to=" + (day + 24 * H), a, null).andReturn().getResponse().getStatus()).isEqualTo(403);
    // 없는 관계를 지워도 204
    assertThat(call(HttpMethod.DELETE, "/api/friends/" + b.userId(), a, null).andReturn().getResponse().getStatus()).isEqualTo(204);
  }
}
