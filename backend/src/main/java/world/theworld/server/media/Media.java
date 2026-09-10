package world.theworld.server.media;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

/**
 * media (CONTRACT §2.5, ADR-0020) — 찍는 순간 구운 픽셀의 행. 바이트는 디스크({@code theworld.media.dir/<id>})에 있고 여기엔
 * 소유자·종류·크기만. id는 클라이언트가 만든 32자 hex라 서버가 새 행인지 알 수 없다 — {@link Persistable#isNew}로 "방금 만든 객체"를
 * 알려 save가 merge(SELECT 뒤 UPDATE)가 아니라 persist(INSERT)를 하게 한다. 같은 id를 두 요청이 동시에 올리면 한쪽이 PK 위반으로
 * 깨지고 컨트롤러가 한 번 더 시도한다 — 남의 행을 UPDATE로 덮는 창이 없고, 파일은 INSERT가 통과한 뒤에만 쓰므로 바이트도 덮이지 않는다.
 */
@Entity
@Table(name = "media")
public class Media implements Persistable<String> {
  @Id
  @Column(name = "id", length = 32, nullable = false)
  private String id;

  @Column(name = "owner_id", length = 40, nullable = false)
  private String ownerId;

  /** shot | sketch | npc */
  @Column(name = "kind", length = 8, nullable = false)
  private String kind;

  /** image/webp | image/png */
  @Column(name = "mime", length = 16, nullable = false)
  private String mime;

  @Column(name = "bytes", nullable = false)
  private long bytes;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  @Transient
  private boolean fresh = true;

  protected Media() {}

  public Media(String id, String ownerId, String kind, String mime, long bytes, long createdAt) {
    this.id = id;
    this.ownerId = ownerId;
    this.kind = kind;
    this.mime = mime;
    this.bytes = bytes;
    this.createdAt = createdAt;
  }

  @Override public String getId() { return id; }
  @Override public boolean isNew() { return fresh; }

  @PostLoad
  @PostPersist
  void stored() { fresh = false; }

  public String getOwnerId() { return ownerId; }
  public String getKind() { return kind; }
  public String getMime() { return mime; }
  public long getBytes() { return bytes; }
  public long getCreatedAt() { return createdAt; }
}
