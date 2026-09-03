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
