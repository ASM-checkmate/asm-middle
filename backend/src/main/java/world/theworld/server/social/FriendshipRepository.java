package world.theworld.server.social;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FriendshipRepository extends JpaRepository<Friendship, FriendshipId> {
  @Query("select f from Friendship f where f.id.userA = :me or f.id.userB = :me")
  List<Friendship> findAllOf(@Param("me") String me);
}
