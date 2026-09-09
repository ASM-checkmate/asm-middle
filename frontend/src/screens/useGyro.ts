// ─── 카메라의 자이로 배선 (ADR-0014) ─────────────────────────────────────────
// 켜면 DeviceOrientation을 듣고, 첫 이벤트의 자세를 0점으로 잡아 그 뒤의 상대 yaw·pitch를 rAF에 합쳐 한 프레임에 한 번만 알린다.
// iOS 13+는 사용자 탭 안에서 requestPermission()을 불러야 한다 — toggle은 클릭 핸들러에서만 부른다.
// 이벤트가 안 오면(데스크톱, 센서 없음) 1.5초 뒤 'none'으로 내려가고 슬라이더만 남는다. 수학은 sim/gyro.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { anglesOf, createFilter, relative, rotationMatrix } from '../sim/gyro';
import type { Angles, Mat3 } from '../sim/gyro';

export type GyroState = 'off' | 'asking' | 'on' | 'denied' | 'none';

interface OrientationStatic { requestPermission?: () => Promise<'granted' | 'denied'> }

/** 이 기기·설정에서 자이로 촬영 버튼을 보여 줄지 — 이벤트가 아예 없거나 움직임 줄이기면 안 그린다 */
export function gyroAvailable(): boolean {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* matchMedia 없는 환경 */ }
  return true;
}

export function useGyro(onAngles: (a: Angles) => void): { state: GyroState; toggle: () => void; rezero: () => void } {
  const [state, setState] = useState<GyroState>('off');
  const cb = useRef(onAngles);
  useEffect(() => { cb.current = onAngles; });
  const r0 = useRef<Mat3 | null>(null);
  const filter = useRef(createFilter());
  const pending = useRef<Angles | null>(null);
  const raf = useRef(0);
  const stop = useRef<(() => void) | null>(null);

  /** 지금 자세를 새 0점으로 ("처음으로") */
  const rezero = useCallback(() => { r0.current = null; filter.current.reset(); }, []);

  useEffect(() => () => { stop.current?.(); }, []);

  const start = useCallback(async () => {
    const Orientation = (window as unknown as { DeviceOrientationEvent: OrientationStatic }).DeviceOrientationEvent;
    if (typeof Orientation.requestPermission === 'function') {
      setState('asking');
      let ok = false;
      try { ok = (await Orientation.requestPermission()) === 'granted'; } catch { ok = false; }
      if (!ok) { setState('denied'); return; }
    }
    rezero();
    let got = false;
    const onEvent = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      got = true;
      const m = rotationMatrix(e.alpha, e.beta, e.gamma);
      if (!r0.current) { r0.current = m; return; }
      pending.current = filter.current.push(anglesOf(relative(r0.current, m)));
      if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; const a = pending.current; if (a) cb.current(a); });
    };
    const cleanup = () => {
      window.removeEventListener('deviceorientation', onEvent);
      window.clearTimeout(timer);
      if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
      stop.current = null;
    };
    const timer = window.setTimeout(() => { if (!got) { cleanup(); setState('none'); } }, 1500);
    window.addEventListener('deviceorientation', onEvent);
    stop.current = cleanup;
    setState('on');
  }, [rezero]);

  const toggle = useCallback(() => {
    if (stop.current) { stop.current(); setState('off'); return; }
    void start();
  }, [start]);

  return { state, toggle, rezero };
}
