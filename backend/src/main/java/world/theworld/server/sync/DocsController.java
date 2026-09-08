package world.theworld.server.sync;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.sync.DocDtos.Conflicted;
import world.theworld.server.sync.DocDtos.DocView;
import world.theworld.server.sync.DocDtos.DocsList;
import world.theworld.server.sync.DocDtos.PutOutcome;
import world.theworld.server.sync.DocDtos.PutRequest;
import world.theworld.server.sync.DocDtos.Saved;

/** /api/me/docs (BACKEND-CONTRACT §2.2). */
@RestController
public class DocsController {
  private final DocsService service;

  public DocsController(DocsService service) { this.service = service; }

  @GetMapping("/api/me/docs")
  public DocsList list(@CurrentUser AppUser me) {
    return service.list(me.getId());
  }

  @GetMapping("/api/me/docs/{name}")
  public DocView get(@CurrentUser AppUser me, @PathVariable String name) {
    return service.get(me.getId(), name);
  }

  @PutMapping("/api/me/docs/{name}")
  public ResponseEntity<?> put(@CurrentUser AppUser me, @PathVariable String name, @RequestBody(required = false) PutRequest body) {
    PutOutcome out;
    try {
      out = service.put(me.getId(), name, body);
    } catch (DataIntegrityViolationException e) {
      // 첫 생성(baseVersion 0)이 같은 브라우저의 두 탭에서 겹치면 없는 행은 잠글 수 없어 둘 다 insert하고 한쪽이 PK 위반으로 깨진다.
      // 행은 이미 생겼으니 한 번 더 부르면 정상 경로로 409(서버본 동봉)가 난다 — 계약(§2.2)의 응답이지 500이 아니다
      out = service.put(me.getId(), name, body);
    }
    return switch (out) {
      case Saved s -> ResponseEntity.ok(s.ok());
      case Conflicted c -> ResponseEntity.status(409).body(c.conflict());
    };
  }
}
