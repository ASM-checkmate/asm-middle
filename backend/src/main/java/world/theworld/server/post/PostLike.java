package world.theworld.server.post;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

/**
 * post_like (CONTRACT §2.5) — 좋아요 한 번. 멱등이라 키가 곧 전부다. 할당 키라 {@link Persistable}로 새 행을 직접 말한다 —
 * 같은 사람이 같은 글을 동시에 두 번 누르면 한쪽이 PK 위반으로 깨지고 컨트롤러가 한 번 더 부른다(그땐 이미 있으니 그대로).
 */
@Entity
@Table(name = "post_like")
public class PostLike implements Persistable<PostLikeId> {
  @EmbeddedId
  private PostLikeId id;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  @Transient
  private boolean fresh = true;

  protected PostLike() {}

  public PostLike(PostLikeId id, long createdAt) {
    this.id = id;
    this.createdAt = createdAt;
  }

  @Override public PostLikeId getId() { return id; }
  @Override public boolean isNew() { return fresh; }

  @PostLoad
  @PostPersist
  void stored() { fresh = false; }

  public long getCreatedAt() { return createdAt; }
}
