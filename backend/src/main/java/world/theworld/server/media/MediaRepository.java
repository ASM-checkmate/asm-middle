package world.theworld.server.media;

import org.springframework.data.jpa.repository.JpaRepository;

public interface MediaRepository extends JpaRepository<Media, String> {
  /** repShotId 검증용 — 그 id가 내 것인가 (SocialService.putAgent). */
  boolean existsByIdAndOwnerId(String id, String ownerId);
}
