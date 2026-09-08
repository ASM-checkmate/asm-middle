package world.theworld.server.social;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PublishedActivityRepository extends JpaRepository<PublishedActivity, PublishedActivityId> {
  /** 창 교체 (§2.3 PUT /api/me/schedule): arrive_at ∈ [from, to) 행을 지운다. */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("delete from PublishedActivity p where p.id.userId = :userId and p.arriveAt >= :from and p.arriveAt < :to")
  int deleteWindow(@Param("userId") String userId, @Param("from") long from, @Param("to") long to);

  /** 같은 key가 창 밖(시간이 옮겨진 활동)에 남아 있으면 PK가 겹치므로 받은 key들도 지운다. */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("delete from PublishedActivity p where p.id.userId = :userId and p.id.actKey in :keys")
  int deleteKeys(@Param("userId") String userId, @Param("keys") Collection<String> keys);

  /** 마주침 후보 (§2.3 POST /api/agents/at): 같은 장소, [from,to)와 겹치는 것, 자기 자신 제외. 30분 규칙은 서비스가 잰다. */
  @Query("select p from PublishedActivity p where p.placeId = :placeId and p.arriveAt < :to and p.endAt > :from and p.id.userId <> :me order by p.id.userId, p.arriveAt")
  List<PublishedActivity> findOverlapping(@Param("placeId") String placeId, @Param("from") long from, @Param("to") long to, @Param("me") String me);

  /** `now` (§2.3 GET /api/friends?at): arriveAt <= at < endAt. */
  @Query("select p from PublishedActivity p where p.id.userId in :userIds and p.arriveAt <= :at and p.endAt > :at order by p.arriveAt")
  List<PublishedActivity> findNow(@Param("userIds") Collection<String> userIds, @Param("at") long at);

  /** 친구의 하루 (§2.3 GET /api/friends/{id}/day): 창과 겹치는 활동을 시간순으로. */
  @Query("select p from PublishedActivity p where p.id.userId = :userId and p.arriveAt < :to and p.endAt > :from order by p.arriveAt, p.id.actKey")
  List<PublishedActivity> findDay(@Param("userId") String userId, @Param("from") long from, @Param("to") long to);
}
