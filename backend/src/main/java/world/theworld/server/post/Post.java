package world.theworld.server.post;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

/**
 * post (CONTRACT §2.5, ADR-0021) — 글 한 편. 컷은 id 목록(cuts_json)일 뿐 픽셀은 media에 있다. place·area·city·category·date_key는
 * 추천·검색용 면, likes는 post_like 행 수의 비정규화 사본. id는 서버가 만든 32자 hex라 {@link Persistable#isNew}로 "방금 만든 객체"를
 * 알려 save가 merge(SELECT 뒤 UPDATE)가 아니라 persist(INSERT)를 하게 한다. edited_by_owner는 bigint 0/1(V1에 불리언 컬럼이 없다).
 */
@Entity
@Table(name = "post")
public class Post implements Persistable<String> {
  @Id
  @Column(name = "id", length = 32, nullable = false)
  private String id;

  @Column(name = "author_id", length = 40, nullable = false)
  private String authorId;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  /** PostCut[] — {@code [{"shotId","actKey","win","by"}]}. 공개 글 참조 검사({@link PostMediaAccess})가 이 문자열을 LIKE로 훑는다. */
  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "cuts_json", nullable = false)
  private String cutsJson;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "caption", nullable = false)
  private String caption;

  @Column(name = "place", length = 120, nullable = false)
  private String place;

  @Column(name = "area", length = 120, nullable = false)
  private String area;

  @Column(name = "city", length = 120, nullable = false)
  private String city;

  @Column(name = "category", length = 12)
  private String category;

  @Column(name = "date_key", length = 120, nullable = false)
  private String dateKey;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "companions_json", nullable = false)
  private String companionsJson;

  /** 0 | 1 */
  @Column(name = "edited_by_owner", nullable = false)
  private long editedByOwner;

  @Column(name = "likes", nullable = false)
  private long likes;

  @Transient
  private boolean fresh = true;

  protected Post() {}

  public Post(String id, String authorId, long createdAt, String cutsJson, String caption, String place, String area, String city, String category,
              String dateKey, String companionsJson, boolean editedByOwner, long likes) {
    this.id = id;
    this.authorId = authorId;
    this.createdAt = createdAt;
    this.cutsJson = cutsJson;
    this.caption = caption;
    this.place = place;
    this.area = area;
    this.city = city;
    this.category = category;
    this.dateKey = dateKey;
    this.companionsJson = companionsJson;
    this.editedByOwner = editedByOwner ? 1 : 0;
    this.likes = likes;
  }

  @Override public String getId() { return id; }
  @Override public boolean isNew() { return fresh; }

  @PostLoad
  @PostPersist
  void stored() { fresh = false; }

  public String getAuthorId() { return authorId; }
  public long getCreatedAt() { return createdAt; }
  public String getCutsJson() { return cutsJson; }
  public String getCaption() { return caption; }
  public String getPlace() { return place; }
  public String getArea() { return area; }
  public String getCity() { return city; }
  public String getCategory() { return category; }
  public String getDateKey() { return dateKey; }
  public String getCompanionsJson() { return companionsJson; }
  public boolean isEditedByOwner() { return editedByOwner != 0; }
  public long getLikes() { return likes; }

  /** PATCH (§2.5): 컷·캡션 중 온 것만 바꾸고 주인이 고쳤다고 표시한다. */
  public void edit(String cutsJson, String caption) {
    if (cutsJson != null) this.cutsJson = cutsJson;
    if (caption != null) this.caption = caption;
    this.editedByOwner = 1;
  }
}
