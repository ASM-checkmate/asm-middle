package world.theworld.server.photo;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.media.MediaService;
import world.theworld.server.photo.ShotGenDtos.Request;
import world.theworld.server.photo.ShotGenDtos.Response;

/**
 * POST /api/shots/{id}/generate (ADR-0029, CONTRACT §2.6) — 폰이 찍은 컷(id)의 화풍 생성. 응답의 shotId는 **새 media id**다: 원래 id의
 * 픽셀(단순 합성본)은 그대로 두고(멱등 업로드라 덮을 수 없다) 폰이 샷·앨범의 참조를 바꾼다. 본문 상한 3 MB(BodyLimitFilter.SHOTGEN_MAX).
 */
@RestController
public class ShotGenController {
  private final ShotGenService service;

  public ShotGenController(ShotGenService service) { this.service = service; }

  @PostMapping("/api/shots/{id}/generate")
  public Response generate(@CurrentUser AppUser me, @PathVariable String id, @RequestBody(required = false) Request body) {
    return service.generate(me.getId(), MediaService.checkId(id), body);
  }
}
