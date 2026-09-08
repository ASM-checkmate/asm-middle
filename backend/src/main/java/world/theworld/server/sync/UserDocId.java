package world.theworld.server.sync;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;

/** user_doc 복합키 (user_id, name). */
@Embeddable
public class UserDocId implements Serializable {
  @Column(name = "user_id", length = 40, nullable = false)
  private String userId;

  @Column(name = "name", length = 16, nullable = false)
  private String name;

  protected UserDocId() {}

  public UserDocId(String userId, String name) {
    this.userId = userId;
    this.name = name;
  }

  public String getUserId() { return userId; }
  public String getName() { return name; }

  @Override
  public boolean equals(Object o) {
    return o instanceof UserDocId other && userId.equals(other.userId) && name.equals(other.name);
  }

  @Override
  public int hashCode() { return Objects.hash(userId, name); }
}
