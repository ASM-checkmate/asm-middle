package world.theworld.server.social;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

/**
 * published_activity (BACKEND-CONTRACT §1·§2.3) — 사용자가 발행한 확정 일정 한 칸. FRIENDS_SPEC §4 "서버가 붙으면 NPC 풀 자리에
 * 실제 사용자 에이전트의 확정 일정이 들어온다"의 그 일정. 마주침 조회(/api/agents/at)는 place_id + [arrive_at, end_at)만 본다.
 * 할당 id라 {@link Persistable}로 "새 행"을 직접 말한다 — 안 그러면 saveAll이 행마다 merge(SELECT 한 번 더)를 하고, 창 교체는
 * 지운 뒤 넣는 것이라 그 SELECT는 늘 빈 결과다 (PUT당 최대 64행).
 */
@Entity
@Table(name = "published_activity")
public class PublishedActivity implements Persistable<PublishedActivityId> {
  @EmbeddedId
  private PublishedActivityId id;

  /** 생성자로 만든 것은 새 행, DB에서 읽었거나 넣은 뒤엔 아니다. */
  @Transient
  private boolean isNew = true;

  @Column(name = "day_key", length = 60, nullable = false)
  private String dayKey;

  @Column(name = "block_id", length = 12, nullable = false)
  private String blockId;

  /** 우회(friction) 반영된 실제 장소 id. */
  @Column(name = "place_id", length = 80, nullable = false)
  private String placeId;

  /** 상대 카탈로그에 없을 수 있어 RemotePlace를 동봉 (없으면 null). */
  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "place_json")
  private String placeJson;

  @Column(name = "category", length = 12, nullable = false)
  private String category;

  @Column(name = "title", length = 120, nullable = false)
  private String title;

  @Column(name = "emoji", length = 8, nullable = false)
  private String emoji;

  @Column(name = "arrive_at", nullable = false)
  private long arriveAt;

  @Column(name = "end_at", nullable = false)
  private long endAt;

  @Column(name = "tz", length = 48, nullable = false)
  private String tz;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "companions_json", nullable = false)
  private String companionsJson;

  @Column(name = "published_at", nullable = false)
  private long publishedAt;

  protected PublishedActivity() {}

  public PublishedActivity(PublishedActivityId id, String dayKey, String blockId, String placeId, String placeJson, String category, String title,
                           String emoji, long arriveAt, long endAt, String tz, String companionsJson, long publishedAt) {
    this.id = id;
    this.dayKey = dayKey;
    this.blockId = blockId;
    this.placeId = placeId;
    this.placeJson = placeJson;
    this.category = category;
    this.title = title;
    this.emoji = emoji;
    this.arriveAt = arriveAt;
    this.endAt = endAt;
    this.tz = tz;
    this.companionsJson = companionsJson;
    this.publishedAt = publishedAt;
  }

  @Override
  public PublishedActivityId getId() { return id; }

  @Override
  public boolean isNew() { return isNew; }

  @PostLoad
  @PostPersist
  void markNotNew() { isNew = false; }

  public String getUserId() { return id.getUserId(); }
  public String getActKey() { return id.getActKey(); }
  public String getDayKey() { return dayKey; }
  public String getBlockId() { return blockId; }
  public String getPlaceId() { return placeId; }
  public String getPlaceJson() { return placeJson; }
  public String getCategory() { return category; }
  public String getTitle() { return title; }
  public String getEmoji() { return emoji; }
  public long getArriveAt() { return arriveAt; }
  public long getEndAt() { return endAt; }
  public String getTz() { return tz; }
  public String getCompanionsJson() { return companionsJson; }
  public long getPublishedAt() { return publishedAt; }
}
