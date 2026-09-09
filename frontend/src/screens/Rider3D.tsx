// ─── 지도 마커의 3D 탈것 (ADR-0014 개정 6) ─────────────────────────────────
// character/index.tsx의 Rider가 쓴다: 같은 DOM(.mv-flip > .mv-tilt > 캔버스)이라 지도의 뒤집기·기울임 CSS가 그대로 먹는다.
// 공용 렌더러로 마커 캔버스에 그리고, moving일 때 24 fps로 바퀴가 돌고 몸이 흔들린다. 준비 전·WebGL 없음이면 fallback(2D SVG).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TransportMode } from '../sim/types';

export interface Rider3DProps {
  mode: TransportMode;
  width: number;
  height: number;
  moving: boolean;
  friend: boolean;
  night: boolean;
  sleeping: boolean;
  lineColor?: string;
  friendColor?: string;
  fallback: ReactNode;
}

type Mod = typeof import('../stage');
let modP: Promise<Mod> | null = null;
const loadStage = (): Promise<Mod> => (modP ??= import('../stage'));
const DPR = () => Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
const FORCE_CSS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stage') === 'css';

export function Rider3D({ mode, width, height, moving, friend, night, sleeping, lineColor, friendColor, fallback }: Rider3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');
  const view = useRef<import('../stage').RiderView | null>(null);
  const modRef = useRef<Mod | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    (async () => {
      if (FORCE_CSS) { setState('off'); return; }
      const mod = await loadStage();
      if (!alive) return;
      if (!mod.stage3dSupported()) { setState('off'); return; }
      modRef.current = mod;
      const v = new mod.RiderView({ mode, friend, night, sleeping, lineColor, friendColor });
      if (!alive) { v.dispose(); return; }
      view.current?.dispose();
      view.current = v;
      setState('ready');
    })();
    return () => { alive = false; view.current?.dispose(); view.current = null; };
  }, [mode, friend, night, sleeping, lineColor, friendColor]);

  useEffect(() => {
    const c = canvas.current, v = view.current, mod = modRef.current;
    if (!c || !v || !mod || state !== 'ready') return;
    const d = DPR(), w = Math.round(width * d), h = Math.round(height * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    let raf = 0, last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < 1000 / 24) return;
      last = now;
      const r = mod.getRenderer();
      if (!r) return;
      const gl = mod.ensureSize(w, h);
      v.render(c, w, h, (now - t0) / 1000, moving, r, gl.h);
      if (!moving) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, width, height, moving]);

  if (state === 'off') return <>{fallback}</>;
  return (
    <>
      {state !== 'ready' && fallback}
      <canvas ref={canvas} className="mv-svg mv-3d" hidden={state !== 'ready'} style={{ width, height, display: state === 'ready' ? 'block' : 'none' }} />
    </>
  );
}
