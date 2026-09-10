// ─── 구운 사진 한 장 (ADR-0020) ─────────────────────────────────────────────────
// shotId → sim/media.ts objectUrlFor(폰 캐시, 없으면 서버)로 blob URL을 받아 <img>로 그린다. 받는 동안은 종이색 상자,
// 못 받으면(권한 없음·오프라인·지워짐) fallback(children) — 없으면 상자 그대로. 자리는 부모가 준다 (photo.css).
import { useEffect, useState, type ReactNode } from 'react';
import { objectUrlFor } from '../sim/media';
import './photo.css';

export interface PhotoImgProps {
  shotId: string;
  className?: string;
  alt?: string;
  /** 못 받았을 때 대신 그릴 것 (옛 경로: crop으로 다시 그린 무대) */
  children?: ReactNode;
}

export function PhotoImg({ shotId, className = '', alt = '', children }: PhotoImgProps) {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean }>({ id: shotId, url: null, failed: false });
  useEffect(() => {
    let live = true;
    // id가 바뀌면 다시 받는다 — 옛 URL은 media.ts가 들고 있으니 여기서 revoke하지 않는다
    void objectUrlFor(shotId).then(url => { if (live) setState({ id: shotId, url, failed: url === null }); }, () => { if (live) setState({ id: shotId, url: null, failed: true }); });
    return () => { live = false; };
  }, [shotId]);
  const cur = state.id === shotId ? state : { id: shotId, url: null, failed: false };
  if (cur.failed && children !== undefined) return <>{children}</>;
  if (!cur.url) return <div className={`photo photo--wait ${className}`} aria-hidden="true" />;
  return <img className={`photo ${className}`} src={cur.url} alt={alt} draggable={false} />;
}
