package world.theworld.server.social;

import org.springframework.stereotype.Component;
import world.theworld.server.media.MediaAccess;

/**
 * GET /api/media/{id}의 네 번째 열쇠 (§2.5) — 누군가의 대표컷(agent_profile.rep_shot_id)이면 누구나 받는다. 핀은 본인이 얼굴로 내건 것이라
 * 공개 여부와 무관하다 — 비공개 프로필도 이름·대표컷은 보인다(SNS_SPEC §10). 핀을 풀면(PUT /api/me/agent repShotId: null) 다시 막힌다.
 */
@Component
public class RepShotMediaAccess implements MediaAccess {
  private final AgentProfileRepository profiles;

  public RepShotMediaAccess(AgentProfileRepository profiles) { this.profiles = profiles; }

  @Override
  public boolean grantsPublic(String mediaId) {
    return profiles.existsByRepShotId(mediaId);
  }
}
