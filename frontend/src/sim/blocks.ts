import type { BlockId, Category } from './types';
import { dateKeyIn, dayStartIn, dayStartOf, hhmmIn, localParts, weekdayKoIn } from './tz';

export interface BlockDef {
  id: BlockId;
  label: string;
  startHour: number;   // inclusive
  endHour: number;     // exclusive
  fixedCategory?: Category;
  color: string;       // ring colour token
}

/** The 7 fixed blocks of a day. Boundaries are not user-adjustable. */
export const BLOCKS: BlockDef[] = [
  { id: 'sleep',   label: '수면', startHour: 0,  endHour: 7,  fixedCategory: 'sleep', color: 'var(--night)' },
  { id: 'morning', label: '아침', startHour: 7,  endHour: 9,  color: 'var(--sun)' },
  { id: 'am',      label: '오전', startHour: 9,  endHour: 12, color: 'var(--sky)' },
  { id: 'lunch',   label: '점심', startHour: 12, endHour: 14, color: 'var(--coral)' },
  { id: 'pm',      label: '오후', startHour: 14, endHour: 18, color: 'var(--mint)' },
  { id: 'evening', label: '저녁', startHour: 18, endHour: 20, color: 'var(--sun)' },
  { id: 'night',   label: '밤',   startHour: 20, endHour: 24, color: 'var(--night-2)' },
];

export const BLOCK_ORDER: BlockId[] = BLOCKS.map(b => b.id);
export const blockDef = (id: BlockId): BlockDef => BLOCKS.find(b => b.id === id)!;
export const blockIndex = (id: BlockId) => BLOCK_ORDER.indexOf(id);
export const nextBlockId = (id: BlockId): BlockId | null => BLOCK_ORDER[blockIndex(id) + 1] ?? null;

export const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: 'meal',     label: '식사',  emoji: '🍚' },
  { id: 'play',     label: '놀기',  emoji: '🎈' },
  { id: 'exercise', label: '운동',  emoji: '🏃' },
  { id: 'study',    label: '공부',  emoji: '📚' },
  { id: 'work',     label: '일',    emoji: '💼' },
  { id: 'rest',     label: '쉬기',  emoji: '🛋️' },
  { id: 'travel',   label: '여행',  emoji: '🧳' },
];
export const categoryDef = (id: Category) => CATEGORIES.find(c => c.id === id) ?? { id, label: id === 'sleep' ? '잠자기' : id, emoji: '😴' };

// ─── time helpers ────────────────────────────────────────────────────────────
// All sim time is a ms timestamp. `blockStartAt/blockEndAt` take a local midnight and are zone-agnostic; the
// `…In(t, tz)` helpers resolve a moment in the character's zone (TIMEZONE_SPEC); the tz-less names below them
// keep resolving in the owner's (device) zone, as before.
const blockOfHour = (h: number): BlockId => BLOCKS.find(b => h >= b.startHour && h < b.endHour)!.id;

/** Block containing `t` on a clock in `tz`. */
export const blockAtIn = (t: number, tz: string): BlockId => blockOfHour(localParts(t, tz).hour);
/** Local midnight of the day containing `t` in `tz`. */
export const startOfDayIn = dayStartIn;
export { dateKeyIn, hhmmIn, weekdayKoIn };
/** [start, end) of block `id` on the local day that contains `t` in `tz`. */
export const blockStartAtIn = (t: number, tz: string, id: BlockId) => blockStartAt(dayStartIn(t, tz), id);
export const blockEndAtIn = (t: number, tz: string, id: BlockId) => blockEndAt(dayStartIn(t, tz), id);
/** The slot `t` falls in — block id, its day's midnight and its boundaries — from a single Intl call. */
export function blockSlotIn(t: number, tz: string): { id: BlockId; dayStart: number; start: number; end: number } {
  const p = localParts(t, tz);
  const dayStart = dayStartOf(t, p);
  const id = blockOfHour(p.hour);
  return { id, dayStart, start: blockStartAt(dayStart, id), end: blockEndAt(dayStart, id) };
}

/** Owner-zone (device) versions, kept for the screens until they switch to `phase.tz`. */
export const dateKeyOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const blockStartAt = (dayStart: number, id: BlockId) => dayStart + blockDef(id).startHour * 3600_000;
export const blockEndAt = (dayStart: number, id: BlockId) => dayStart + blockDef(id).endHour * 3600_000;
export const blockAt = (t: number): BlockId => blockOfHour(new Date(t).getHours());
export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const weekdayKo = (t: number) => ['일', '월', '화', '수', '목', '금', '토'][new Date(t).getDay()] + '요일';
