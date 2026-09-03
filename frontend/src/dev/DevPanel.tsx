import { useState } from 'react';
import { useWorld } from '../sim/store';
import { BLOCKS, hhmmIn } from '../sim/blocks';
import { DAY_MS, HOUR_MS, ownerTz } from '../sim/tz';
import { cityNameKo, cityOfTz } from '../sim/places';

const SCALES = [1, 10, 60, 600];
/** Mid-block and "waiting gap" times (activities wrap ~17 min before a block ends, so :45 is the timetable state). */
const MIDS: [number, number, string][] = [[3, 0, '03:00'], [8, 0, '08:00'], [10, 30, '10:30'], [13, 0, '13:00'], [16, 0, '16:00'], [19, 0, '19:00'], [22, 0, '22:00']];
const GAPS: [number, number, string][] = [[8, 45, '08:45'], [8, 58, '08:58'], [11, 45, '11:45'], [13, 45, '13:45'], [17, 45, '17:45'], [19, 45, '19:45'], [23, 45, '23:45']];
/** Relative jumps (sim ms) — a flight, a night, a whole day of a trip. */
const JUMPS: [number, string][] = [[HOUR_MS, '+1h'], [6 * HOUR_MS, '+6h'], [DAY_MS, '+1일']];

/* QA round 1: the old text pill sat at y≈62–88 on top of the timetable speech bubble (.tt-bubble top 62px)
   and the activity place tag (.act-tag top 74px). Now a 30px round toggle in the top-left of the clock row,
   with the text only when open; the toggle itself reads the x-scale when time is accelerated, so the chrome's own
   badge is hidden here and the owner-time pill ("서울 09:12", left of the clock) keeps its room. Bottom-left was
   rejected: the moving card + map attribution live there. */
const CSS = `
.stage > .dev { left: 10px; top: calc(14px + var(--safe-top)); }
.stage > .dev .dev-pill {
  display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border-radius: 50%;
  font-size: 8px; letter-spacing: .02em; line-height: 1; opacity: .85;
}
.stage > .dev.is-open .dev-pill { opacity: 1; background: var(--coral); }
.stage > .dev.is-fast .dev-pill { background: var(--sun); color: var(--ink); opacity: 1; }
.stage > .dev .dev-body { margin-top: 8px; }
.stage > .dev .dev-status { font-family: var(--mono); font-size: 10px; color: var(--ink-2); letter-spacing: .04em; }
.stage:has(> .dev) .chrome-side { display: none; }
`;

/** "서울" for a zone with a city in the catalogue, else the IANA id's last segment ("New_York"). */
const zoneName = (tz: string) => { const c = cityOfTz(tz); return c ? cityNameKo(c) : tz.split('/').pop() ?? tz; };

/** `?dev=1` — time scale, jump-to-hour (in the character's zone), relative jumps, reset day, current sim time. */
export function DevPanel() {
  const now = useWorld(s => s.now);
  const tz = useWorld(s => s.tz);
  const scale = useWorld(s => s.clock.scale);
  const kind = useWorld(s => s.phase.kind);
  const friends = useWorld(s => s.memory.friends);
  const setScale = useWorld(s => s.setScale);
  const jumpToHour = useWorld(s => s.jumpToHour);
  const jumpBy = useWorld(s => s.jumpBy);
  const resetDay = useWorld(s => s.resetDay);
  const [open, setOpen] = useState(false);

  return (
    <div className={`dev ${open ? 'is-open' : ''} ${scale !== 1 ? 'is-fast' : ''}`}>
      <style>{CSS}</style>
      <button type="button" className="dev-pill" onClick={() => setOpen(o => !o)} aria-label="개발 패널" aria-expanded={open}>
        {scale !== 1 ? `x${scale}` : 'DEV'}
      </button>
      {open && (
        <div className="dev-body">
          <div className="dev-row">
            <span className="dev-status">
              DEV · 친구 {friends.length}명 · {hhmmIn(now, tz)} {zoneName(tz)}{tz !== ownerTz ? ` (${zoneName(ownerTz)} ${hhmmIn(now, ownerTz)})` : ''} · x{scale} · {kind}
            </span>
          </div>
          <div className="dev-row">
            <span className="dev-k">tz</span>
            <span className="dev-status" style={{ color: 'var(--ink)' }}>{tz}</span>
          </div>
          <div className="dev-row">
            <span className="dev-k">scale</span>
            {SCALES.map(s => <button key={s} type="button" className={`dev-b ${s === scale ? 'is-on' : ''}`} onClick={() => setScale(s)}>x{s}</button>)}
          </div>
          <div className="dev-row">
            <span className="dev-k">block</span>
            {BLOCKS.map(b => <button key={b.id} type="button" className="dev-b" onClick={() => jumpToHour(b.startHour)}>{String(b.startHour).padStart(2, '0')} {b.label}</button>)}
          </div>
          <div className="dev-row">
            <span className="dev-k">mid</span>
            {MIDS.map(([h, m, l]) => <button key={l} type="button" className="dev-b" onClick={() => jumpToHour(h, m)}>{l}</button>)}
          </div>
          <div className="dev-row">
            <span className="dev-k">wait</span>
            {GAPS.map(([h, m, l]) => <button key={l} type="button" className="dev-b" onClick={() => jumpToHour(h, m)}>{l}</button>)}
          </div>
          <div className="dev-row">
            <span className="dev-k">jump</span>
            {JUMPS.map(([ms, l]) => <button key={l} type="button" className="dev-b" onClick={() => jumpBy(ms)}>{l}</button>)}
          </div>
          <div className="dev-row">
            <span className="dev-k">day</span>
            <button type="button" className="dev-b dev-b--warn" onClick={() => { if (confirm('오늘 계획과 시계를 초기화할까요?')) resetDay(); }}>reset day</button>
            <span className="dev-k" style={{ marginLeft: 'auto', width: 'auto' }}>{new Date(now).toLocaleTimeString('ko-KR')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
