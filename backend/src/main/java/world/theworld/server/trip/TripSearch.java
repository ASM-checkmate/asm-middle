package world.theworld.server.trip;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** trip_search (BACKEND-CONTRACT §1) — 검색 결과 캐시. 검색만 성공해도 남겨 뒤 단계(모델·지오코딩)가 실패해도 검색 한도를 지킨다. body는 검색어별 SearchHit[][] JSON. */
@Entity
@Table(name = "trip_search")
public class TripSearch {
  @Id
  @Column(name = "norm", length = 80, nullable = false)
  private String norm;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "body", nullable = false)
  private String body;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  protected TripSearch() {}

  public TripSearch(String norm, String body, long createdAt) {
    this.norm = norm;
    this.body = body;
    this.createdAt = createdAt;
  }

  public String getNorm() { return norm; }
  public String getBody() { return body; }
  public long getCreatedAt() { return createdAt; }
}
