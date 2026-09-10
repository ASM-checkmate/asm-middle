package world.theworld.server.media;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.media.MediaDtos.Bytes;
import world.theworld.server.media.MediaDtos.Stored;

/**
 * 미디어 (CONTRACT §2.5): 올리기(멱등)·받기(소유자·친구·공개 글). 본문은 JSON이 아니라 이미지 바이트 그대로라 {@code consumes}를 두지 않고
 * 서비스가 Content-Type을 본다 — 틀리면 415가 아니라 계약의 400 'unsupported image type'.
 */
@RestController
public class MediaController {
  private final MediaService service;

  public MediaController(MediaService service) { this.service = service; }

  @PutMapping("/api/media/{id}")
  public ResponseEntity<MediaDtos.Media> put(@CurrentUser AppUser me, @PathVariable String id, @RequestParam(required = false) String kind,
                                             @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType,
                                             @RequestBody(required = false) byte[] body) {
    Stored out;
    try {
      out = service.put(me.getId(), id, kind, contentType, body);
    } catch (DataIntegrityViolationException e) {
      // 같은 id를 두 요청이 동시에 올렸다(두 탭·재시도) — findById와 persist 사이에 한쪽이 먼저 넣었으면 PK 위반. 다시 부르면 멱등 경로(200 또는 403)
      out = service.put(me.getId(), id, kind, contentType, body);
    }
    return ResponseEntity.status(out.created() ? 201 : 200).body(out.media());
  }

  @GetMapping("/api/media/{id}")
  public ResponseEntity<byte[]> get(@CurrentUser AppUser me, @PathVariable String id) {
    Bytes b = service.get(me.getId(), id);
    return ResponseEntity.ok()
      .contentType(MediaType.parseMediaType(b.mime()))
      .header(HttpHeaders.CACHE_CONTROL, MediaService.CACHE_CONTROL)
      .body(b.bytes());
  }
}
