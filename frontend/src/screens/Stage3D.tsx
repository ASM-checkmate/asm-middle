// ─── 3D 무대 한 장 (ADR-0014 개정) ──────────────────────────────────────────
// ShotStage 안에 들어가는 그림: 배경 캔버스 + 인물 캔버스. 무대 모듈(three.js)과 텍스처가 준비되기 전, 또는 WebGL이 없으면
// fallback(CSS 무대)을 그대로 보여 준다. crop이 바뀌면 rAF에 합쳐 한 프레임에 한 번 다시 그린다 — 자이로가 60 Hz로 밀어도 그만큼만.
// 활동 화면(full)은 인물 없이 세트만 그리고, 그린 뒤 onFrame으로 투영 함수를 넘겨 DOM 인물이 세트를 따라가게 한다.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Pose } from '../character';
import type { PlaceType } from '../sim/types';
import type { StageCrop, Vec3 } from '../sim/stage';
import type { StageView } from '../stage';

export type Projector = (p: Vec3) => [number, number] | null;

export interface Stage3DProps {
  type: PlaceType;
  pose: Pose;
  crop: StageCrop;
  friendColor?: string;
  metColor?: string;
  seenColor?: string;
  /** 준비 전·WebGL 없음일 때 보여 줄 CSS 무대 */
  fallback: ReactNode;
  /** 무대 전체(390×844)를 보는 활동 화면 — 인물 캔버스 없이 세트만 */
  full?: boolean;
  /** 그린 뒤: 월드 점 → 캔버스 픽셀 투영과 캔버스 크기 (DOM 인물 배치용) */
  onFrame?: (project: Projector, size: { w: number; h: number }) => void;
}

type Mod = typeof import('../stage');
let modP: Promise<Mod> | null = null;
const loadStage = (): Promise<Mod> => (modP ??= import('../stage'));

const DPR = () => Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
/** QA 훅: `?…&stage=css`면 3D를 끄고 CSS 무대만 — 같은 crop에서 두 그림을 견준다 (dev/preview.ts와 같은 어법) */
const FORCE_CSS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stage') === 'css';

export function Stage3D({ type, pose, crop, friendColor, metColor, seenColor, fallback, full = false, onFrame }: Stage3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<StageView | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const cropRef = useRef(crop);
  const frameCb = useRef(onFrame);
  useEffect(() => { frameCb.current = onFrame; });
  const raf = useRef(0);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');

  const draw = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const v = view.current, bg = bgRef.current, fg = full ? null : fgRef.current, { w, h } = size.current;
      if (!v || !bg || (!full && !fg) || !w || !h) return;
      if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; }
      if (fg && (fg.width !== w || fg.height !== h)) { fg.width = w; fg.height = h; }
      v.render(cropRef.current, bg, fg, w, h, full);
      const d = DPR();
      frameCb.current?.(p => { const q = v.project(p); return q && [q[0] / d, q[1] / d]; }, { w: w / d, h: h / d });
    });
  };

  // 무대 만들기 — 장소·포즈·인물이 바뀌면 새로. 텍스처는 캐시라 두 번째부터는 즉시
  useEffect(() => {
    let alive = true;
    setState('loading');
    (async () => {
      if (FORCE_CSS) { setState('off'); return; }
      const mod = await loadStage();
      if (!alive) return;
      if (!mod.stage3dSupported()) { setState('off'); return; }
      let v: StageView;
      try { v = await mod.StageView.create({ type, pose, friendColor, metColor, seenColor }, !full); }
      catch { if (alive) setState('off'); return; }
      if (!alive) { v.dispose(); return; }
      view.current?.dispose();
      view.current = v;
      setState('ready');
      draw();
    })();
    return () => {
      alive = false;
      view.current?.dispose();
      view.current = null;
      if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, pose, friendColor, metColor, seenColor, full]);

  // 크기: 프레임·썸네일·만화 컷·활동 화면마다 다르다. DPR 2 상한 (MOVEMENT_SPEC §8)
  useEffect(() => {
    const el = wrap.current;
    if (!el || state !== 'ready') return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const d = DPR();
      size.current = { w: Math.round(r.width * d), h: Math.round(r.height * d) };
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => { cropRef.current = crop; draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [crop]);

  if (state === 'off') return <>{fallback}</>;
  return (
    <div ref={wrap} className="st3d" aria-hidden="true">
      {state !== 'ready' && fallback}
      <canvas ref={bgRef} className="st3d-bg" hidden={state !== 'ready'} />
      {!full && <canvas ref={fgRef} className="st3d-fg" hidden={state !== 'ready'} />}
    </div>
  );
}
