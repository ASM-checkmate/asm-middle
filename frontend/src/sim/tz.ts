// ─── Time zones ──────────────────────────────────────────────────────────────
// The character's day follows the zone of the place it is in (design/TIMEZONE_SPEC.md); the owner reads the
// app in the device zone. Everything here is Intl.DateTimeFormat based — one cached formatter per zone, no
// libraries and no DST arithmetic of our own: a day's block boundaries are `local midnight + N h`, which the
// spec allows to drift by an hour on the two DST days a year.
import type { DayKey } from './types';
import { makeDayKey, splitDayKey } from './types';

export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;

const FALLBACK_TZ = 'Asia/Seoul';
const PARTS: Intl.DateTimeFormatOptions = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' };

/** The owner's (device) zone: the small "서울 09:12" pill and the tz-less legacy helpers in blocks.ts use it. */
export const ownerTz: string = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ; } catch { return FALLBACK_TZ; } })();

/** An IANA zone id Intl knows (storage can hand us anything). */
export const isValidTz = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { ...PARTS, timeZone: tz }); }
    catch { f = new Intl.DateTimeFormat('en-US', { ...PARTS, timeZone: 'UTC' }); }   // unknown zone id → don't crash the sim
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; m: number; d: number; hour: number; minute: number; second: number; weekday: number /* 0 = Sunday */ }
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar fields of `t` as read on a clock in `tz`. */
export function localParts(t: number, tz: string): LocalParts {
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(t)) if (p.type !== 'literal') o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second, weekday: WEEKDAY_INDEX[o.weekday] ?? 0 };
}

const wholeSecond = (t: number) => Math.floor(t / 1000) * 1000;
/** Local midnight of the day containing `t`, given its parts (t minus what has elapsed since 00:00 local). */
export const dayStartOf = (t: number, p: LocalParts) => wholeSecond(t) - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
export const dayStartIn = (t: number, tz: string) => dayStartOf(t, localParts(t, tz));

/** Minutes east of UTC in `tz` at `t` (Seoul 540, New York −240 in summer). */
export function offsetMinutes(tz: string, t: number): number {
  const p = localParts(t, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second) - wholeSecond(t)) / 60_000);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKeyIn = (t: number, tz: string) => { const p = localParts(t, tz); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`; };
export const hhmmIn = (t: number, tz: string) => { const p = localParts(t, tz); return `${pad2(p.hour)}:${pad2(p.minute)}`; };
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayKoIn = (t: number, tz: string) => WEEKDAY_KO[localParts(t, tz).weekday] + '요일';

// ─── day keys ────────────────────────────────────────────────────────────────
/** `2026-09-04@America/New_York` — the day the character lives at `t`. The same date in another zone is another day. */
export const dayKeyIn = (t: number, tz: string): DayKey => makeDayKey(dateKeyIn(t, tz), tz);

const dayStarts = new Map<DayKey, number>();
/** Local midnight that starts the day `key` names. */
export function dayStartOfKey(key: DayKey): number {
  let v = dayStarts.get(key);
  if (v === undefined) {
    const { dateKey, tz } = splitDayKey(key);
    const [y, m, d] = dateKey.split('-').map(Number);
    const noonUtc = Date.UTC(y, m - 1, d, 12);
    v = dayStartIn(noonUtc - offsetMinutes(tz, noonUtc) * 60_000, tz);   // local noon → its midnight
    dayStarts.set(key, v);
  }
  return v;
}
/** The day `n` days after `key`, in the same zone. */
export const addDaysKey = (key: DayKey, n: number): DayKey => dayKeyIn(dayStartOfKey(key) + n * DAY_MS + 12 * HOUR_MS, splitDayKey(key).tz);
/** Local midnight that ends the day `key` names (= the next day's start; DST-safe). */
export const dayEndOfKey = (key: DayKey) => dayStartOfKey(addDaysKey(key, 1));
/** Chronological order of day keys (by their local midnight). */
export const compareDayKeys = (a: DayKey, b: DayKey) => dayStartOfKey(a) - dayStartOfKey(b);
