package world.theworld.server.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import java.util.Set;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import world.theworld.server.common.JsonResponses;

/**
 * /api/** 보호 (BACKEND-CONTRACT §0·§2.1, 2026-09-08 오후 개정): {@code X-User-Id: <id>}가 없거나 모르는 아이디면 401 {error:'unauthorized'}.
 * 토큰도 비밀번호도 없다 — 아이디는 서버가 시드로 가진 다섯(V2__seed_users.sql) 중 하나이면 된다.
 * 공개 경로: /api/health, /api/models, /api/users, /api/auth/login. /actuator/**는 /api 밖이라 애초에 안 거친다.
 * preflight(OPTIONS)는 CORS 필터가 먼저 답하지만 혹시 여기까지 오면 통과시킨다.
 * 통과하면 request attribute {@link #ATTR_USER}에 AppUser를 실어 {@link CurrentUserArgumentResolver}가 꺼내 쓴다. last_seen 갱신(1분 스로틀)은 {@link AuthService#authenticate}.
 */
@Component
@Order(20)
public class UserIdAuthFilter extends OncePerRequestFilter {
  public static final String HEADER = "X-User-Id";
  public static final String ATTR_USER = "theworld.user";
  static final Set<String> PUBLIC_PATHS = Set.of("/api/health", "/api/models", "/api/users", "/api/auth/login");

  private final AuthService auth;

  public UserIdAuthFilter(AuthService auth) { this.auth = auth; }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest req) {
    String path = req.getRequestURI();
    return !path.startsWith("/api/") || PUBLIC_PATHS.contains(path) || "OPTIONS".equalsIgnoreCase(req.getMethod());
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
    String header = req.getHeader(HEADER);
    Optional<AppUser> user = auth.authenticate(header == null ? null : header.trim());
    if (user.isEmpty()) {
      JsonResponses.write(res, 401, "unauthorized");
      return;
    }
    req.setAttribute(ATTR_USER, user.get());
    chain.doFilter(req, res);
  }
}
