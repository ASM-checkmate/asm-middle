package world.theworld.server.post;

import org.springframework.stereotype.Component;
import world.theworld.server.media.MediaAccess;
import world.theworld.server.social.AgentProfile;

/**
 * GET /api/media/{id}의 세 번째 열쇠 (§2.5) — 공개 계정의 글이 그 컷을 참조하면 누구나 받는다.
 * cuts_json을 {@code LIKE '%"shotId":"<id>"%'}로 훑는다 — 글 표를 다 읽는 셈이지만 글이 수천 편이 되기 전엔 충분하고, 그때 post_cut 표로
 * 뽑아내면 된다. id는 {@link world.theworld.server.media.MediaService#ID}(32 hex)를 이미 통과한 값이라 LIKE 와일드카드가 섞일 수 없다.
 */
@Component
public class PostMediaAccess implements MediaAccess {
  private final PostRepository posts;

  public PostMediaAccess(PostRepository posts) { this.posts = posts; }

  @Override
  public boolean grantsPublic(String mediaId) {
    return posts.countPublicReferencing(AgentProfile.VISIBILITY_PUBLIC, "%\"shotId\":\"" + mediaId + "\"%") > 0;
  }
}
