package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * agent_profile (BACKEND-CONTRACT §1·§2.3) — 진짜 사람 에이전트의 프로필. 화면·talkChance가 쓰는 8필드(map2-social "Agent 타입")를
 * 그대로 보관하고, likes/traits/home은 JSON 문자열로.
 */
@Entity
@Table(name = "agent_profile")
public class AgentProfile {
  @Id
  @Column(name = "user_id", length = 40, nullable = false)
  private String userId;

  @Column(name = "name", length = 40, nullable = false)
  private String name;

  @Column(name = "color", length = 16, nullable = false)
  private String color;

  @Column(name = "emoji", length = 8, nullable = false)
  private String emoji;

  @Column(name = "hair_style", length = 24)
  private String hairStyle;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "likes_json", nullable = false)
  private String likesJson;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "traits_json", nullable = false)
  private String traitsJson;

  /** RemotePlace(type 'friend_home', ownerFriendId = userId, id = home:<userId>) */
  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "home_json", nullable = false)
  private String homeJson;

  @Column(name = "home_place_id", length = 80, nullable = false)
  private String homePlaceId;

  @Column(name = "updated_at", nullable = false)
  private long updatedAt;

  protected AgentProfile() {}

  public AgentProfile(String userId) { this.userId = userId; }

  public String getUserId() { return userId; }
  public String getName() { return name; }
  public String getColor() { return color; }
  public String getEmoji() { return emoji; }
  public String getHairStyle() { return hairStyle; }
  public String getLikesJson() { return likesJson; }
  public String getTraitsJson() { return traitsJson; }
  public String getHomeJson() { return homeJson; }
  public String getHomePlaceId() { return homePlaceId; }
  public long getUpdatedAt() { return updatedAt; }

  public void update(String name, String color, String emoji, String hairStyle, String likesJson, String traitsJson, String homeJson, String homePlaceId, long now) {
    this.name = name;
    this.color = color;
    this.emoji = emoji;
    this.hairStyle = hairStyle;
    this.likesJson = likesJson;
    this.traitsJson = traitsJson;
    this.homeJson = homeJson;
    this.homePlaceId = homePlaceId;
    this.updatedAt = now;
  }
}
