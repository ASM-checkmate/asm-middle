package world.theworld.server.media;

import com.fasterxml.jackson.annotation.JsonInclude;

/** §2.5 JSON 모양 — 필드명은 계약 타입 {@code Media}와 글자 그대로. */
public final class MediaDtos {
  private MediaDtos() {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Media(String id, String ownerId, String kind, String mime, long bytes, long createdAt) {}

  /** 서비스가 컨트롤러에 건네는 업로드 결과 — 새로 만들었으면 201, 이미 있던 내 것이면 200. */
  public record Stored(Media media, boolean created) {}

  /** GET 응답 재료 — 디스크에서 읽은 바이트와 저장된 타입. */
  public record Bytes(byte[] bytes, String mime) {}
}
