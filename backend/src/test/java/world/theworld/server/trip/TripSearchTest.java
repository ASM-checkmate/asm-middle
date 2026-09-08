package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmFixtures;
import world.theworld.server.trip.TripDtos.SearchHit;

/** trip.test.mjs '검색' 4개 이관 + 웹 검색 호출 모양 (search.ts webSearch: Bearer·body·12초·병렬 3). 실제 ollama.com은 부르지 않는다. */
class TripSearchTest {
  private HttpServer server;
  private final List<String> auths = new CopyOnWriteArrayList<>();
  private final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
  private volatile int status = 200;

  @BeforeEach
  void up() throws Exception {
    server = LlmFixtures.server();
    server.createContext("/api/web_search", ex -> {
      auths.add(ex.getRequestHeaders().getFirst("Authorization"));
      JsonNode b = LlmFixtures.OM.readTree(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      bodies.add(b);
      LlmFixtures.respond(ex, status, "{\"results\":[{\"title\":\"T " + b.get("query").asText() + "\",\"url\":\"https://r/" + bodies.size() + "\",\"content\":\"c\"},{\"title\":\"no url\"}]}");
    });
  }

  @AfterEach
  void down() { server.stop(0); }

  private SearchClient client(String key) { return new SearchClient(LlmFixtures.url(server) + "/api/web_search", key, LlmFixtures.OM); }

  @Test
  void threeQueriesAllContainCity() {
    List<String> qs = SearchClient.buildTripQueries("교토");
    assertThat(qs).hasSize(3).allMatch(q -> q.contains("교토"));
    assertThat(qs).anyMatch(q -> q.contains("travel"));
  }

  @Test
  void parseSearchBodyDropsAndTrims() throws Exception {
    JsonNode j = LlmFixtures.OM.readTree("{\"results\":[{\"title\":\"A\",\"url\":\"https://a\",\"content\":\"" + "x".repeat(900) + "\"},{\"title\":\"B\",\"url\":\"\"},{\"title\":\"C\"},{\"url\":\"https://c\",\"content\":\"  여러   공백 \"}]}");
    List<SearchHit> body = SearchClient.parseSearchBody(j);
    assertThat(body).hasSize(2);
    assertThat(body.get(0).content()).hasSize(SearchClient.SNIPPET_MAX);
    assertThat(body.get(1).content()).isEqualTo("여러 공백");
    assertThat(body.get(1).title()).isEqualTo("");
  }

  @Test
  void notShapedIsEmpty() throws Exception {
    assertThat(SearchClient.parseSearchBody(null)).isEmpty();
    assertThat(SearchClient.parseSearchBody(LlmFixtures.OM.readTree("{\"results\":\"x\"}"))).isEmpty();
  }

  @Test
  void requestShape() {
    List<SearchHit> hits = client("k-1").search("교토 여행", 20);
    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).title()).isEqualTo("T 교토 여행");
    assertThat(auths.get(0)).isEqualTo("Bearer k-1");
    assertThat(bodies.get(0).get("query").asText()).isEqualTo("교토 여행");
    assertThat(bodies.get(0).get("max_results").asInt()).isEqualTo(10);   // 상한 10
    assertThat(bodies.get(0).size()).isEqualTo(2);
  }

  @Test
  void noKeyIs503() {
    assertThatThrownBy(() -> client("  ").search("x")).isInstanceOf(NoApiKeyException.class).hasMessage("OLLAMA_API_KEY not set — web search unavailable");
    assertThatThrownBy(() -> client("").searchAll("교토")).isInstanceOf(NoApiKeyException.class);
    assertThat(bodies).isEmpty();
  }

  @Test
  void searchAllRunsThreeInOrder() {
    List<List<SearchHit>> groups = client("k").searchAll("교토");
    assertThat(groups).hasSize(3);
    assertThat(groups.get(0).get(0).title()).isEqualTo("T 교토 여행 가볼 만한 곳 명소");
    assertThat(groups.get(2).get(0).title()).isEqualTo("T 교토 travel guide things to do airport station");
    assertThat(bodies).hasSize(3);
    assertThat(bodies.stream().map(b -> b.get("max_results").asInt())).containsOnly(8);
  }

  @Test
  void serverErrorIsSearchException() {
    status = 500;
    assertThatThrownBy(() -> client("k").search("x")).isInstanceOf(SearchClient.SearchException.class).hasMessageStartingWith("web_search 500: ");
  }
}
