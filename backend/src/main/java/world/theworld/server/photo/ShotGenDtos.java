package world.theworld.server.photo;

import com.fasterxml.jackson.annotation.JsonInclude;

/** POST /api/shots/{id}/generate (ADR-0029, CONTRACT §2.6) — 요청은 JSON, 그림은 base64. */
public final class ShotGenDtos {
  private ShotGenDtos() {}

  /** 그림 하나 — mime(image/webp|image/png|image/jpeg)과 base64(접두 없이) */
  public record Pic(String mime, String data) {}

  /** 인물의 자리·크기 — x/y는 발이 닿는 점(프레임 %), scale은 프레임 너비 대비 폭 (프론트 ShotFigure) */
  public record Figure(Double x, Double y, Double scale) {}

  /**
   * @param background AI 배경 원본 (있으면 합성본 없이 이것 + 캐릭터 + 자리 글로 그린다 — 붙여넣은 티가 결과에 안 샌다)
   * @param mePos 내 자리·크기 (background와 함께)
   * @param friendPos 동행 자리·크기
   * @param composite 폰이 구운 단순 합성본 (배경 + 캐릭터, 자리·크기 표시) — background가 없을 때(SVG 무대)의 앵커, 긴 변 768px쯤
   * @param me 내 캐릭터 투명 PNG (정체성 참고)
   * @param friend 동행 캐릭터 투명 PNG (있을 때)
   * @param place 장소 이름 ("조새호")
   * @param spot 자리 이름 ("창가 자리") — 없어도 된다
   * @param sit 앉는 자리인가
   * @param mePose 카메라의 자세 키 (idle|sit|wave|happy|eat|read|think|draw|walk)
   * @param friendPose 동행의 자세 키
   * @param backdrop AI 배경 위인가 (false면 SVG 무대 위 — 그래도 같은 규칙으로 그린다)
   */
  public record Request(Pic background, Figure mePos, Figure friendPos, Pic composite, Pic me, Pic friend, String place, String spot, Boolean sit, String mePose, String friendPose, Boolean backdrop) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Response(String shotId, String mime, long bytes, long ms) {}
}
