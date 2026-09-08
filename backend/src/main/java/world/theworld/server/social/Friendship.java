package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** friendship (BACKEND-CONTRACT §1·§2.3) — 대칭·멱등. met_*는 처음 말을 튼 마주침(FRIENDS_SPEC §4 "활동이 끝나면 friends에 추가"). */
@Entity
@Table(name = "friendship")
public class Friendship {
  @EmbeddedId
  private FriendshipId id;

  @Column(name = "met_at")
  private Long metAt;

  @Column(name = "met_place_id", length = 80)
  private String metPlaceId;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  protected Friendship() {}

  public Friendship(FriendshipId id, Long metAt, String metPlaceId, long createdAt) {
    this.id = id;
    this.metAt = metAt;
    this.metPlaceId = metPlaceId;
    this.createdAt = createdAt;
  }

  public FriendshipId getId() { return id; }
  public Long getMetAt() { return metAt; }
  public String getMetPlaceId() { return metPlaceId; }
  public long getCreatedAt() { return createdAt; }
}
