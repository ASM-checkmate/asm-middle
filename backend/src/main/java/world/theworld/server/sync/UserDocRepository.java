package world.theworld.server.sync;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserDocRepository extends JpaRepository<UserDoc, UserDocId> {
  @Query("select d from UserDoc d where d.id.userId = :userId order by d.id.name")
  List<UserDoc> findAllOf(@Param("userId") String userId);

  /** PUT 경로 — 행을 잠그고 버전을 비교한다 (같은 문서에 동시에 두 PUT이 와도 버전이 두 번 +1 되지 않게). */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select d from UserDoc d where d.id = :id")
  Optional<UserDoc> lockById(@Param("id") UserDocId id);
}
