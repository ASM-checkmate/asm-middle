import type { Anchor, BlockId, BlockPlan, Comic, DayKey, Friend, Journey, Memory, Onboard, Phase, PhaseEncounter, Place, ScheduledActivity, TransportMode } from './types';
import { splitDayKey } from './types';
import { BLOCK_ORDER, blockAtIn, blockEndAt, blockSlotIn, blockStartAt, nextBlockId } from './blocks';
import { HOUR_MS, addDaysKey, dayKeyIn, dayStartOfKey, offsetMinutes } from './tz';
import { estimateJourney, journeyKey } from './journey';
import { placeById, tzOf } from './places';
import { alongPath, cumulativeKm } from './geo';
import { AGENTS, agentById, agentOfFriend, agentsAt, rollTalk, talkChance } from './agents';

// ─── The timeline ────────────────────────────────────────────────────────────
// One continuous stream of activities from the anchor (place · moment · zone) onwards, resolved block by block in
// the zone the character lives in. A journey keeps the origin's blocks (it sleeps and eats on board); the moment
// it arrives, the seven blocks switch to the destination's zone. Nothing teleports home at midnight: the next day
// starts wherever the last activity ended. (design/TIMEZONE_SPEC.md)

const MIN_ACTIVITY_MIN = 20;
const WRAP_MIN = 25;        // activity ends this long before the block ends → comic → waiting (time to plan the next block)
const COMIC_MIN = 8;
const MAX_SLOTS = 80;       // block slots resolved per build (≈ 11 days; the anchor is never more than 5 days back)
const JETLAG_MIN_OFFSET = 180;         // a zone jump of this many minutes or more earns a "시차 적응 중" day
const JETLAG_MS = 24 * HOUR_MS;
const MEAL_BLOCKS: ReadonlySet<BlockId> = new Set<BlockId>(['morning', 'lunch', 'evening']);
const ONBOARD_MODES: ReadonlySet<TransportMode> = new Set<TransportMode>(['train', 'plane', 'boat']);
const ENCOUNTER_MIN_MS = 30 * 60_000;   // 같은 장소에서 30분 이상 겹치면 마주침 (FRIENDS_SPEC §4)

/** How many times we have run into each agent — the roll gets +20 % from the second time on. */
export type Encounters = Record<string, number>;

export type Plans = Record<BlockId, BlockPlan>;
/** Plans per lived day, keyed `${dateKey}@${tz}`. */
export type Days = Record<DayKey, Plans>;
export type JourneyCache = Record<string, Journey>;

export function emptyPlans(): Plans {
  const o = {} as Plans;
  for (const id of BLOCK_ORDER) o[id] = { blockId: id, category: id === 'sleep' ? 'sleep' : null, options: [], chosenId: null, chosenBy: null };
  return o;
}

const placeOrNull = (id: string): Place | null => { try { return placeById(id); } catch { return null; } };
/** Does `a` occupy any moment of [start, end)? The journey, the activity and its comic all count. */
const covers = (a: ScheduledActivity, start: number, end: number) => a.departAt < end && a.comicUntil > start;

// ─── eras ────────────────────────────────────────────────────────────────────
/** Zone the character lives in at `t`: that of the last arrival before `t` (a journey keeps the origin's), else `fallbackTz`. */
export function tzAt(t: number, timeline: ScheduledActivity[], fallbackTz: string): string {
  let tz = fallbackTz;
  for (const a of timeline) if (a.arriveAt <= t) tz = a.tz;
  return tz;
}

/** Where the character is at `t`: on its way → the place it left; else the last place it arrived at; else the anchor's. */
export function currentPlaceAt(t: number, timeline: ScheduledActivity[], anchor: Anchor): Place {
  let at = placeById(anchor.placeId);
  for (const a of timeline) {
    if (a.departAt <= t && t < a.arriveAt) return a.fromPlace;
    if (a.arriveAt <= t) at = a.place;
  }
  return at;
}

/** The day the character lives at `t` — `dayKeyIn(t, tzAt(t))`. */
export const currentDayKey = (t: number, timeline: ScheduledActivity[], fallbackTz: string): DayKey => dayKeyIn(t, tzAt(t, timeline, fallbackTz));

// ─── build ───────────────────────────────────────────────────────────────────
/**
 * Resolve the chosen options of `days` into activities with journeys, from the anchor until the first slot past
 * `horizon`. Pure & sync. Cursor = (place, free-from, zone); each slot is the block containing `t` in the cursor's
 * zone. A slot with no chosen option is waited out where the character is.
 */
export function buildTimeline(anchor: Anchor, days: Days, memory: Memory, journeys: JourneyCache, horizon: number, encounters: Encounters = {}): ScheduledActivity[] {
  const acts: ScheduledActivity[] = [];
  const start = placeOrNull(anchor.placeId) ?? placeById(memory.homePlaceId);
  let cursor = { place: start, free: anchor.t, tz: anchor.tz, jetlagUntil: null as number | null };
  let t = anchor.t;
  for (let n = 0; n < MAX_SLOTS; n++) {
    const tz = cursor.tz;
    const slot = blockSlotIn(t, tz);
    if (slot.start > horizon) break;
    // sleep happens wherever the character is; a slot already consumed by the previous activity is skipped
    if (slot.id === 'sleep' || cursor.free >= slot.end) { t = slot.end; continue; }
    const dayKey = dayKeyIn(t, tz);
    const plan = days[dayKey]?.[slot.id];
    const opt = plan?.options.find(o => o.id === plan.chosenId);
    const place = opt ? placeOrNull(opt.placeId) : null;
    if (!opt || !place) { t = slot.end; continue; }
    const journey = journeys[journeyKey(cursor.place.id, place.id)] ?? estimateJourney(cursor.place, place);
    const departAt = Math.max(slot.start, cursor.free);
    const arriveAt = departAt + journey.totalMin * 60_000;
    const destTz = tzOf(place);
    const blockIds = (opt.spanBlocks ?? [slot.id]).filter(b => b !== 'sleep');
    // same zone: stay through the last spanned block; new zone: through the end of the arrival block, local time
    const wrapEnd = destTz === tz ? blockEndAt(slot.dayStart, blockIds[blockIds.length - 1]) : blockSlotIn(arriveAt, destTz).end;
    const endAt = Math.max(arriveAt + MIN_ACTIVITY_MIN * 60_000, wrapEnd - WRAP_MIN * 60_000);
    const comicUntil = endAt + COMIC_MIN * 60_000;
    const zoneJump = Math.abs(offsetMinutes(destTz, arriveAt) - offsetMinutes(tz, departAt)) >= JETLAG_MIN_OFFSET;
    // a big jump starts a 24 h jet-lag window; activities inside that window inherit it so phases can show the chip
    const jetlagUntil = zoneJump ? arriveAt + JETLAG_MS : cursor.jetlagUntil !== null && cursor.jetlagUntil > arriveAt ? cursor.jetlagUntil : null;
    acts.push({ key: `${dayKey}:${slot.id}`, dayKey, blockIds, option: opt, place, fromPlace: cursor.place, journey, departAt, arriveAt, endAt, comicUntil, originTz: tz, tz: destTz, jetlagUntil, companions: opt.friendId ? [opt.friendId] : [] });
    cursor = { place, free: comicUntil, tz: destTz, jetlagUntil };
    t = blockSlotIn(comicUntil - 1, destTz).end;          // the rest of that block is waiting
  }
  addEncounters(acts, memory, encounters);
  return acts;
}

/**
 * 마주침 (FRIENDS_SPEC §4): another user's agent sat at the same place for ≥ 30 min. Meeting is not friendship —
 * the talk roll decides, deterministically (seed = 날짜 + 장소 + 둘의 id), at most once a day. An agent we already
 * call a friend is a "우연히 또 만남" twist instead (`again`), and never spends the day's one talk.
 */
function addEncounters(acts: ScheduledActivity[], memory: Memory, encounters: Encounters): void {
  const talkedDays = new Set<DayKey>();
  for (const a of acts) {
    const met = agentsAt(a.place.id, a.arriveAt, a.endAt, AGENTS)
      .filter(x => x.overlapMs >= ENCOUNTER_MIN_MS && !a.companions.includes(x.agent.id) && x.agent.homePlaceId !== memory.homePlaceId);
    if (!met.length) continue;
    const { agent, overlapMs } = met[0];
    if (memory.friends.some(f => f.id === agent.id)) { a.encounter = { agentId: agent.id, talked: true, again: true }; continue; }
    if (talkedDays.has(a.dayKey)) { a.encounter = { agentId: agent.id, talked: false }; continue; }   // 하루 최대 1명
    const chance = talkChance({ myTraits: memory.traits, myLikes: memory.likes, agent, placeType: a.place.type, overlapMs, metBefore: (encounters[agent.id] ?? 0) > 0 });
    const talked = rollTalk(a.dayKey, a.place.id, memory.name, agent.id, chance);
    if (talked) talkedDays.add(a.dayKey);
    a.encounter = { agentId: agent.id, talked };
  }
}

// ─── phase ───────────────────────────────────────────────────────────────────
/** `companions` / `encounter` of an activity, resolved to the friends and agents the screens draw. */
export const companionsOf = (a: ScheduledActivity, memory: Memory): Friend[] =>
  a.companions.map(id => memory.friends.find(f => f.id === id) ?? friendFromAgent(id)).filter((f): f is Friend => !!f);
const friendFromAgent = (id: string): Friend | null => { const g = agentById(id); return g ? { id: g.id, name: g.name, homePlaceId: g.homePlaceId, color: g.color, emoji: g.emoji } : null; };
export const encounterOf = (a: ScheduledActivity, memory: Memory): PhaseEncounter | undefined => {
  if (!a.encounter) return undefined;
  const f = memory.friends.find(x => x.id === a.encounter!.agentId);
  const agent = agentById(a.encounter.agentId) ?? (f ? agentOfFriend(f) : null);
  return agent ? { agent, talked: a.encounter.talked, again: a.encounter.again } : undefined;
};

export function phaseAt(t: number, timeline: ScheduledActivity[], anchor: Anchor, memory: Memory, comicFor: (a: ScheduledActivity) => Comic): Phase {
  const cur = timeline.find(a => a.departAt <= t && t < a.comicUntil);
  if (cur) {
    const companions = companionsOf(cur, memory), encounter = encounterOf(cur, memory);
    if (t < cur.arriveAt) return movingPhase(t, cur, companions, encounter);
    const jetlag = cur.jetlagUntil !== null && t < cur.jetlagUntil;
    if (t < cur.endAt) return { kind: 'active', act: cur, remainingMin: Math.ceil((cur.endAt - t) / 60_000), progress: (t - cur.arriveAt) / Math.max(1, cur.endAt - cur.arriveAt), tz: cur.tz, jetlag, companions, encounter };
    return { kind: 'comic', act: cur, comic: comicFor(cur), tz: cur.tz, jetlag, companions, encounter };
  }
  const tz = tzAt(t, timeline, anchor.tz);
  let at = placeOrNull(anchor.placeId) ?? placeById(memory.homePlaceId);
  let jetlag = false;
  for (const a of timeline) if (a.arriveAt <= t) { at = a.place; jetlag = a.jetlagUntil !== null && t < a.jetlagUntil; }
  const slot = blockSlotIn(t, tz);
  if (slot.id === 'sleep') return { kind: 'sleeping', until: slot.end, at, tz };
  const upcoming = timeline.find(a => a.departAt > t);
  const nb = nextBlockId(slot.id);
  return { kind: 'waiting', at, currentBlockId: slot.id, nextBlockId: nb, nextStartAt: upcoming ? upcoming.departAt : nb ? blockStartAt(slot.dayStart, nb) : null, tz, jetlag, companions: upcoming ? companionsOf(upcoming, memory) : [] };
}

/** On a train / plane / boat the character sleeps in the origin zone's sleep block and eats in its meal blocks. */
const onboardAt = (t: number, act: ScheduledActivity, mode: TransportMode | undefined): Onboard => {
  if (!mode || !ONBOARD_MODES.has(mode)) return null;
  const blk = blockAtIn(t, act.originTz);
  return blk === 'sleep' ? 'sleep' : MEAL_BLOCKS.has(blk) ? 'meal' : null;
};

export function movingPhase(t: number, act: ScheduledActivity, companions: Friend[] = [], encounter?: PhaseEncounter): Extract<Phase, { kind: 'moving' }> {
  const elapsedMin = (t - act.departAt) / 60_000;
  let acc = 0, legIndex = 0, legProgress = 0;
  for (let i = 0; i < act.journey.legs.length; i++) {
    const l = act.journey.legs[i];
    if (elapsedMin < acc + l.durationMin || i === act.journey.legs.length - 1) { legIndex = i; legProgress = Math.min(1, Math.max(0, (elapsedMin - acc) / Math.max(1, l.durationMin))); break; }
    acc += l.durationMin;
  }
  const leg = act.journey.legs[legIndex];
  const { position, heading } = leg ? alongPath(leg.path, legProgress, cumulativeKm(leg.path)) : { position: { lng: act.place.lng, lat: act.place.lat }, heading: 0 };
  return {
    kind: 'moving', act, legIndex, legProgress, position, heading,
    remainingMin: Math.max(0, Math.ceil((act.arriveAt - t) / 60_000)), totalProgress: Math.min(1, elapsedMin / Math.max(1, act.journey.totalMin)),
    tz: act.originTz, onboard: onboardAt(t, act, leg?.mode), companions, encounter,
  };
}

// ─── blocks of a day ─────────────────────────────────────────────────────────
/**
 * A block of `dayKey` the timeline can reach and nothing occupies: it starts after the anchor, the character lives
 * in the day's zone when it starts (after a zone jump the hours belong to the new zone's day), and no journey,
 * activity or comic covers it. `except` ignores the block's own activity (so a decided block can be re-decided).
 */
export function isBlockFree(id: BlockId, dayKey: DayKey, timeline: ScheduledActivity[], anchor: Anchor, except?: (a: ScheduledActivity) => boolean): boolean {
  if (id === 'sleep') return false;
  const dayStart = dayStartOfKey(dayKey);
  const start = blockStartAt(dayStart, id), end = blockEndAt(dayStart, id);
  if (start < anchor.t) return false;
  if (tzAt(start, timeline, anchor.tz) !== splitDayKey(dayKey).tz) return false;
  return !timeline.some(a => !(except && except(a)) && covers(a, start, end));
}

/** Editable = a block of today (`dayKey`) that has not started and that no other activity covers (spans included). */
export function isBlockEditable(t: number, id: BlockId, dayKey: DayKey, timeline: ScheduledActivity[], anchor: Anchor): boolean {
  if (id === 'sleep') return false;
  if (blockStartAt(dayStartOfKey(dayKey), id) <= t) return false;
  return isBlockFree(id, dayKey, timeline, anchor, a => a.dayKey === dayKey && a.blockIds[0] === id);
}

/** Blocks of `dayKey` that must be auto-decided now: already started, nothing chosen, not covered. */
export function blocksNeedingAutoPick(t: number, dayKey: DayKey, plans: Plans, timeline: ScheduledActivity[], anchor: Anchor): BlockId[] {
  const dayStart = dayStartOfKey(dayKey);
  return BLOCK_ORDER.filter(id => id !== 'sleep' && !plans[id].chosenId && blockStartAt(dayStart, id) <= t && isBlockFree(id, dayKey, timeline, anchor));
}

/**
 * 자동 귀환 — true when, at `t`, the character is away from its home city and the day has reached the last trip's
 * arrival-local date + stayDays (a 당일치기 is due the same day). Away with no trip on record (pruned) → due.
 */
export function returnDueAt(t: number, timeline: ScheduledActivity[], anchor: Anchor, memory: Memory): boolean {
  const homeCity = placeById(memory.homePlaceId).city;
  if (currentPlaceAt(t, timeline, anchor).city === homeCity) return false;
  let trip: ScheduledActivity | undefined;
  for (const a of timeline) if (a.departAt <= t && a.option.stayDays !== undefined && a.place.city !== homeCity) trip = a;
  if (!trip) return true;
  return t >= dayStartOfKey(addDaysKey(dayKeyIn(trip.arriveAt, trip.tz), trip.option.stayDays!));
}
