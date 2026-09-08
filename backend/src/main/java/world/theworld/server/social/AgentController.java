package world.theworld.server.social;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.auth.AppUser;
import world.theworld.server.auth.CurrentUser;
import world.theworld.server.social.SocialDtos.AgentPut;
import world.theworld.server.social.SocialDtos.AgentsAtRequest;
import world.theworld.server.social.SocialDtos.Count;
import world.theworld.server.social.SocialDtos.Hits;
import world.theworld.server.social.SocialDtos.RemoteAgent;
import world.theworld.server.social.SocialDtos.SchedulePut;

/** 내 에이전트 프로필·발행 일정·겹침 조회 (BACKEND-CONTRACT §2.3). */
@RestController
public class AgentController {
  private final SocialService social;

  public AgentController(SocialService social) { this.social = social; }

  @PutMapping("/api/me/agent")
  public RemoteAgent putAgent(@CurrentUser AppUser me, @RequestBody(required = false) AgentPut body) {
    return social.putAgent(me.getId(), body);
  }

  @PutMapping("/api/me/schedule")
  public Count putSchedule(@CurrentUser AppUser me, @RequestBody(required = false) SchedulePut body) {
    return new Count(social.putSchedule(me.getId(), body));
  }

  @PostMapping("/api/agents/at")
  public Hits agentsAt(@CurrentUser AppUser me, @RequestBody(required = false) AgentsAtRequest body) {
    return new Hits(social.agentsAt(me.getId(), body));
  }
}
