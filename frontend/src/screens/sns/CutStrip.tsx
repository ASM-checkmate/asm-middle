import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PostCut } from '../../sim/posts';
import { PhotoImg } from '../../photo/PhotoImg';
import { Button, Glyph } from '../../ui';

/**
 * 컷 가로 슬라이드 (SNS_SPEC §4): 스냅 스크롤, 오른쪽 위 `3 / 7`, 아래 점. 컷은 구운 픽셀(PhotoImg) — 못 받으면 종이색 상자에 이모지.
 * 한 장이면 카운터·점이 없다. `onOpen(i)`는 컷을 탭했을 때 (전체 화면 보기).
 */
export function CutStrip({ cuts, onOpen, big, index: forced, onIndex, fallback, className = '' }: {
  cuts: readonly PostCut[];
  onOpen?: (i: number) => void;
  /** 전체 화면 보기 — 더 크게, 배경은 잉크 */
  big?: boolean;
  /** 처음에 보여 줄 컷 */
  index?: number;
  onIndex?: (i: number) => void;
  fallback?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(forced ?? 0);
  // 처음 열 때 지정한 컷으로 (전체 화면 보기는 탭한 컷에서 시작한다)
  useEffect(() => {
    const el = ref.current;
    if (!el || forced === undefined) return;
    el.scrollLeft = forced * el.clientWidth;
    setI(forced);
  }, [forced]);
  const onScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    const n = Math.max(0, Math.min(cuts.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
    if (n !== i) { setI(n); onIndex?.(n); }
  };
  const many = cuts.length > 1;
  return (
    <div className={`sns-strip ${big ? 'is-big' : ''} ${className}`}>
      <div className="sns-strip-scroll" ref={ref} onScroll={onScroll}>
        {cuts.map((c, k) => (
          <div key={`${c.shotId}:${k}`} className="sns-cut">
            {onOpen ? (
              <button type="button" className="sns-cut-btn" aria-label={`${k + 1}번째 컷 크게 보기`} onClick={() => onOpen(k)}>
                <PhotoImg shotId={c.shotId} alt="">{fallback ?? <span className="sns-cut-empty" />}</PhotoImg>
              </button>
            ) : (
              <PhotoImg shotId={c.shotId} alt="">{fallback ?? <span className="sns-cut-empty" />}</PhotoImg>
            )}
          </div>
        ))}
      </div>
      {many && <span className="sns-strip-n num" aria-live="polite">{i + 1} / {cuts.length}</span>}
      {many && (
        <div className="sns-dots" aria-hidden="true">
          {cuts.map((_, k) => <i key={k} className={k === i ? 'is-on' : ''} />)}
        </div>
      )}
    </div>
  );
}

/** 전체 화면 보기 — 같은 슬라이드를 잉크 바닥에 크게. `action`은 지금 보는 컷에 거는 한 가지 일(내 글의 '대표컷으로') */
export function CutViewer({ cuts, index, onClose, action }: {
  cuts: readonly PostCut[];
  index: number;
  onClose: () => void;
  action?: { label: string; onClick: (i: number) => void; done?: (i: number) => boolean };
}) {
  const [i, setI] = useState(index);
  const isDone = action?.done?.(i) ?? false;
  return (
    <div className="sns-viewer" role="dialog" aria-label="컷 크게 보기">
      <div className="sns-viewer-hd">
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      <CutStrip cuts={cuts} big index={index} onIndex={setI} />
      {action && (
        <div className="sns-viewer-ft">
          <Button tone={isDone ? 'done' : 'sun'} small onClick={() => action.onClick(i)}>{isDone ? <><Glyph name="check" size={16} /> 대표컷</> : action.label}</Button>
        </div>
      )}
    </div>
  );
}
