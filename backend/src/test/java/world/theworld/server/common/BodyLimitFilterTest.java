package world.theworld.server.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 본문 상한 (BACKEND-CONTRACT §0): Content-Length가 없는(chunked) 요청도 읽는 중에 한도에서 끊긴다 — 필터 단독 검사.
 * 실제 서블릿 경로(Jackson → HttpMessageNotReadableException → 413)는 GlobalExceptionHandler 매핑으로 잇는다.
 */
class BodyLimitFilterTest {
  private static final TheworldProps PROPS = new TheworldProps(
    new TheworldProps.Cors("http://localhost:5173"), new TheworldProps.Ollama("http://127.0.0.1:9", 25_000), new TheworldProps.Models("s", "g"),
    new TheworldProps.Trip("", 90_000, 100_000, 22_000), new TheworldProps.Plan(20_000, 120_000), new TheworldProps.Search(""), new TheworldProps.Nominatim("http://127.0.0.1:9", "", 0),
    new TheworldProps.Docs(4_194_304));

  /** Content-Length를 알리지 않는 요청 (Transfer-Encoding: chunked) — MockHttpServletRequest는 본문이 있으면 길이를 알려 주므로 덮는다. */
  private static MockHttpServletRequest chunked(String uri, byte[] body) {
    MockHttpServletRequest req = new MockHttpServletRequest("POST", uri) {
      @Override public long getContentLengthLong() { return -1; }
      @Override public int getContentLength() { return -1; }
    };
    req.setRequestURI(uri);
    req.setContent(body);
    req.setContentType("application/json");
    return req;
  }

  /** 핸들러 흉내: 본문을 끝까지 읽는다 (Jackson이 하듯). */
  private static FilterChain readAll(AtomicReference<byte[]> got) {
    return new MockFilterChain() {
      @Override public void doFilter(ServletRequest req, jakarta.servlet.ServletResponse res) throws java.io.IOException {
        got.set(req.getInputStream().readAllBytes());
      }
    };
  }

  @Test
  void chunkedBodyOverLimitStopsWhileReading() {
    BodyLimitFilter f = new BodyLimitFilter(PROPS);
    byte[] big = new byte[(int) BodyLimitFilter.DEFAULT_MAX + 1];
    AtomicReference<byte[]> got = new AtomicReference<>();
    assertThatThrownBy(() -> f.doFilter(chunked("/api/auth/login", big), new MockHttpServletResponse(), readAll(got)))
      .isInstanceOf(BodyTooLargeException.class);
    assertThat(got.get()).isNull();
  }

  @Test
  void chunkedBodyUnderLimitPassesIntact() throws Exception {
    BodyLimitFilter f = new BodyLimitFilter(PROPS);
    byte[] body = "{\"userId\":\"yoongwan\"}".getBytes(StandardCharsets.UTF_8);
    AtomicReference<byte[]> got = new AtomicReference<>();
    MockHttpServletResponse res = new MockHttpServletResponse();
    f.doFilter(chunked("/api/auth/login", body), res, readAll(got));
    assertThat(res.getStatus()).isEqualTo(200);
    assertThat(got.get()).isEqualTo(body);
  }

  @Test
  void limitsPerPath() {
    BodyLimitFilter f = new BodyLimitFilter(PROPS);
    assertThat(f.limitFor("/api/sketch/read")).isEqualTo(BodyLimitFilter.SKETCH_MAX);
    assertThat(f.limitFor("/api/me/docs/world")).isEqualTo(4_194_304);
    assertThat(f.limitFor("/api/chat/reply")).isEqualTo(BodyLimitFilter.DEFAULT_MAX);
    // 문서 경로의 chunked 본문은 4 MB까지 읽힌다
    byte[] medium = new byte[600 * 1024];
    AtomicReference<byte[]> got = new AtomicReference<>();
    assertThatThrownBy(() -> f.doFilter(chunked("/api/chat/reply", medium), new MockHttpServletResponse(), readAll(got))).isInstanceOf(BodyTooLargeException.class);
  }

  @Test
  void declaredLengthOverLimitIs413WithoutReading() throws Exception {
    BodyLimitFilter f = new BodyLimitFilter(PROPS);
    MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/auth/login");
    req.setRequestURI("/api/auth/login");
    req.setContent(new byte[(int) BodyLimitFilter.DEFAULT_MAX + 1]);
    MockHttpServletResponse res = new MockHttpServletResponse();
    AtomicReference<byte[]> got = new AtomicReference<>();
    f.doFilter(req, res, readAll(got));
    assertThat(res.getStatus()).isEqualTo(413);
    assertThat(res.getContentAsString()).contains("body too large");
    assertThat(got.get()).isNull();
  }

  @Test
  @SuppressWarnings("unchecked")
  void handlerMapsTooLargeTo413AndHidesInternalMessages() {
    GlobalExceptionHandler h = new GlobalExceptionHandler();
    ResponseEntity<Map<String, Object>> r = h.unreadable(new HttpMessageNotReadableException("I/O error while reading input message",
      new BodyTooLargeException(10), new MockHttpInputMessage(new byte[0])));
    assertThat(r.getStatusCode().value()).isEqualTo(413);
    assertThat(r.getBody()).containsEntry("error", "body too large");
    // 예상 못 한 예외의 메시지(SQL·테이블·id)는 응답에 실리지 않는다
    ResponseEntity<Map<String, Object>> u = h.unexpected(new IllegalStateException("could not execute statement [Unique index or primary key violation on user_doc]"));
    assertThat(u.getStatusCode().value()).isEqualTo(500);
    assertThat(u.getBody()).containsEntry("error", "internal error");
  }
}
