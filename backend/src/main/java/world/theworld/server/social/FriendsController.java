package world.theworld.server.social;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.social.SocialDtos.Activities;
import world.theworld.server.social.SocialDtos.FriendAdd;
import world.theworld.server.social.SocialDtos.Friends;
import world.theworld.server.social.SocialDtos.OkCreated;

/** 친구 (BACKEND-CONTRACT §2.3): 목록(지금 뭐 하는지 포함)·추가(대칭·멱등)·삭제·친구의 하루. */
@RestController
public class FriendsController {
  private final SocialService social;

  public FriendsController(SocialService social) { this.social = social; }

  @GetMapping("/api/friends")
  public Friends list(@CurrentUser AppUser me, @RequestParam(required = false) Long at) {
    return new Friends(social.friends(me.getId(), at == null ? System.currentTimeMillis() : at));
  }

  @PostMapping("/api/friends")
  public OkCreated add(@CurrentUser AppUser me, @RequestBody(required = false) FriendAdd body) {
    try {
      return new OkCreated(true, social.addFriend(me.getId(), body));
    } catch (DataIntegrityViolationException e) {
      // 마주침이 끝나는 순간 두 기기의 settle()이 같이 보낸다 — existsById와 save 사이에 상대가 먼저 적었으면 PK 위반. 멱등이니 created:false
      return new OkCreated(true, false);
    }
  }

  @DeleteMapping("/api/friends/{otherId}")
  public ResponseEntity<Void> remove(@CurrentUser AppUser me, @PathVariable String otherId) {
    social.removeFriend(me.getId(), otherId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/api/friends/{otherId}/day")
  public Activities day(@CurrentUser AppUser me, @PathVariable String otherId, @RequestParam long from, @RequestParam long to) {
    return new Activities(social.friendDay(me.getId(), otherId, from, to));
  }
}
