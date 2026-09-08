package world.theworld.server.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.regex.Pattern;

/**
 * app_user (BACKEND-CONTRACT §1, 2026-09-08 오후 개정) — 고정 아이디 계정. 토큰도 비밀번호도 없고, 행은 V2__seed_users.sql의 다섯이 전부다.
 * 아이디 하나 = 에이전트 하나 = 서버 문서 한 벌.
 */
@Entity
@Table(name = "app_user")
public class AppUser {
  /** 아이디 모양 (AUTH-ADDENDUM) — 소문자로 시작, 2~24자. NPC id와 겹치지 않는 것은 시드가 책임진다. */
  public static final Pattern ID = Pattern.compile("^[a-z][a-z0-9_]{1,23}$");

  public static boolean isValidId(String id) {
    return id != null && ID.matcher(id).matches();
  }

  @Id
  @Column(name = "id", length = 24, nullable = false)
  private String id;

  @Column(name = "display_name", length = 40, nullable = false)
  private String name;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  @Column(name = "last_seen_at", nullable = false)
  private long lastSeenAt;

  protected AppUser() {}

  public AppUser(String id, String name, long now) {
    this.id = id;
    this.name = name;
    this.createdAt = now;
    this.lastSeenAt = now;
  }

  public String getId() { return id; }
  public String getName() { return name; }
  public long getCreatedAt() { return createdAt; }
  public long getLastSeenAt() { return lastSeenAt; }

  /** 요청이 왔다 — 마지막으로 본 시각. 갱신 간격은 {@link AuthService#authenticate}가 정한다. */
  public void seen(long now) {
    this.lastSeenAt = now;
  }
}
