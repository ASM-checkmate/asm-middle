package world.theworld.server.post;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import world.theworld.server.social.SocialDtos.RemoteAgent;

/**
 * §2.5 JSON 모양 — 필드명은 계약 타입(PostCut·Post·FeedItem)과 글자 그대로. TS의 `?`(category·why)는 없을 때 키를 빼고(NON_NULL),
 * `| null`로 적힌 next는 null을 그대로 낸다. author는 RemoteAgent 그대로 — visibility(항상)·repShotId(있을 때)를 이미 싣는다.
 */
public final class PostDtos {
  private PostDtos() {}

  /** 요청·응답·cuts_json 저장 모양이 하나다. 요청에선 boxed라 빠진 칸을 400 한 줄로 알린다. */
  public record PostCut(String shotId, String actKey, Integer win, String by) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Post(String id, String authorId, long createdAt, List<PostCut> cuts, String caption, String place, String area, String city,
                     String category, String dateKey, List<String> companions, boolean editedByOwner, long likes, boolean likedByMe) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record FeedItem(Post post, RemoteAgent author, String why) {}

  /** GET /api/feed */
  public record Feed(List<FeedItem> items, String next) {}

  /** GET /api/users/{id}/posts · GET /api/me/posts */
  public record Posts(List<Post> items, String next) {}

  /** POST/DELETE /api/posts/{id}/like */
  public record Likes(long likes, boolean likedByMe) {}

  // ── 요청 ──
  public record PostIn(List<PostCut> cuts, String caption, String place, String area, String city, String category, String dateKey,
                       List<String> companions, Boolean editedByOwner) {}
  public record PostPatch(List<PostCut> cuts, String caption) {}
}
