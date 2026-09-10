package world.theworld.server.media;

/**
 * GET /api/media/{id}의 나머지 열쇠 — "그 id를 참조하는 공개 글이 있는가"·"누군가의 대표컷인가" (CONTRACT §2.5). 소유자·친구는 {@link MediaService}가
 * 직접 보고, 글 쪽은 post 패키지의 {@code PostMediaAccess}, 대표컷은 social 패키지의 {@code RepShotMediaAccess}가 답한다. 서비스는 이 인터페이스의
 * 빈을 전부 받아 어느 하나라도 true인 것을 공개로 친다 — media 패키지는 post를 모른다.
 */
public interface MediaAccess {
  boolean grantsPublic(String mediaId);
}
