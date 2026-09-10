package world.theworld.server.post;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;

/** post_like 복합키 (post_id, user_id) — 한 사람이 한 글에 한 번. */
@Embeddable
public class PostLikeId implements Serializable {
  @Column(name = "post_id", length = 32, nullable = false)
  private String postId;

  @Column(name = "user_id", length = 40, nullable = false)
  private String userId;

  protected PostLikeId() {}

  public PostLikeId(String postId, String userId) {
    this.postId = postId;
    this.userId = userId;
  }

  public String getPostId() { return postId; }
  public String getUserId() { return userId; }

  @Override
  public boolean equals(Object o) {
    return o instanceof PostLikeId other && postId.equals(other.postId) && userId.equals(other.userId);
  }

  @Override
  public int hashCode() { return Objects.hash(postId, userId); }
}
