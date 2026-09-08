package world.theworld.server.auth;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.common.ApiException;

/**
 * 인증 (BACKEND-CONTRACT §2.1, 2026-09-08 오후 개정): 토큰 없는 고정 아이디 로그인.
 * GET /api/users → {users:[{id,name}]} · POST /api/auth/login {userId} → {userId,name} (404 모르는 아이디 / 400 모양 오류) ·
 * GET /api/me → {userId,name,createdAt}. 앞 둘은 공개, /api/me는 X-User-Id가 있어야 한다.
 */
@RestController
public class AuthController {
  public record UserItem(String id, String name) {}
  public record UsersResponse(List<UserItem> users) {}
  public record LoginRequest(String userId) {}
  public record LoginResponse(String userId, String name) {}
  public record MeResponse(String userId, String name, long createdAt) {}

  private final AuthService auth;

  public AuthController(AuthService auth) { this.auth = auth; }

  @GetMapping("/api/users")
  public UsersResponse users() {
    return new UsersResponse(auth.list().stream().map(u -> new UserItem(u.getId(), u.getName())).toList());
  }

  /** 서버 상태는 바뀌지 않는다 — 아이디가 있는지 확인하고 표시 이름을 돌려줄 뿐. 로컬 저장본을 비우는 일은 프런트가 한다. */
  @PostMapping("/api/auth/login")
  public LoginResponse login(@RequestBody(required = false) LoginRequest body) {
    String id = body == null ? null : body.userId();
    if (id == null || id.isBlank()) throw ApiException.badRequest("userId required");
    if (!AppUser.isValidId(id)) throw ApiException.badRequest("userId must match ^[a-z][a-z0-9_]{1,23}$");
    AppUser u = auth.find(id).orElseThrow(() -> ApiException.notFound("user not found"));
    return new LoginResponse(u.getId(), u.getName());
  }

  @GetMapping("/api/me")
  public MeResponse me(@CurrentUser AppUser me) {
    return new MeResponse(me.getId(), me.getName(), me.getCreatedAt());
  }
}
