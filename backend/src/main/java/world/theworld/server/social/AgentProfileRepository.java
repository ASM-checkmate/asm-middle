package world.theworld.server.social;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentProfileRepository extends JpaRepository<AgentProfile, String> {
  /** 그 미디어를 대표컷으로 핀한 프로필이 있나 ({@link RepShotMediaAccess}). */
  boolean existsByRepShotId(String repShotId);
}
