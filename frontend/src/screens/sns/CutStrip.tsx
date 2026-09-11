import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { PostCut } from '../../sim/posts';
import { PhotoImg } from '../../photo/PhotoImg';

/** 끌어서 넘기기로 인정하는 최소 거리 (px) — 이만큼 못 끌면 제자리로 */
const DRAG_MIN = 4;

/**
 * 컷 가로 슬라이드 (SNS_SPEC §4): 스냅 스크롤, 오른쪽 위 `3 / 7`, 아래 점. 컷은 구운 픽셀(PhotoImg) — 못 받으면 종이색 상자에 이모지.
 * 한 장이면 카운터·점이 없다. **사진을 눌러도 커지지 않는다** (오너 결정 2026-09-11) — 보는 것은 피드 그대로.
 *
 * 손가락은 브라우저의 기본 스크롤(관성·스냅)이 가장 자연스러워 그대로 두고, **마우스·펜은 끌어서 넘긴다** —
 * 데스크톱 브라우저는 스크롤 칸을 끌어도 스크롤하지 않아 "슬라이드가 안 넘어간다"가 된다.
 */
export function CutStrip({ cuts, onIndex, fallback, className = '' }: {
  cuts: readonly PostCut[];
  /** 지금 보는 컷이 바뀔 때 (내 글의 '대표컷으로'가 이 값을 쓴다) */
  onIndex?: (i: number) => void;
  fallback?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const settle = useRef(0);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const show = (n: number) => { if (n !== i) { setI(n); onIndex?.(n); } };
  /** 지금 스크롤 위치에서 몇 번째 컷인가 */
  const indexOf = (el: HTMLDivElement) => {
    const w = el.clientWidth || 1;
    return Math.max(0, Math.min(cuts.length - 1, Math.round(el.scrollLeft / w)));
  };

  const onScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0 || drag.current) return;   // 끄는 중엔 놓을 때 한 번만 적는다
    show(indexOf(el));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === 'touch' || cuts.length < 2 || e.button !== 0) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
    window.clearTimeout(settle.current);
    el.style.scrollSnapType = 'none';   // 끄는 동안은 스냅을 끈다 — 한 칸씩 튀지 않게
    el.style.scrollBehavior = 'auto';
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_MIN) return;
      d.moved = true;
      el.classList.add('is-drag');
    }
    el.scrollLeft = d.left - dx;
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!el) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove('is-drag');
    if (!d) return;
    // 가까운 컷으로 붙인다 (반 칸을 넘겼으면 다음 칸). 붙는 동안만 스냅을 꺼 두고 끝나면 되돌린다
    const n = indexOf(el);
    el.style.scrollBehavior = 'smooth';
    el.scrollTo({ left: n * (el.clientWidth || 0) });
    settle.current = window.setTimeout(() => { el.style.scrollSnapType = ''; el.style.scrollBehavior = ''; }, 320);
    show(n);
  };

  const many = cuts.length > 1;
  return (
    <div className={`sns-strip ${className}`}>
      <div
        className="sns-strip-scroll" ref={ref} onScroll={onScroll}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      >
        {cuts.map((c, k) => (
          <div key={`${c.shotId}:${k}`} className="sns-cut">
            <PhotoImg shotId={c.shotId} alt="">{fallback ?? <span className="sns-cut-empty" />}</PhotoImg>
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
