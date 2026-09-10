import { PhotoImg } from '../../photo/PhotoImg';

/**
 * 사람 머리 자리 (SNS_SPEC §5 얼굴 규칙): 본인이 올린 대표컷이 있으면 그 픽셀, 없으면 종이색 네모에 이모지·이름만.
 * 얼굴을 우리가 임의로 그리지 않는다 — FriendHead(공용 친구 얼굴)는 여기 안 쓴다.
 */
export function AuthorHead({ repShotId, emoji, size = 28, className = '' }: { repShotId?: string | null; emoji?: string; size?: number; className?: string }) {
  const fallback = <span className="sns-head-em" aria-hidden="true">{emoji ?? '·'}</span>;
  return (
    <span className={`sns-head ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
      {repShotId ? <PhotoImg shotId={repShotId}>{fallback}</PhotoImg> : fallback}
    </span>
  );
}
