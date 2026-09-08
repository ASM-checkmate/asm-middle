package world.theworld.server.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 아이디 → 사용자 (BACKEND-CONTRACT §2.1, 2026-09-08 오후 개정). 세션·토큰·비밀번호가 없으므로 할 일은 "있는 아이디인가"와
 * last_seen 갱신뿐이다. 갱신은 요청마다가 아니라 1분에 한 번만 UPDATE — 더티 체크라 안 바뀌면 쓰지도 않는다.
 */
@Service
public class AuthService {
  /** last_seen_at을 다시 쓰기까지의 최소 간격 (AUTH-ADDENDUM "최대 1분에 한 번만"). */
  public static final long TOUCH_INTERVAL_MS = 60_000L;

  private final AppUserRepository users;

  public AuthService(AppUserRepository users) { this.users = users; }

  /** GET /api/users — id 순. */
  @Transactional(readOnly = true)
  public List<AppUser> list() {
    return users.findAll(Sort.by("id"));
  }

  /** 모양이 틀린 아이디는 DB에 묻지 않고 없는 것으로 친다. */
  @Transactional(readOnly = true)
  public Optional<AppUser> find(String id) {
    return AppUser.isValidId(id) ? users.findById(id) : Optional.empty();
  }

  /** 인증 필터용: 있으면 last_seen을 갱신해 돌려준다 (1분 스로틀). 없거나 모양이 틀리면 empty → 401. */
  @Transactional
  public Optional<AppUser> authenticate(String id) {
    if (!AppUser.isValidId(id)) return Optional.empty();
    Optional<AppUser> user = users.findById(id);
    user.ifPresent(u -> {
      long now = System.currentTimeMillis();
      if (now - u.getLastSeenAt() >= TOUCH_INTERVAL_MS) u.seen(now);
    });
    return user;
  }

  @Transactional(readOnly = true)
  public boolean exists(String userId) {
    return userId != null && users.existsById(userId);
  }
}
