package world.theworld.server.trip;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** trip_pack (BACKEND-CONTRACT §1) — 도시 팩 캐시, 모든 사용자 공유. alias = normCity(요청명) | normCity(nameKo) | key. body는 TripPlanResponse JSON. */
@Entity
@Table(name = "trip_pack")
public class TripPack {
  @Id
  @Column(name = "alias", length = 80, nullable = false)
  private String alias;

  @Column(name = "city_key", length = 40, nullable = false)
  private String cityKey;

  @JdbcTypeCode(SqlTypes.LONG32VARCHAR)
  @Column(name = "body", nullable = false)
  private String body;

  @Column(name = "created_at", nullable = false)
  private long createdAt;

  protected TripPack() {}

  public TripPack(String alias, String cityKey, String body, long createdAt) {
    this.alias = alias;
    this.cityKey = cityKey;
    this.body = body;
    this.createdAt = createdAt;
  }

  public String getAlias() { return alias; }
  public String getCityKey() { return cityKey; }
  public String getBody() { return body; }
  public long getCreatedAt() { return createdAt; }
}
