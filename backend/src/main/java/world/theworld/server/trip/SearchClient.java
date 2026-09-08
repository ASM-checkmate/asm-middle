package world.theworld.server.trip;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.llm.Text;
import world.theworld.server.trip.TripDtos.SearchHit;

/**
 * 웹 검색 (옛 Node 백엔드 search.ts(커밋 0298e8d), docs/adr/0009-trip-search.md). Ollama Web Search 하나만 쓴다 — ollama.com 무료 계정의 API 키
 * (OLLAMA_API_KEY)로 부른다. 한도는 공개돼 있지 않다("개인용으로 넉넉한 무료 티어"). 도시당 한 번 검색하고 캐시하므로(TripCache) 하루 수십 회 수준이다.
 * web_fetch는 쓰지 않는다 — 시간 예산을 가장 쉽게 깨는 부분이다. 검색어 셋은 병렬(Promise.all → 가상 스레드 3개).
 */
@Component
public class SearchClient {
  /** 스니펫 하나의 최대 길이 — 프롬프트에 세 검색 × 여덟 결과가 들어간다. */
  public static final int SNIPPET_MAX = 500;
  public static final String SEARCH_URL = "https://ollama.com/api/web_search";
  public static final int MAX_RESULTS = 8;
  public static final long TIMEOUT_MS = 12_000;

  /** 검색 서버 오류·제한 시간 — TripService가 502로 바꾼다. */
  public static class SearchException extends RuntimeException {
    public SearchException(String message) { super(message); }
    public SearchException(String message, Throwable cause) { super(message, cause); }
  }

  private final String url;
  private final String apiKey;
  private final ObjectMapper om;
  private final RestClient client;

  @Autowired
  public SearchClient(TheworldProps props, ObjectMapper om) {
    this(SEARCH_URL, props.search().apiKey(), om);
  }

  /** 주소·키를 직접 — 테스트가 로컬 서버를 꽂는다. */
  public SearchClient(String url, String apiKey, ObjectMapper om) {
    this.url = url;
    this.apiKey = apiKey == null ? "" : apiKey.strip();
    this.om = om;
    JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
    f.setReadTimeout(Duration.ofMillis(TIMEOUT_MS));
    this.client = RestClient.builder().requestFactory(f).build();
  }

  /** `OLLAMA_API_KEY`. 없으면 NoApiKeyException(503). */
  public String requireApiKey() {
    if (apiKey.isEmpty()) throw new NoApiKeyException();
    return apiKey;
  }

  /**
   * 도시 하나에 대해 던질 검색어들. 한국어 둘(명소, 먹고 자는 곳)과 영어 하나(교통 포함) — 영문 이름이 지오코딩에 필요하다.
   *
   * @param cityKo 사용자가 말한 도시 이름
   */
  public static List<String> buildTripQueries(String cityKo) {
    return List.of(
      cityKo + " 여행 가볼 만한 곳 명소",
      cityKo + " 맛집 카페 호텔 추천",
      cityKo + " travel guide things to do airport station");
  }

  /**
   * 검색 응답 본문을 다듬는다. 순수 함수 — 모양이 어긋난 항목은 버리고, 스니펫은 자른다.
   *
   * @param json 응답 JSON (`{ results: [{ title, url, content }] }`)
   */
  public static List<SearchHit> parseSearchBody(JsonNode json) {
    List<SearchHit> out = new ArrayList<>();
    if (json == null) return out;
    JsonNode results = json.path("results");
    if (!results.isArray()) return out;
    for (JsonNode r : results) {
      if (!r.isObject()) continue;
      JsonNode url = r.get("url");
      if (url == null || !url.isTextual() || url.asText().isEmpty()) continue;
      JsonNode c = r.get("content");
      String content = c != null && c.isTextual() ? Text.cut(Text.collapse(c.asText()), SNIPPET_MAX) : "";
      JsonNode t = r.get("title");
      out.add(new SearchHit(t != null && t.isTextual() ? Text.cut(t.asText().strip(), 120) : "", url.asText(), content));
    }
    return out;
  }

  /** 한 번 검색한다 (결과 8개, 12초). */
  public List<SearchHit> search(String query) {
    return search(query, MAX_RESULTS);
  }

  /**
   * @param query 검색어
   * @param maxResults 결과 수 (Ollama 상한 10)
   * @throws NoApiKeyException 키 없음 · SearchException 서버 오류·제한 시간
   */
  public List<SearchHit> search(String query, int maxResults) {
    String key = requireApiKey();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("query", query);
    body.put("max_results", Math.max(1, Math.min(10, maxResults)));
    byte[] json;
    try { json = om.writeValueAsBytes(body); }
    catch (JsonProcessingException e) { throw new SearchException("web_search: cannot serialize request", e); }
    try {
      return client.post().uri(url).contentType(MediaType.APPLICATION_JSON).header("authorization", "Bearer " + key).body(json).exchange((req, res) -> {
        String text = new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8);
        if (!res.getStatusCode().is2xxSuccessful()) throw new SearchException("web_search " + res.getStatusCode().value() + ": " + Text.cut(text, 200));
        try { return parseSearchBody(om.readTree(text)); }
        catch (JsonProcessingException e) { throw new SearchException("web_search: unreadable response " + Text.cut(text, 200)); }
      });
    } catch (RestClientException e) {
      Throwable root = e;
      while (root.getCause() != null && root.getCause() != root) root = root.getCause();
      throw new SearchException("web_search: " + (root.getMessage() == null ? root.getClass().getSimpleName() : root.getMessage()), e);
    }
  }

  /**
   * 도시 하나의 검색어 셋을 병렬로 던진다. 검색어 순서대로 묶어 돌려준다 — 라운드로빈 섞기는 TripPrompt가 (결함 2).
   * 하나라도 실패하면 예외 (Promise.all과 같다).
   */
  public List<List<SearchHit>> searchAll(String cityKo) {
    requireApiKey();
    List<String> queries = buildTripQueries(cityKo);
    try (ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor()) {
      List<Future<List<SearchHit>>> fs = new ArrayList<>();
      for (String q : queries) fs.add(ex.submit(() -> search(q)));
      List<List<SearchHit>> out = new ArrayList<>();
      for (Future<List<SearchHit>> f : fs) {
        try { out.add(f.get()); }
        catch (ExecutionException e) {
          if (e.getCause() instanceof RuntimeException r) throw r;
          throw new SearchException("web_search: " + e.getCause(), e.getCause());
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          throw new SearchException("web_search interrupted", e);
        }
      }
      return out;
    }
  }
}
