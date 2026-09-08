package world.theworld.server.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import world.theworld.server.auth.AppUser;
import world.theworld.server.social.FriendsController;
import world.theworld.server.social.SocialDtos.FriendAdd;
import world.theworld.server.social.SocialDtos.OkCreated;
import world.theworld.server.social.SocialService;
import world.theworld.server.sync.DocDtos;
import world.theworld.server.sync.DocsController;
import world.theworld.server.sync.DocsService;

/**
 * 같은 행을 두 요청이 동시에 만들 때(문서 첫 생성·친구 추가) 커밋이 유일 키 위반으로 깨지면 컨트롤러가 한 번 더 시도해
 * 계약의 응답(409 서버본 동봉 · created:false)으로 바꾼다 — 500이 아니다. 경쟁 자체는 재현이 불안정하니 서비스가 한 번 던지게 흉내 낸다.
 */
class RaceRetryTest {
  private static final DataIntegrityViolationException DUP = new DataIntegrityViolationException("could not execute statement [Unique index or primary key violation]");
  private static final AppUser ME = new AppUser("me", "나", 1);

  @Test
  void docsFirstCreateRaceBecomes409() {
    AtomicInteger calls = new AtomicInteger();
    DocsService svc = new DocsService(null, null) {
      @Override public DocDtos.PutOutcome put(String userId, String name, DocDtos.PutRequest req) {
        if (calls.incrementAndGet() == 1) throw DUP;
        return new DocDtos.Conflicted(new DocDtos.Conflict("conflict", name, 1, 5L, 3L, null));
      }
    };
    ResponseEntity<?> r = new DocsController(svc).put(ME, "memory", null);
    assertThat(calls.get()).isEqualTo(2);
    assertThat(r.getStatusCode().value()).isEqualTo(409);
    assertThat(((DocDtos.Conflict) r.getBody()).version()).isEqualTo(1);
  }

  @Test
  void friendAddRaceIsIdempotent() {
    SocialService svc = new SocialService(null, null, null, null, null) {
      @Override public boolean addFriend(String me, FriendAdd req) { throw DUP; }
    };
    OkCreated r = new FriendsController(svc).add(ME, new FriendAdd("other", null, null));
    assertThat(r.ok()).isTrue();
    assertThat(r.created()).isFalse();
  }

}
