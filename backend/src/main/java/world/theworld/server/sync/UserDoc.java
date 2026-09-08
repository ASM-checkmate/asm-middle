package world.theworld.server.sync;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * user_doc (BACKEND-CONTRACT §1·§2.2) — 프런트 저장본 하나를 불투명 JSON으로. 필드 검증(validDays 등)은 계속 프런트 부팅 코드가 한다
 * (map2-persist-boot: "서버는 jsonb/text + version + updatedAt만").
 */
@Entity
@Table(name = "user_doc")
public class UserDoc {
  @EmbeddedId
  private UserDocId id;

  /** PUT마다 +1. 클라이언트는 baseVersion으로 자기가 본 버전을 말한다. */
  @Column(name = "version", nullable = false)
  private long version;

  /** 클라이언트가 그 본문을 저장한 시각(ms) — 409 때 어느 쪽이 최신인지 가리는 단서. */
  @Column(name = "client_ts", nullable = false)
  private long clientTs;

  @Column(name = "updated_at", nullable = false)
  private long updatedAt;

  /** text 컬럼 — LONG32VARCHAR가 PostgreSQL 방언에서 "text"다 (H2는 TheworldH2Dialect가 CLOB과 같게 본다). */
  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "body", nullable = false)
  private String body;

  protected UserDoc() {}

  public UserDoc(UserDocId id, long version, long clientTs, long updatedAt, String body) {
    this.id = id;
    this.version = version;
    this.clientTs = clientTs;
    this.updatedAt = updatedAt;
    this.body = body;
  }

  public UserDocId getId() { return id; }
  public String getName() { return id.getName(); }
  public long getVersion() { return version; }
  public long getClientTs() { return clientTs; }
  public long getUpdatedAt() { return updatedAt; }
  public String getBody() { return body; }

  public void replace(long clientTs, long updatedAt, String body) {
    this.version += 1;
    this.clientTs = clientTs;
    this.updatedAt = updatedAt;
    this.body = body;
  }
}
