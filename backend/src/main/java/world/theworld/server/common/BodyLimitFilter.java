package world.theworld.server.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 본문 상한 (BACKEND-CONTRACT §0): /api/sketch/read 512 KB, /api/me/docs/* 4 MB(theworld.docs.max-bytes), 그 외 /api/** 256 KB.
 * Content-Length가 한도를 넘으면 읽지 않고 413 {error:'body too large'}. 길이를 안 알리는(chunked) 요청은 Content-Length가 -1이라
 * 그 검사를 지나치므로, 요청을 바이트를 세는 래퍼로 감싸 한도를 넘는 순간 {@link BodyTooLargeException}을 던진다 — Jackson이 본문을
 * 다 메모리에 올리기 전에 끊기고, {@link GlobalExceptionHandler#unreadable}이 그 예외를 같은 413으로 바꾼다. 아이디 없이 닿는
 * 공개 경로(/api/auth/login)도 같은 필터를 지나므로 비인증 요청으로 힙을 채울 수 없다.
 */
@Component
@Order(10)
public class BodyLimitFilter extends OncePerRequestFilter {
  public static final long SKETCH_MAX = 512L * 1024;
  public static final long DEFAULT_MAX = 256L * 1024;

  private final TheworldProps props;

  public BodyLimitFilter(TheworldProps props) { this.props = props; }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest req) {
    return !req.getRequestURI().startsWith("/api/");
  }

  long limitFor(String path) {
    if (path.equals("/api/sketch/read")) return SKETCH_MAX;
    if (path.startsWith("/api/me/docs/")) return props.docs().maxBytes();
    return DEFAULT_MAX;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
    long limit = limitFor(req.getRequestURI());
    if (req.getContentLengthLong() > limit) {
      JsonResponses.write(res, 413, "body too large");
      return;
    }
    chain.doFilter(new Limited(req, limit), res);
  }

  /** 읽은 바이트를 세는 요청. Content-Length가 정직한 요청도 같은 길을 지나지만 비용은 카운터 하나뿐이다. */
  static final class Limited extends HttpServletRequestWrapper {
    private final long limit;
    private ServletInputStream in;
    private BufferedReader reader;

    Limited(HttpServletRequest req, long limit) {
      super(req);
      this.limit = limit;
    }

    @Override
    public ServletInputStream getInputStream() throws IOException {
      if (in == null) in = new Counting(super.getInputStream(), limit);
      return in;
    }

    @Override
    public BufferedReader getReader() throws IOException {
      if (reader == null) {
        Charset cs = StandardCharsets.UTF_8;
        String enc = getCharacterEncoding();
        if (enc != null) { try { cs = Charset.forName(enc); } catch (IllegalArgumentException ignored) { /* 모르는 인코딩 — UTF-8로 */ } }
        reader = new BufferedReader(new InputStreamReader(getInputStream(), cs));
      }
      return reader;
    }
  }

  /** 한도를 넘는 순간 {@link BodyTooLargeException}. 넘긴 바이트는 마지막 read 한 번 분(버퍼 크기)뿐이다. */
  static final class Counting extends ServletInputStream {
    private final ServletInputStream d;
    private final long limit;
    private long count;

    Counting(ServletInputStream d, long limit) {
      this.d = d;
      this.limit = limit;
    }

    private void add(long n) throws IOException {
      if (n <= 0) return;
      count += n;
      if (count > limit) throw new BodyTooLargeException(limit);
    }

    @Override public int read() throws IOException { int b = d.read(); if (b >= 0) add(1); return b; }
    @Override public int read(byte[] b, int off, int len) throws IOException { int n = d.read(b, off, len); add(n); return n; }
    @Override public long skip(long n) throws IOException { long s = d.skip(n); add(s); return s; }
    @Override public int available() throws IOException { return d.available(); }
    @Override public void close() throws IOException { d.close(); }
    @Override public boolean isFinished() { return d.isFinished(); }
    @Override public boolean isReady() { return d.isReady(); }
    @Override public void setReadListener(ReadListener l) { d.setReadListener(l); }
  }
}
