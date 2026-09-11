package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Optional;
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

  // ── §2.5 SNS 칸 (V3) ──

  /** female | male | null — 서버는 검증만 하고 추정하지 않는다 (ADR-0027). */
  @Column(name = "gender", length = 8)
  private String gender;

  /** public | private. 기본 private (ADR-0025 결정 7). */
  @Column(name = "visibility", length = 8, nullable = false)
  private String visibility = VISIBILITY_PRIVATE;

  /** 대표컷 핀 — 내 media.id, 없으면 null. */
  @Column(name = "rep_shot_id", length = 32)
  private String repShotId;

  public static final String VISIBILITY_PRIVATE = "private";
  public static final String VISIBILITY_PUBLIC = "public";

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
  public String getGender() { return gender; }
  public String getVisibility() { return visibility; }
  public String getRepShotId() { return repShotId; }

  /**
   * SNS 세 칸은 요청에서 빠지면(null) 이전 값을 지킨다 — 이 칸을 모르는 클라이언트(부팅·메모리 갱신마다 올리는 publishProfile)가 공개 여부·성별·핀을
   * 되돌리지 않게. gender·repShotId는 명시적 null(Optional.empty)로만 지운다; visibility는 지울 수 없다.
   */
  public void update(String name, String color, String emoji, String hairStyle, String likesJson, String traitsJson, String homeJson, String homePlaceId,
                     Optional<String> gender, String visibility, Optional<String> repShotId, long now) {
    this.name = name;
    this.color = color;
    this.emoji = emoji;
    this.hairStyle = hairStyle;
    this.likesJson = likesJson;
    this.traitsJson = traitsJson;
    this.homeJson = homeJson;
    this.homePlaceId = homePlaceId;
    if (gender != null) this.gender = gender.orElse(null);
    if (visibility != null) this.visibility = visibility;
    if (repShotId != null) this.repShotId = repShotId.orElse(null);
    this.updatedAt = now;
  }
}
