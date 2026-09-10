package world.theworld.server.post;

import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostRepository extends JpaRepository<Post, String> {
  /** 한 사람의 글 격자 (§2.5 GET /api/users/{id}/posts) — 최신순, 동률은 id 내림차순. Pageable은 {@link Offset}. */
  @Query("select p from Post p where p.authorId = :author order by p.createdAt desc, p.id desc")
  List<Post> findByAuthor(@Param("author") String author, Pageable page);

  /** 피드 친구 구간 (§2.5 GET /api/feed 'f') — 여러 사람의 글을 한 줄기로 최신순. */
  @Query("select p from Post p where p.authorId in :authors order by p.createdAt desc, p.id desc")
  List<Post> findByAuthors(@Param("authors") Collection<String> authors, Pageable page);

  /**
   * 추천 후보 (§2.5 GET /api/feed 'r'): 공개 계정의 글 중 excluded(나 + 내 친구)가 쓴 것과 내가 좋아요한 글을 뺀 최신 N개.
   * excluded에는 늘 내 id가 있어 빈 목록이 아니다.
   */
  @Query("select p from Post p, AgentProfile a where a.userId = p.authorId and a.visibility = :pub and p.authorId not in :excluded"
    + " and p.id not in (select l.id.postId from PostLike l where l.id.userId = :me) order by p.createdAt desc, p.id desc")
  List<Post> findCandidates(@Param("me") String me, @Param("pub") String pub, @Param("excluded") Collection<String> excluded, Pageable page);

  /** 내가 좋아요한 글 — 취향 히스토그램 재료(FeedService). 최근에 누른 순. */
  @Query("select p from Post p, PostLike l where l.id.postId = p.id and l.id.userId = :me order by l.createdAt desc, p.id desc")
  List<Post> findLikedBy(@Param("me") String me, Pageable page);

  /**
   * 공개 계정의 글이 그 컷을 참조하는가 ({@link PostMediaAccess}). pattern은 {@code %"shotId":"<id>"%}.
   * 네이티브 — Hibernate가 text(LONG32VARCHAR) 컬럼엔 JPQL LIKE를 안 열어 준다. H2(CLOB)·PostgreSQL(text) 둘 다 LIKE가 된다.
   */
  @Query(value = "select count(*) from post p join agent_profile a on a.user_id = p.author_id where a.visibility = :pub and p.cuts_json like :pattern",
    nativeQuery = true)
  long countPublicReferencing(@Param("pub") String pub, @Param("pattern") String pattern);

  /** 비정규화 likes 카운터 — 행 값에 더하므로 동시 좋아요가 서로를 덮지 않는다. */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("update Post p set p.likes = p.likes + :delta where p.id = :id")
  int bumpLikes(@Param("id") String id, @Param("delta") long delta);
}
