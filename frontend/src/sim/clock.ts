// Sim clock: real time by default; dev controls can speed it up or jump so a whole day can be watched in minutes.
// simNow = anchorSim + (realNow - anchorReal) * scale

export interface ClockState { anchorReal: number; anchorSim: number; scale: number }

const KEY = 'theworld.clock.v1';

export function loadClock(): ClockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const c = JSON.parse(raw) as ClockState; if (Number.isFinite(c.scale)) return c; }
  } catch { /* ignore */ }
  const now = Date.now();
  return { anchorReal: now, anchorSim: now, scale: 1 };
}
export function saveClock(c: ClockState) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } }
export const simNow = (c: ClockState) => c.anchorSim + (Date.now() - c.anchorReal) * c.scale;
export const withScale = (c: ClockState, scale: number): ClockState => ({ anchorReal: Date.now(), anchorSim: simNow(c), scale });
export const jumpedTo = (c: ClockState, sim: number): ClockState => ({ anchorReal: Date.now(), anchorSim: sim, scale: c.scale });
export const resetClock = (): ClockState => ({ anchorReal: Date.now(), anchorSim: Date.now(), scale: 1 });
/** 실시간으로 볼 수 있는 어긋남 — 이 안이면 시계가 "지금"이다 */
export const CLOCK_SKEW_MS = 60_000;
/**
 * 실시간 시계인가 — scale 1이고 sim 시각이 실제와 1분 안. jumpTo(scale 1 유지)나 x10→x1(withScale이 앞당긴 anchorSim을 남긴다) 뒤엔
 * scale이 1이어도 false다. 서버로 나가는 것(world/book 문서, 발행 일정, 겹침 조회)은 이것으로 막는다 — dev가 돌린 하루를 다른 사람의
 * 세계에 흘리지 않게 (BACKEND-CONTRACT §3.3·§3.4).
 */
export const isRealClock = (c: ClockState): boolean => c.scale === 1 && Math.abs(c.anchorSim - c.anchorReal) < CLOCK_SKEW_MS;
/** dev 시계인 이유 한 토막 ("x10" · "점프") — DevPanel의 건너뛴 이유에 쓴다. 실시간이면 null */
export const clockWhy = (c: ClockState): string | null => (c.scale !== 1 ? `x${c.scale}` : isRealClock(c) ? null : '점프');
