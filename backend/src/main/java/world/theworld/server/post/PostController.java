package world.theworld.server.post;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.post.PostDtos.Feed;
import world.theworld.server.post.PostDtos.Likes;
import world.theworld.server.post.PostDtos.Post;
import world.theworld.server.post.PostDtos.PostIn;
import world.theworld.server.post.PostDtos.PostPatch;
import world.theworld.server.post.PostDtos.Posts;

/** 글·좋아요·글 격자·피드 (CONTRACT §2.5). authorId는 헤더의 나 — 본문의 값은 받지 않는다. */
@RestController
public class PostController {
  private final PostService posts;
  private final FeedService feed;

  public PostController(PostService posts, FeedService feed) {
    this.posts = posts;
    this.feed = feed;
  }

  @PostMapping("/api/posts")
  public ResponseEntity<Post> create(@CurrentUser AppUser me, @RequestBody(required = false) PostIn body) {
    return ResponseEntity.status(201).body(posts.create(me.getId(), body));
  }

  @PatchMapping("/api/posts/{id}")
  public Post patch(@CurrentUser AppUser me, @PathVariable String id, @RequestBody(required = false) PostPatch body) {
    return posts.patch(me.getId(), id, body);
  }

  @DeleteMapping("/api/posts/{id}")
  public ResponseEntity<Void> delete(@CurrentUser AppUser me, @PathVariable String id) {
    posts.delete(me.getId(), id);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/posts/{id}/like")
  public Likes like(@CurrentUser AppUser me, @PathVariable String id) {
    try {
      return posts.like(me.getId(), id, true);
    } catch (DataIntegrityViolationException e) {
      // 같은 사람이 같은 글을 동시에 두 번 눌렀다(두 탭) — existsById와 save 사이에 한쪽이 먼저 넣었으면 PK 위반. 멱등이니 다시 부르면 그대로
      return posts.like(me.getId(), id, true);
    }
  }

  @DeleteMapping("/api/posts/{id}/like")
  public Likes unlike(@CurrentUser AppUser me, @PathVariable String id) {
    return posts.like(me.getId(), id, false);
  }

  @GetMapping("/api/users/{id}/posts")
  public Posts userPosts(@CurrentUser AppUser me, @PathVariable String id, @RequestParam(required = false) String cursor,
                         @RequestParam(required = false) Integer limit) {
    return posts.userPosts(me.getId(), id, cursor, limit);
  }

  @GetMapping("/api/me/posts")
  public Posts myPosts(@CurrentUser AppUser me, @RequestParam(required = false) String cursor, @RequestParam(required = false) Integer limit) {
    return posts.userPosts(me.getId(), me.getId(), cursor, limit);
  }

  @GetMapping("/api/feed")
  public Feed feed(@CurrentUser AppUser me, @RequestParam(required = false) String cursor, @RequestParam(required = false) Integer limit) {
    return feed.feed(me.getId(), cursor, limit);
  }
}
