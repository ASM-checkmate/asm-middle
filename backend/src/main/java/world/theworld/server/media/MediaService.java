package world.theworld.server.media;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.BodyLimitFilter;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.media.MediaDtos.Bytes;
import world.theworld.server.media.MediaDtos.Stored;
import world.theworld.server.social.FriendshipId;
import world.theworld.server.social.FriendshipRepository;

/**
 * 미디어 저장소 (CONTRACT §2.5, ADR-0020). 파일은 {@code theworld.media.dir/<id>}, 행은 media 표. 서버는 픽셀을 해석하지 않는다 —
 * 타입·크기·id 모양만 보고 그대로 둔다. 지우는 경로는 없다(ADR-0020 결정 4).
 */
@Service
public class MediaService {
  private static final Logger log = LoggerFactory.getLogger(MediaService.class);
  /** 클라이언트가 만드는 id — 32자 hex (§2.5 "id는 클라이언트가 만든다"). */
  public static final Pattern ID = Pattern.compile("^[0-9a-f]{32}$");
  public static final long MAX_BYTES = BodyLimitFilter.MEDIA_MAX;
  public static final Set<String> KINDS = Set.of("shot", "sketch", "npc");
  /** WebP가 원칙, PNG는 Safari 폴백 (§2.5). */
  public static final Set<String> MIMES = Set.of("image/webp", "image/png");
  public static final String CACHE_CONTROL = "private, max-age=31536000";

  private final MediaRepository media;
  private final FriendshipRepository friendships;
  private final List<MediaAccess> access;
  private final Path dir;

  public MediaService(MediaRepository media, FriendshipRepository friendships, List<MediaAccess> access, TheworldProps props) {
    this.media = media;
    this.friendships = friendships;
    this.access = access;
    this.dir = Path.of(props.media().dir());
  }

  // ── 검증 ──

  static String id(String id) {
    if (id == null || !ID.matcher(id).matches()) throw ApiException.badRequest("id must be 32 hex chars");
    return id;
  }

  static String kind(String kind) {
    if (kind == null) throw ApiException.badRequest("kind required");
    if (!KINDS.contains(kind)) throw ApiException.badRequest("kind must be shot|sketch|npc");
    return kind;
  }

  /** Content-Type 헤더 → 저장할 mime. 파라미터(charset 등)는 버리고 type/subtype만 본다. */
  static String mime(String contentType) {
    if (contentType != null) {
      try {
        MediaType t = MediaType.parseMediaType(contentType);
        String m = t.getType() + "/" + t.getSubtype();
        if (MIMES.contains(m)) return m;
      } catch (InvalidMediaTypeException ignored) { /* 아래 400 */ }
    }
    throw ApiException.badRequest("unsupported image type");
  }

  Path file(String id) { return dir.resolve(id); }

  // ── §2.5 PUT /api/media/{id} ──

  /**
   * 멱등 업로드. 이미 있는 id면 바이트를 버린다 — 내 것이면 기존 행(200), 남의 것이면 403. 새 id면 행을 먼저 넣고(flush로 PK를 잡는다) 파일을 쓴다(201).
   * 순서가 중요하다 — 같은 id가 동시에 오면 진 쪽은 INSERT에서 PK 위반으로 깨져 파일엔 손대지 않으므로 이긴 행이 진 쪽의 바이트를 가리키는 일이 없다.
   * 컨트롤러가 한 번 더 부르면 멱등 경로(200 또는 403, {@link Media} 주석). 파일은 임시 이름으로 쓴 뒤 원자적으로 옮겨 읽는 쪽이 반쪽짜리를 볼 수 없다.
   */
  @Transactional
  public Stored put(String me, String rawId, String rawKind, String contentType, byte[] body) {
    String id = id(rawId);
    String kind = kind(rawKind);
    String mime = mime(contentType);
    if (body == null || body.length == 0) throw ApiException.badRequest("body required");
    if (body.length > MAX_BYTES) throw ApiException.tooLarge();
    Optional<Media> existing = media.findById(id);
    if (existing.isPresent()) {
      Media m = existing.get();
      if (!m.getOwnerId().equals(me)) throw ApiException.forbidden("not yours");
      return new Stored(toDto(m), false);
    }
    Media m = media.saveAndFlush(new Media(id, me, kind, mime, body.length, System.currentTimeMillis()));
    write(id, body);
    return new Stored(toDto(m), true);
  }

  private void write(String id, byte[] body) {
    try {
      Files.createDirectories(dir);
      Path tmp = Files.createTempFile(dir, id + ".", ".part");
      try {
        Files.write(tmp, body);
        Files.move(tmp, file(id), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
      } finally {
        Files.deleteIfExists(tmp);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("media write failed: " + id, e);
    }
  }

  // ── §2.5 GET /api/media/{id} ──

  /** 소유자 · 소유자의 친구 · 공개 글이 참조 · 누군가의 대표컷({@link MediaAccess}) 중 하나면 바이트. 모르는 id 404, 권한 없음 403, 행은 있는데 파일이 없으면 404(로그). */
  @Transactional(readOnly = true)
  public Bytes get(String me, String rawId) {
    String id = id(rawId);
    Media m = media.findById(id).orElseThrow(ApiException::notFound);
    if (!canRead(me, m)) throw ApiException.forbidden("not allowed");
    try {
      return new Bytes(Files.readAllBytes(file(id)), m.getMime());
    } catch (NoSuchFileException e) {
      log.warn("media row without file: {} (owner {}, dir {})", id, m.getOwnerId(), dir);
      throw ApiException.notFound();
    } catch (IOException e) {
      throw new UncheckedIOException("media read failed: " + id, e);
    }
  }

  boolean canRead(String me, Media m) {
    if (m.getOwnerId().equals(me)) return true;
    if (friendships.existsById(FriendshipId.of(me, m.getOwnerId()))) return true;
    for (MediaAccess a : access) if (a.grantsPublic(m.getId())) return true;
    return false;
  }

  static MediaDtos.Media toDto(Media m) {
    return new MediaDtos.Media(m.getId(), m.getOwnerId(), m.getKind(), m.getMime(), m.getBytes(), m.getCreatedAt());
  }
}
