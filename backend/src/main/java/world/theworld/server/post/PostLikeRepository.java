package world.theworld.server.post;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostLikeRepository extends JpaRepository<PostLike, PostLikeId> {
  /** 응답의 likedByMe를 한 번에 — ids 중 내가 누른 것. */
  @Query("select l.id.postId from PostLike l where l.id.userId = :me and l.id.postId in :ids")
  List<String> likedAmong(@Param("me") String me, @Param("ids") Collection<String> ids);

  /** 취소 한 번 — 지운 행 수(0|1)를 돌려줘 카운터를 그만큼만 내린다. 같은 사람이 동시에 두 번 취소해도 한쪽은 0이라 두 번 내려가지 않는다. */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("delete from PostLike l where l.id.postId = :postId and l.id.userId = :userId")
  int deleteOne(@Param("postId") String postId, @Param("userId") String userId);

  /** 글을 지울 때 좋아요 행도 같이 (§2.5 DELETE /api/posts/{id}). */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("delete from PostLike l where l.id.postId = :postId")
  int deleteByPost(@Param("postId") String postId);
}
