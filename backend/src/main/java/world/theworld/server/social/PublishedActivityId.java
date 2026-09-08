package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;

/** published_activity 복합키 (user_id, act_key). act_key = `${dayKey}:${blockId}` — 프런트 ScheduledActivity.key. */
@Embeddable
public class PublishedActivityId implements Serializable {
  @Column(name = "user_id", length = 40, nullable = false)
  private String userId;

  @Column(name = "act_key", length = 120, nullable = false)
  private String actKey;

  protected PublishedActivityId() {}

  public PublishedActivityId(String userId, String actKey) {
    this.userId = userId;
    this.actKey = actKey;
  }

  public String getUserId() { return userId; }
  public String getActKey() { return actKey; }

  @Override
  public boolean equals(Object o) {
    return o instanceof PublishedActivityId other && userId.equals(other.userId) && actKey.equals(other.actKey);
  }

  @Override
  public int hashCode() { return Objects.hash(userId, actKey); }
}
