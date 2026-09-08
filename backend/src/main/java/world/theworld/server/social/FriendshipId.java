package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;

/** friendship 복합키 — user_a < user_b로 정렬해 저장 (BACKEND-CONTRACT §1). {@link #of}로만 만든다. */
@Embeddable
public class FriendshipId implements Serializable {
  @Column(name = "user_a", length = 40, nullable = false)
  private String userA;

  @Column(name = "user_b", length = 40, nullable = false)
  private String userB;

  protected FriendshipId() {}

  private FriendshipId(String userA, String userB) {
    this.userA = userA;
    this.userB = userB;
  }

  /** 순서와 무관하게 같은 키. */
  public static FriendshipId of(String x, String y) {
    return x.compareTo(y) <= 0 ? new FriendshipId(x, y) : new FriendshipId(y, x);
  }

  public String getUserA() { return userA; }
  public String getUserB() { return userB; }

  /** 상대 쪽 id. */
  public String other(String me) { return me.equals(userA) ? userB : userA; }

  @Override
  public boolean equals(Object o) {
    return o instanceof FriendshipId other && userA.equals(other.userA) && userB.equals(other.userB);
  }

  @Override
  public int hashCode() { return Objects.hash(userA, userB); }
}
