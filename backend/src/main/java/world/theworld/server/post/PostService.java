package world.theworld.server.post;

import static world.theworld.server.social.SocialService.optStr;
import static world.theworld.server.social.SocialService.str;
import static world.theworld.server.social.SocialService.strOrEmpty;
import static world.theworld.server.social.SocialService.strings;

import com.fasterxml.jackson.core.type.TypeReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.Json;
import world.theworld.server.media.MediaRepository;
import world.theworld.server.media.MediaService;
import world.theworld.server.post.PostDtos.Likes;
import world.theworld.server.post.PostDtos.PostCut;
import world.theworld.server.post.PostDtos.PostIn;
import world.theworld.server.post.PostDtos.PostPatch;
import world.theworld.server.post.PostDtos.Posts;
import world.theworld.server.social.AgentProfile;
import world.theworld.server.social.AgentProfileRepository;
import world.theworld.server.social.Friendship;
import world.theworld.server.social.FriendshipId;
import world.theworld.server.social.FriendshipRepository;

/**
 * 글·좋아요·글 격자 (CONTRACT §2.5, ADR-0021). 서버가 지키는 것: authorId는 늘 요청자, 컷은 전부 내 미디어, 동행은 내 친구와의 교집합,
 * 비공개 계정의 글은 친구만. 추천은 {@link FeedService}.
 */
@Service
public class PostService {
  public static final int MAX_CUTS = 10;
  public static final int MAX_CAPTION = 300;
  public static final int MAX_FACET = 120;
  public static final int DEFAULT_LIMIT = 20;
  public static final int MAX_LIMIT = 50;
  static final Set<String> CUT_BY = Set.of("user", "agent");
  static final TypeReference<List<PostCut>> CUTS = new TypeReference<>() {};

  private final PostRepository posts;
  private final PostLikeRepository likes;
  private final MediaRepository media;
  private final AgentProfileRepository profiles;
  private final FriendshipRepository friendships;
  private final Json json;

  public PostService(PostRepository posts, PostLikeRepository likes, MediaRepository media, AgentProfileRepository profiles,
                     FriendshipRepository friendships, Json json) {
    this.posts = posts;
    this.likes = likes;
    this.media = media;
    this.profiles = profiles;
    this.friendships = friendships;
    this.json = json;
  }

  // ── 검증 ──

  static int limit(Integer limit) {
    if (limit == null) return DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) throw ApiException.badRequest("limit must be 1-" + MAX_LIMIT);
    return limit;
  }

  /** cuts 1~10, 각 컷은 내 미디어(모양이 틀려도 'cut not yours' — 남의 것과 구별해 줄 이유가 없다), win 0~3, by user|agent. */
  List<PostCut> cuts(String me, List<PostCut> in) {
    if (in == null || in.isEmpty() || in.size() > MAX_CUTS) throw ApiException.badRequest("cuts must have 1-" + MAX_CUTS + " items");
    List<PostCut> out = new ArrayList<>(in.size());
    for (PostCut c : in) {
      if (c == null) throw ApiException.badRequest("cut must be an object");
      String shotId = c.shotId();
      if (shotId == null || !MediaService.ID.matcher(shotId).matches() || !media.existsByIdAndOwnerId(shotId, me)) {
        throw ApiException.badRequest("cut not yours");
      }
      if (c.win() == null || c.win() < 0 || c.win() > 3) throw ApiException.badRequest("cut.win must be 0-3");
      if (c.by() == null || !CUT_BY.contains(c.by())) throw ApiException.badRequest("cut.by must be user|agent");
      out.add(new PostCut(shotId, str(c.actKey(), 120, "cut.actKey"), c.win(), c.by()));
    }
    return out;
  }

  Set<String> friendIds(String me) {
    Set<String> out = new HashSet<>();
    for (Friendship f : friendships.findAllOf(me)) out.add(f.getId().other(me));
    return out;
  }

  /** 글을 볼 수 있나 — 나·공개 계정·친구. 프로필이 없으면 비공개로 친다(기본값과 같다). */
  boolean canView(String me, String authorId) {
    if (authorId.equals(me)) return true;
    boolean isPublic = profiles.findById(authorId).map(p -> AgentProfile.VISIBILITY_PUBLIC.equals(p.getVisibility())).orElse(false);
    return isPublic || friendships.existsById(FriendshipId.of(me, authorId));
  }

  Post find(String id) {
    return posts.findById(id).orElseThrow(ApiException::notFound);
  }

  Post mine(String me, String id) {
    Post p = find(id);
    if (!p.getAuthorId().equals(me)) throw ApiException.forbidden("not yours");
    return p;
  }

  // ── 변환 ──

  PostDtos.Post toDto(Post p, boolean likedByMe) {
    return new PostDtos.Post(p.getId(), p.getAuthorId(), p.getCreatedAt(), json.readList(p.getCutsJson(), CUTS), p.getCaption(), p.getPlace(), p.getArea(),
      p.getCity(), p.getCategory(), p.getDateKey(), json.readStrings(p.getCompanionsJson()), p.isEditedByOwner(), p.getLikes(), likedByMe);
  }

  /** 여러 글의 likedByMe를 한 쿼리로. */
  List<PostDtos.Post> toDtos(String me, List<Post> rows) {
    if (rows.isEmpty()) return List.of();
    Set<String> liked = new HashSet<>(likes.likedAmong(me, rows.stream().map(Post::getId).toList()));
    return rows.stream().map(p -> toDto(p, liked.contains(p.getId()))).toList();
  }

  // ── §2.5 POST /api/posts ──

  @Transactional
  public PostDtos.Post create(String me, PostIn req) {
    if (req == null) throw ApiException.badRequest("body required");
    List<PostCut> cuts = cuts(me, req.cuts());
    String caption = strOrEmpty(req.caption(), MAX_CAPTION, "caption");
    String place = str(req.place(), MAX_FACET, "place");
    String area = str(req.area(), MAX_FACET, "area");
    String city = str(req.city(), MAX_FACET, "city");
    String category = optStr(req.category(), 12, "category");
    if (category != null && category.isEmpty()) category = null;
    String dateKey = str(req.dateKey(), MAX_FACET, "dateKey");
    // 동행은 내 친구와의 교집합만 — 같은 공간에 있었을 뿐인 사람·모르는 id는 조용히 뺀다 (SNS_SPEC §3)
    Set<String> friends = friendIds(me);
    List<String> companions = strings(req.companions(), 16, 80, "companions").stream().filter(friends::contains).distinct().toList();
    boolean edited = Boolean.TRUE.equals(req.editedByOwner());
    Post p = new Post(UUID.randomUUID().toString().replace("-", ""), me, System.currentTimeMillis(), json.write(cuts), caption, place, area, city,
      category, dateKey, json.write(companions), edited, 0);
    return toDto(posts.save(p), false);
  }

  // ── §2.5 PATCH /api/posts/{id} ──

  @Transactional
  public PostDtos.Post patch(String me, String id, PostPatch req) {
    if (req == null) throw ApiException.badRequest("body required");
    Post p = mine(me, id);
    String cutsJson = req.cuts() == null ? null : json.write(cuts(me, req.cuts()));
    String caption = optStr(req.caption(), MAX_CAPTION, "caption");
    p.edit(cutsJson, caption);
    return toDto(posts.save(p), likes.existsById(new PostLikeId(id, me)));
  }

  // ── §2.5 DELETE /api/posts/{id} ──

  /** 좋아요 행도 같이. 미디어는 남긴다 — "책이 참조하지 않는 것만 지운다"는 책 문서를 열어 봐야 알 수 있어 이 단계 밖(ADR-0020 결정 4). */
  @Transactional
  public void delete(String me, String id) {
    mine(me, id);
    likes.deleteByPost(id);
    posts.deleteById(id);
  }

  // ── §2.5 POST/DELETE /api/posts/{id}/like ──

  /**
   * 멱등. 카운터는 행 값에 더해(bumpLikes) 같은 트랜잭션에서 맞춘다 — 누르기는 INSERT가 PK로 한 번만 성공하고(동시면 컨트롤러가 재시도),
   * 취소는 실제로 지운 행 수만큼만 내린다(동시 취소가 두 번 내리지 않게). 비공개 계정의 글은 친구만 (403 'not allowed').
   */
  @Transactional
  public Likes like(String me, String id, boolean on) {
    Post p = find(id);
    if (!canView(me, p.getAuthorId())) throw ApiException.forbidden("not allowed");
    PostLikeId key = new PostLikeId(id, me);
    if (on) {
      if (!likes.existsById(key)) {
        likes.save(new PostLike(key, System.currentTimeMillis()));
        posts.bumpLikes(id, 1);
      }
    } else if (likes.deleteOne(id, me) == 1) {
      posts.bumpLikes(id, -1);
    }
    long n = posts.findById(id).map(Post::getLikes).orElse(0L);   // bumpLikes가 컨텍스트를 비워 새로 읽는다
    return new Likes(Math.max(0, n), on);
  }

  // ── §2.5 GET /api/users/{id}/posts · GET /api/me/posts ──

  @Transactional(readOnly = true)
  public Posts userPosts(String me, String userId, String rawCursor, Integer rawLimit) {
    if (!canView(me, userId)) throw ApiException.forbidden("not allowed");
    int limit = limit(rawLimit);
    Cursor cursor = Cursor.decode(rawCursor, Cursor.USER, "u");
    List<Post> rows = posts.findByAuthor(userId, Offset.of(cursor.offset(), limit + 1));   // 하나 더 읽어 다음 장이 있는지 본다
    boolean more = rows.size() > limit;
    List<Post> page = more ? rows.subList(0, limit) : rows;
    return new Posts(toDtos(me, page), more ? new Cursor(Cursor.USER, cursor.offset() + limit).encode() : null);
  }
}
