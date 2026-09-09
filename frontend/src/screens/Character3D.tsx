// ─── 3D 캐릭터 한 명 (ADR-0014 개정 6) ──────────────────────────────────────
// character/index.tsx의 Character가 64px 이상이면 이걸로 그린다: 공용 WebGL 렌더러로 자기 캔버스에 그리고(무대와 같은 방식),
// 보일 때만 24 fps로 움직인다(숨쉬기·깜빡임·포즈 루프). three.js와 모델이 준비되기 전, WebGL이 없으면 fallback(2D SVG) 그대로.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Pose } from '../character/Character';
import type { Variant } from '../character/shapes';

export interface Character3DProps {
  pose: Pose;
  size: number;
  variant: Variant;
  color?: string;
  className?: string;
  style?: CSSProperties;
  paused?: boolean;
  label: string;
  fallback: ReactNode;
}

type Mod = typeof import('../stage');
let modP: Promise<Mod> | null = null;
const loadStage = (): Promise<Mod> => (modP ??= import('../stage'));
const DPR = () => Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
const FORCE_CSS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stage') === 'css';

export function Character3D({ pose, size, variant, color, className, style, paused, label, fallback }: Character3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');
  const view = useRef<import('../stage').CharacterView | null>(null);
  const visible = useRef(true);

  useEffect(() => {
    let alive = true;
    setState('loading');
    (async () => {
      if (FORCE_CSS) { setState('off'); return; }
      const mod = await loadStage();
      if (!alive) return;
      if (!mod.stage3dSupported()) { setState('off'); return; }
      const v = await mod.CharacterView.create({ pose, variant, color });
      if (!alive) { v.dispose(); return; }
      view.current?.dispose();
      view.current = v;
      setState('ready');
    })();
    return () => { alive = false; view.current?.dispose(); view.current = null; };
  }, [pose, variant, color]);

  // 그리기: 보일 때 24 fps, 멈춤(paused)이면 한 장만
  useEffect(() => {
    const c = canvas.current, v = view.current;
    if (!c || !v || state !== 'ready') return;
    const d = DPR(), px = Math.round(size * d);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    const io = new IntersectionObserver(es => { visible.current = !!es[0]?.isIntersecting; }, { threshold: 0 });
    io.observe(c);
    let raf = 0, last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible.current || document.hidden || now - last < 1000 / 24) return;
      last = now;
      v.render(c, px, (now - t0) / 1000);
      if (paused) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [state, size, paused]);

  if (state === 'off') return <>{fallback}</>;
  const cls = ['ch', 'ch--3d', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-pose={pose} data-variant={variant} style={{ width: size, height: size, ...style }} role="img" aria-label={label}>
      {state !== 'ready' && fallback}
      <canvas ref={canvas} className="ch-3d" hidden={state !== 'ready'} style={{ width: size, height: size }} />
    </div>
  );
}
