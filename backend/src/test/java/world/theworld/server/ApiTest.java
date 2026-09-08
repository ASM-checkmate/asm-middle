package world.theworld.server;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.AppUserRepository;
import world.theworld.server.auth.UserIdAuthFilter;

/**
 * MockMvc 공통 — 실제 필터(CORS·본문 상한·X-User-Id)와 H2 인메모리(test 프로필)를 그대로 태운다.
 * 컨텍스트를 테스트끼리 공유하고 시드 아이디 다섯으론 모자라므로, 사용자는 매번 새 아이디를 app_user에 직접 넣는다(로그인은 상태를 바꾸지 않는다).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class ApiTest {
  /** 요청에 실을 아이디 — 헤더 하나가 곧 세션이다. */
  public record Session(String userId) {}

  @Autowired protected MockMvc mvc;
  @Autowired protected ObjectMapper om;
  @Autowired protected AppUserRepository users;

  protected JsonNode json(MvcResult r) throws Exception {
    String s = r.getResponse().getContentAsString();
    return s.isEmpty() ? om.nullNode() : om.readTree(s);
  }

  protected ResultActions call(HttpMethod method, String path, Session s, Object body) throws Exception {
    MockHttpServletRequestBuilder b = request(method, path);
    if (s != null) b.header(UserIdAuthFilter.HEADER, s.userId());
    if (body != null) b.contentType(MediaType.APPLICATION_JSON).content(body instanceof String str ? str : om.writeValueAsString(body));
    return mvc.perform(b);
  }

  /** 새 사용자 한 명 — 아이디 모양 ^[a-z][a-z0-9_]{1,23}$ 안에서 (t + uuid 앞 20자 = 21자). */
  protected Session newUser() {
    String id = "t" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    users.save(new AppUser(id, "테스트 " + id.substring(1, 5), System.currentTimeMillis()));
    return new Session(id);
  }

  protected Map<String, Object> home(double lng, double lat) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", "ignored"); m.put("name", "우리집"); m.put("type", "cafe"); m.put("lng", lng); m.put("lat", lat);
    m.put("area", "연남동"); m.put("city", "seoul"); m.put("country", "KR"); m.put("emoji", "🏠");
    return m;
  }

  protected JsonNode putAgent(Session s, String name) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name); body.put("color", "#5FC9A6"); body.put("emoji", "🐥"); body.put("hairStyle", "short");
    body.put("likes", List.of("카페", "산책")); body.put("traits", List.of("외향적")); body.put("home", home(126.92, 37.56));
    MvcResult r = call(HttpMethod.PUT, "/api/me/agent", s, body).andReturn();
    if (r.getResponse().getStatus() != 200) throw new AssertionError("putAgent " + r.getResponse().getStatus() + " " + r.getResponse().getContentAsString());
    return json(r);
  }

  protected Map<String, Object> activity(String key, String placeId, long arriveAt, long endAt) {
    Map<String, Object> m = new LinkedHashMap<>();
    int i = key.lastIndexOf(':');
    m.put("key", key); m.put("agentId", "whatever"); m.put("dayKey", key.substring(0, i)); m.put("blockId", key.substring(i + 1));
    m.put("placeId", placeId); m.put("category", "play"); m.put("title", "산책"); m.put("emoji", "🚶");
    m.put("arriveAt", arriveAt); m.put("endAt", endAt); m.put("tz", "Asia/Seoul"); m.put("companions", List.of());
    return m;
  }

  protected JsonNode putSchedule(Session s, long from, long to, List<Map<String, Object>> acts) throws Exception {
    MvcResult r = call(HttpMethod.PUT, "/api/me/schedule", s, Map.of("from", from, "to", to, "activities", acts)).andReturn();
    if (r.getResponse().getStatus() != 200) throw new AssertionError("putSchedule " + r.getResponse().getStatus() + " " + r.getResponse().getContentAsString());
    return json(r);
  }

  protected List<Map<String, Object>> acts(Map<String, Object>... a) {
    return new ArrayList<>(List.of(a));
  }
}
