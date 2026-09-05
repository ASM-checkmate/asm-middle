// ─── QA preview: `?preview=…` forces a phase WITHOUT touching the store ─────
//   timetable[&tz=][&hour=][&jetlag=1][&proposal=1][&travel=1][&money=][&fatigue=][&mood=][&judge=pushback|refuse]   sleeping[&tz=]
//   active:{placeType}[&tz=][&jetlag=1][&encounter=talked|seen]
//   comic[&tz=][&jetlag=1][&friction=…]   summary[&gap=1]   book
//   *[&request=decide|money|worry][&call=in|answered|refused][&chat=1]   moving:{walk|car|subway|train|plane|boat}[&p=0.35][&onboard=sleep|meal]
// `tz` puts the character in a city of that zone (America/New_York → 뉴욕); `timetable&tz=` also fakes the whole day
// around it (yesterday's flight from home landing this morning, the agent's picks for the rest), so the flight-covered
// blocks, the local date title and the jet-lag chip can be screenshotted without living the trip.
import { useMemo, useRef } from 'react';
import { decide, useWorld, type World } from '../sim/store';
import type { ActivityOption, Anchor, BlockId, Category, Comic, DayKey, DaySummaryItem, Journey, Leg, Onboard, Phase, Place, PlaceType, ScheduledActivity, TransportMode } from '../sim/types';
import { PLACES, placeById, tzOf } from '../sim/places';
import { estimateJourney, MODE_LABEL, primaryMode } from '../sim/journey';
import { geodesicPath, haversineKm } from '../sim/geo';
import { BLOCK_ORDER, blockAtIn, blockEndAt, blockIndex, blockStartAt, nextBlockId } from '../sim/blocks';
import { DAY_MS, HOUR_MS, dayKeyIn, dayStartIn, dayStartOfKey, isValidTz, localParts, ownerTz } from '../sim/tz';
import { buildTimeline, companionsOf, encounterOf, currentPlaceAt, emptyPlans, movingPhase, type Plans } from '../sim/timeline';
import { suggestOptions } from '../sim/suggest';
import { AGENTS, agentById } from '../sim/agents';
import { makeComic } from '../sim/comic';
import { INITIAL_STATUS, wonKo, type Status } from '../sim/status';
import { WORRY_CHOICES, type AgentRequest, type RequestKind } from '../sim/requests';
import { callLines, lateText, type CallEvent } from '../sim/call';
import { optionCost, review, type ReviewCtx } from '../sim/review';
import { pickAlternative, diverts, type FrictionKind } from '../sim/friction';
import { narrate } from '../sim/narrate';

/** `&money=` / `&fatigue=` / `&mood=` — 상태를 강제해 거절·근거 칩을 스크린샷으로 확인한다. */
export type StatusOverride = Partial<Pick<Status, 'money' | 'fatigue' | 'mood'>> | null;

export type PreviewSpec = PreviewKind & { status: StatusOverride; request: RequestKind | null; call: CallPreview; chat: boolean };

/** `&call=` — 걸려온 벨 / 받은 통화 / 못 받은 발신. */
export type CallPreview = 'in' | 'answered' | 'refused' | null;

type PreviewKind =
  | { kind: 'timetable'; tz: string; hour: number | null; jetlag: boolean; plan: PlanPreview; judge: JudgePreview }
  | { kind: 'sleeping'; tz: string }
  | { kind: 'active'; placeType: PlaceType; tz: string; jetlag: boolean; encounter: EncounterPreview }
  | { kind: 'comic'; tz: string; jetlag: boolean; friction: FrictionKind | null }
  | { kind: 'summary'; gap: boolean }
  | { kind: 'book' }
  | { kind: 'moving'; mode: TransportMode; p: number; onboard: Onboard };

/** What the timetable screen reads besides the phase — swapped in wholesale for `?preview=timetable&tz=…` / `&hour=`. */
/** `&proposal=1` — a friend already planned the next block; `&travel=1` — a travel option is selected (stay chips). */
export type PlanPreview = 'none' | 'proposal' | 'travel';
/** `&judge=` — 확정 직후 에이전트가 반대/거절한 상태를 그대로 그린다 (ADR-0001). */
export type JudgePreview = 'pushback' | 'refuse' | null;
/** `&encounter=talked|seen` — the other agent said hello, or was only ever a silhouette. */
export type EncounterPreview = 'talked' | 'seen' | null;

export interface TimetableWorld { now: number; today: DayKey; plans: Plans; timeline: ScheduledActivity[]; anchor: Anchor; status?: Status }

const MODES: TransportMode[] = ['walk', 'car', 'subway', 'train', 'plane', 'boat'];

export function parsePreview(search: string = typeof location !== 'undefined' ? location.search : ''): PreviewSpec | null {
  const q = new URLSearchParams(search);
  const v = q.get('preview');
  if (!v) return null;
  const [kind, arg = ''] = v.split(':');
  const pRaw = Number(q.get('p') ?? '0.35');
  const p = Number.isFinite(pRaw) ? Math.min(0.98, Math.max(0, pRaw)) : 0.35;
  const tzRaw = q.get('tz');
  const tz = tzRaw && isValidTz(tzRaw) ? tzRaw : ownerTz;
  const jetlag = q.get('jetlag') === '1';
  const hour = (() => {
    const h = q.get('hour');
    if (!h) return null;
    const [hh, mm = '0'] = h.split(':');
    const n = Number(hh) + Number(mm) / 60;
    return Number.isFinite(n) ? Math.min(23.98, Math.max(0, n)) : null;
  })();
  const num = (k: string) => { const v = q.get(k); const n = Number(v); return v !== null && Number.isFinite(n) ? n : undefined; };
  const so: StatusOverride = (() => {
    const money = num('money'), fatigue = num('fatigue'), mood = num('mood');
    return money === undefined && fatigue === undefined && mood === undefined ? null : { money, fatigue, mood };
  })();
  const cv = q.get('call');
  const call: CallPreview = cv === 'in' || cv === 'answered' || cv === 'refused' ? cv : null;
  const chat = q.get('chat') === '1';
  const rq = q.get('request');
  const request: RequestKind | null = rq === 'decide' || rq === 'money' || rq === 'worry' ? rq : null;
  const onboardRaw = q.get('onboard');
  const onboard: Onboard = onboardRaw === 'sleep' || onboardRaw === 'meal' ? onboardRaw : null;
  switch (kind) {
    case 'timetable': {
      const j = q.get('judge');
      return { kind: 'timetable', tz, hour, jetlag, plan: q.get('proposal') === '1' ? 'proposal' : q.get('travel') === '1' ? 'travel' : 'none', judge: j === 'pushback' || j === 'refuse' ? j : null, status: so, request, call, chat };
    }
    case 'sleeping': return { kind: 'sleeping', tz, status: so, request, call, chat };
    case 'comic': {
      const f = q.get('friction');
      const ok: FrictionKind[] = ['closed', 'full', 'weather', 'detour', 'sold-out'];
      return { kind: 'comic', tz, jetlag, friction: ok.includes(f as FrictionKind) ? (f as FrictionKind) : null, status: so, request, call, chat };
    }
    case 'summary': return { kind: 'summary', gap: q.get('gap') === '1', status: so, request, call, chat };
    case 'book': return { kind: 'book', status: so, request, call, chat };
    case 'active': {
      const e = q.get('encounter');
      return { kind: 'active', placeType: (arg || 'park') as PlaceType, tz, jetlag, encounter: e === 'talked' || e === 'seen' ? e : null, status: so, request, call, chat };
    }
    case 'moving': return { kind: 'moving', mode: MODES.includes(arg as TransportMode) ? (arg as TransportMode) : 'walk', p, onboard, status: so, request, call, chat };
    default: return null;
  }
}

// ─── fake activity construction ─────────────────────────────────────────────

const SPEED_KMH: Record<TransportMode, number> = { walk: 4.5, car: 30, subway: 28, train: 150, plane: 760, boat: 30 };
const OVERHEAD_MIN: Record<TransportMode, number> = { walk: 0, car: 4, subway: 10, train: 20, plane: 95, boat: 45 };
const ROAD_FACTOR: Record<TransportMode, number> = { walk: 1.25, car: 1.3, subway: 1.35, train: 1.15, plane: 1, boat: 1.05 };

/** Same maths as sim/journey.ts makeLeg (not exported there) so a mode can be forced for QA. */
function manualLeg(mode: TransportMode, from: Place, to: Place): Leg {
  const distanceKm = haversineKm(from, to) * ROAD_FACTOR[mode];
  const durationMin = Math.max(1, Math.round((distanceKm / SPEED_KMH[mode]) * 60 + OVERHEAD_MIN[mode]));
  const path: [number, number][] = mode === 'plane' || mode === 'boat' ? geodesicPath(from, to, 96) : [[from.lng, from.lat], [to.lng, to.lat]];
  return { mode, fromId: from.id, toId: to.id, path, distanceKm: Math.round(distanceKm * 10) / 10, durationMin, label: MODE_LABEL[mode], refined: false };
}

function journeyFor(mode: TransportMode, from: Place, to: Place): Journey {
  const j = estimateJourney(from, to);
  if (j.legs.length && primaryMode(j) === mode) return j;
  const leg = manualLeg(mode, from, to);
  return { legs: [leg], totalMin: leg.durationMin };
}

type OptionText = { title: string; reason: string; emoji: string; category: Category; friendId?: string };
const DEST: Record<TransportMode, string> = { walk: 'layered-yeonnam', car: 'minsu-home', subway: 'coex', train: 'haeundae', plane: 'hyeopjae', boat: 'canal-city' };
const TITLE: Record<TransportMode, OptionText> = {
  walk: { title: '카페 레이어드 연남에서 그림 그리기', reason: '지난주에 갔던 곳, 창가 자리 좋았음', emoji: '☕', category: 'play' },
  car: { title: '민수네 집에 놀러 가기', reason: '민수가 새 게임 샀다고 함', emoji: '👋', category: 'play', friendId: 'minsu' },
  subway: { title: '코엑스 구경', reason: '지하철 타고 가면 금방', emoji: '🎬', category: 'play' },
  train: { title: '해운대 해수욕장 당일치기', reason: '바다 좋아하니까 바다 보러', emoji: '🏖️', category: 'travel' },
  plane: { title: '한림읍 협재해수욕장 당일치기', reason: '기차 타고 창밖 보는 거 좋아함', emoji: '🏝️', category: 'travel' },
  boat: { title: '캐널시티 하카타 구경하고 오기', reason: '거기 아니면 못 사는 게 있음', emoji: '🛍️', category: 'travel' },
};
/** The long ride used for `&onboard=`: a plane goes all the way to New York so the clocks really drift apart. */
const NY_TRIP: OptionText = { title: '센트럴파크까지 훌쩍 (3박)', reason: '뉴욕 가보고 싶었음', emoji: '✈️', category: 'travel' };

const TYPE_TITLE: Partial<Record<PlaceType, { title: string; emoji: string; category: Category }>> = {
  cafe: { title: '{p}에서 그림 그리기', emoji: '☕', category: 'play' },
  restaurant: { title: '{p}에서 밥 먹기', emoji: '🍚', category: 'meal' },
  park: { title: '{p} 산책', emoji: '🛹', category: 'play' },
  river: { title: '{p}에서 스케이트보드', emoji: '🛹', category: 'play' },
  beach: { title: '{p}까지 가보기', emoji: '🏖️', category: 'travel' },
  gym: { title: '{p}에서 운동', emoji: '🏋️', category: 'exercise' },
  library: { title: '{p}에서 책 읽기', emoji: '📚', category: 'study' },
  mall: { title: '{p} 구경', emoji: '🛍️', category: 'play' },
  museum: { title: '{p} 구경하고 오기', emoji: '🏯', category: 'travel' },
  market: { title: '{p} 구경하기', emoji: '🧺', category: 'play' },
  home: { title: '집에서 게임하기', emoji: '🎮', category: 'play' },
};
const FAKE_PLACE_NAME: Partial<Record<PlaceType, string>> = { restaurant: '연남동 소바집', gym: '홍대 짐', school: '연남초등학교', cinema: '홍대 CGV', arcade: '홍대 오락실', bar: '연남 포차', office: '합정 오피스', temple: '봉원사', market: '망원시장', hotel: '연남 호텔', stadium: '서울월드컵경기장', mountain: '안산', island: '선유도' };

const HUB_TYPES: ReadonlySet<PlaceType> = new Set<PlaceType>(['airport', 'station', 'port']);
/** A place living in `tz` — the first of the preferred types, else any non-hub place there — or null when no city is in that zone. */
function placeInTz(tz: string, prefer: PlaceType[]): Place | null {
  const here = PLACES.filter(p => tzOf(p) === tz && !HUB_TYPES.has(p.type));
  for (const t of prefer) { const p = here.find(x => x.type === t); if (p) return p; }
  return here[0] ?? null;
}

/** A real place of this type (in `tz` when one lives there, else anywhere), else a plausible fake near home. */
function placeOfType(t: PlaceType, tz: string = ownerTz): Place {
  const real = PLACES.find(p => p.type === t && tzOf(p) === tz) ?? PLACES.find(p => p.type === t);
  if (real) return real;
  const home = placeById('home');
  return { id: `preview-${t}`, name: FAKE_PLACE_NAME[t] ?? `연남동 ${t}`, type: t, lng: home.lng + 0.004, lat: home.lat - 0.003, area: '연남동', city: 'seoul', country: 'KR', emoji: '📍' };
}

/** A zone in which `t` reads as one of `hours` (first preference first). Etc/GMT±N covers every whole-hour offset, so one exists. */
function zoneWhereHourIs(t: number, hours: number[]): string {
  for (const h of hours) {
    for (let n = -14; n <= 12; n++) {
      const tz = n === 0 ? 'UTC' : `Etc/GMT${n > 0 ? '+' : '-'}${Math.abs(n)}`;   // Etc/GMT+5 = UTC−5
      if (localParts(t, tz).hour === h) return tz;
    }
  }
  return ownerTz;
}
const ONBOARD_HOURS: Record<'sleep' | 'meal', number[]> = { sleep: [3, 2, 4, 1, 5, 6, 0], meal: [12, 13, 8, 7, 18, 19] };

function fakeAct(place: Place, o: OptionText, journey: Journey, departAt: number, activityMin = 100, originTz = ownerTz, from: Place = placeById('home'), jetlagUntil: number | null = null): ScheduledActivity {
  const blk = blockAtIn(departAt, originTz);
  const blockId: BlockId = blk === 'sleep' ? 'morning' : blk;
  const option: ActivityOption = { id: `preview-${place.id}`, title: o.title, reason: o.reason, emoji: o.emoji, placeId: place.id, category: o.category, friendId: o.friendId };
  const arriveAt = departAt + journey.totalMin * 60_000;
  const endAt = arriveAt + activityMin * 60_000;
  const dayKey = dayKeyIn(departAt, originTz);
  return { key: `${dayKey}:${blockId}`, dayKey, blockIds: [blockId], option, place, fromPlace: from, journey, departAt, arriveAt, endAt, comicUntil: endAt + 8 * 60_000, originTz, tz: tzOf(place), jetlagUntil, companions: o.friendId ? [o.friendId] : [] };
}

function memory() { return useWorld.getState().memory; }

/** Three sample comics so the book/summary can be previewed even when the real book is empty. */
export function previewComics(now: number): { items: DaySummaryItem[]; comics: Comic[] } {
  const home = placeById('home');
  const defs: { id: string; o: OptionText; block: BlockId }[] = [
    { id: 'layered-yeonnam', o: TITLE.walk, block: 'am' },
    { id: 'mangwon-hangang', o: { title: '망원한강공원에서 민수랑 피크닉', reason: '둘 다 좋아하는 곳', emoji: '🧺', category: 'play', friendId: 'minsu' }, block: 'lunch' },
    { id: 'gyeongui-line-forest', o: { title: '경의선숲길 벤치에서 멍때리기', reason: '바람 쐬고 싶음', emoji: '🍃', category: 'rest' }, block: 'pm' },
  ];
  const day = dayStartIn(now, ownerTz);
  const items = defs.map((d, i) => {
    const place = placeById(d.id);
    const j = estimateJourney(home, place);
    const departAt = blockStartAt(day, d.block);
    const act = { ...fakeAct(place, d.o, j, departAt, 90), key: `${dayKeyIn(now, ownerTz)}:${d.block}`, blockIds: [d.block] as BlockId[] };
    const comic = makeComic(act, memory());
    return { blockId: d.block, act, comic: { ...comic, id: `${comic.id}:${i}` } };
  });
  return { items, comics: items.map(i => i.comic).reverse() };
}

/**
 * `?preview=…&tz=…`: a day lived in `tz`. The trip from home is chosen on the departure day's plan (the 07:00 morning
 * block of whichever home-zone day makes it land today — the real timeline resolves the flight, ICN → JFK lands around
 * 13:00 in New York), and the store's own `decide` fills the rest of today with the agent's picks around the arrival
 * place. So the blocks before landing read "비행 중 · 도착하면 뉴욕 시간으로", the landing block is the trip itself and
 * the afternoon is local. `now` is kept after the landing comic — before it the character is on the plane, not waiting.
 */
function previewWorld(now0: number, tz: string, landedYesterday = false): TimetableWorld {
  const home = placeById(memory().homePlaceId);
  const dest = placeInTz(tz, ['park', 'cafe', 'museum']) ?? home;
  const today = dayKeyIn(now0, tz);
  // active/comic/sleeping previews: the trip landed the day before, so today is a whole local day and "now" is now
  const todayStart = dayStartOfKey(today) - (landedYesterday ? DAY_MS : 0);
  const journey = estimateJourney(home, dest);
  const totalMs = journey.totalMin * 60_000;
  // the home-zone morning whose flight lands inside today (the day before, the same date, or — for the far east — the day after)
  const morningOf = (t: number) => blockStartAt(dayStartIn(t, ownerTz), 'morning');
  const candidates = [-1, 0, 1].map(d => morningOf(todayStart + 12 * HOUR_MS + d * DAY_MS));
  const departAt = candidates.find(t => t + totalMs >= todayStart && t + totalMs < todayStart + DAY_MS) ?? candidates[0];
  const depDay = dayKeyIn(departAt, ownerTz);
  const option: ActivityOption = { ...NY_TRIP, id: 'preview-trip', title: `${dest.name}까지 훌쩍 (3박)`, placeId: dest.id, spanBlocks: BLOCK_ORDER.slice(blockIndex('morning')), stayDays: 3 };
  const plans = emptyPlans();
  plans.morning = { blockId: 'morning', category: 'travel', options: [option], chosenId: option.id, chosenBy: 'user', status: 'confirmed' };
  const anchor: Anchor = { placeId: home.id, t: departAt, tz: ownerTz };
  const world: World = { days: { [depDay]: plans }, anchor, memory: memory(), journeys: {}, regen: {}, encounters: {}, requests: [], calls: [], negotiations: {}, messages: [], dueCalls: [] };
  const first = decide(today, world, now0 + 36 * HOUR_MS, now0);
  const trip = first.timeline.find(a => a.option.id === option.id);
  const now = trip && !landedYesterday ? Math.max(now0, trip.comicUntil + 2 * 60_000) : now0;
  if (now !== now0) console.info(`[preview] ${tz}: the trip lands at ${localParts(trip!.arriveAt, tz).hour}:${String(localParts(trip!.arriveAt, tz).minute).padStart(2, '0')} local — "now" moved to just after it`);
  const r = now === now0 ? first : decide(today, world, now + 36 * HOUR_MS, now);
  return { now, today, plans: r.days[today] ?? emptyPlans(), timeline: r.timeline, anchor };
}

/**
 * `?preview=timetable&proposal=1|&travel=1` — today at 08:50 (the 오전 block still ahead), built by hand so the two
 * companion states can be screenshotted without waiting for an agent's day: a friend's own plan pre-filling 오전
 * (`chosenBy: 'friend'`, the card wears "민수가 같이 가자고 해요"), or a travel option selected so the 체류 칩 show.
 */
function planWorld(now0: number, kind: 'proposal' | 'travel'): TimetableWorld {
  const mem = memory();
  const home = placeById(mem.homePlaceId);
  const today = dayKeyIn(now0, ownerTz);
  const dayStart = dayStartIn(now0, ownerTz);
  const now = dayStart + 8 * HOUR_MS + 50 * 60_000;          // 아침 블록 끝자락 — 오전은 아직 안 시작
  const anchor: Anchor = { placeId: home.id, t: dayStart + 7 * HOUR_MS, tz: ownerTz };
  const plans = emptyPlans();
  const ctx = (category: Category) => ({ dateKey: today, blockId: 'am' as BlockId, category, memory: mem, from: home, usedPlaceIds: [] as string[] });
  if (kind === 'proposal') {
    const f = mem.friends[0];
    const agent = agentById(f.id);
    const place = placeById('mangwon-hangang');
    const companion: ActivityOption = {
      id: 'am-friend-' + f.id, title: `${place.name}에서 피크닉`, reason: `${f.name}가 같이 가자고 함`,
      emoji: '🧺', placeId: place.id, category: 'play', friendId: f.id, proposedBy: agent?.id ?? f.id,
    };
    const rest = suggestOptions(ctx('play')).filter(o => o.placeId !== place.id).slice(0, 2);
    plans.am = { blockId: 'am', category: 'play', options: [companion, ...rest], chosenId: companion.id, chosenBy: 'friend', status: 'confirmed' };
  } else {
    const options = suggestOptions(ctx('travel'));
    const chosen = options.find(o => (o.stayDays ?? 0) > 0) ?? options[0];
    plans.am = { blockId: 'am', category: 'travel', options, chosenId: chosen?.id ?? null, chosenBy: 'user', status: chosen ? 'confirmed' : 'proposed' };
  }
  const days = { [today]: plans };
  const timeline = buildTimeline(anchor, days, mem, {}, now + 3 * DAY_MS, {});
  return { now, today, plans, timeline, anchor };
}

/**
 * `?preview=timetable&judge=…` — 오늘 오전 블록을 고른 직후, 에이전트가 반대(pushback)하거나
 * 거절(refuse)한 상태. 판정을 손으로 만들지 않고 **진짜 review()를 돌려** 얻는다: 그래야 화면이
 * 실제 규칙과 어긋나지 않는다. 반대는 돈을 살짝 모자라게, 거절은 체력을 하한 아래로 만들어 유도한다.
 */
function judgeWorld(now0: number, judge: 'pushback' | 'refuse'): TimetableWorld {
  const mem = memory();
  const home = placeById(mem.homePlaceId);
  const today = dayKeyIn(now0, ownerTz);
  const dayStart = dayStartIn(now0, ownerTz);
  const now = dayStart + 8 * HOUR_MS + 50 * 60_000;           // 아침 끝자락 — 오전은 아직 안 시작
  const blockStart = blockStartAt(dayStart, 'am'), blockEnd = blockEndAt(dayStart, 'am');
  const anchor: Anchor = { placeId: home.id, t: dayStart + 7 * HOUR_MS, tz: ownerTz, status: INITIAL_STATUS };
  const category: Category = judge === 'pushback' ? 'meal' : 'play';
  const options = suggestOptions({ dateKey: today, blockId: 'am', category, memory: mem, from: home, usedPlaceIds: [] });
  const target = options[0];

  const base: ReviewCtx = { dayKey: today, status: INITIAL_STATUS, memory: mem, from: home, blockId: 'am', blockStart, blockEnd };
  // 반대: 그 옵션 값보다 4,200원 모자라게 / 거절: 체력 하한 아래로
  const status: Status = judge === 'pushback'
    ? { ...INITIAL_STATUS, money: Math.max(1, optionCost(target, base).cost - 4_200) }
    : { ...INITIAL_STATUS, fatigue: 96 };
  const verdict = review(target, { ...base, status }, options);

  const plans = emptyPlans();
  plans.am = { blockId: 'am', category, options, chosenId: null, chosenBy: null, status: verdict?.kind === 'refuse' ? 'refused' : 'pushback', verdict: verdict ?? undefined };
  const timeline = buildTimeline(anchor, { [today]: plans }, mem, {}, now + DAY_MS, {});
  return { now, today, plans, timeline, anchor, status };
}

interface PreviewBase { spec: PreviewSpec; act?: ScheduledActivity; comic?: Comic; now0: number; world?: TimetableWorld }

function buildPreview(spec: PreviewSpec, now0: number): PreviewBase {
  const home = placeById('home');
  switch (spec.kind) {
    case 'moving': {
      const abroad = spec.onboard !== null && spec.mode === 'plane';
      const dest = placeById(abroad ? 'central-park' : DEST[spec.mode]);
      const journey = journeyFor(spec.mode, home, dest);
      const departAt = now0 - spec.p * journey.totalMin * 60_000;
      // on board the character keeps the origin's blocks: pick an origin zone in which "now" is the wanted block
      const originTz = spec.onboard ? zoneWhereHourIs(now0, ONBOARD_HOURS[spec.onboard]) : ownerTz;
      return { spec, now0, act: fakeAct(dest, abroad ? NY_TRIP : TITLE[spec.mode], journey, departAt, 100, originTz) };
    }
    case 'active': {
      const world = spec.tz === ownerTz ? undefined : previewWorld(now0, spec.tz, true);
      const place = placeOfType(spec.placeType, spec.tz);
      const tt = TYPE_TITLE[spec.placeType] ?? { title: `{p}에서 시간 보내기`, emoji: place.emoji, category: 'play' as Category };
      const o = { title: tt.title.replace('{p}', place.name), reason: '오늘은 여기가 끌렸음', emoji: tt.emoji, category: tt.category, friendId: place.type === 'friend_home' ? 'minsu' : undefined };
      const from = placeInTz(spec.tz, ['hotel', 'home']) ?? home;
      const journey = estimateJourney(from, place);
      const departAt = now0 - (journey.totalMin + 35) * 60_000;
      const act = fakeAct(place, o, journey, departAt, 100, spec.tz, from, spec.jetlag ? now0 + 20 * HOUR_MS : null);
      // 마주침 미리보기: 말을 건 상대(새 친구)거나, 스쳐 지나간 실루엣 하나
      const other = AGENTS.find(a => !memory().friends.some(f => f.id === a.id));
      const encounter = spec.encounter && other ? { agentId: other.id, talked: spec.encounter === 'talked' } : undefined;
      return { spec, now0, act: { ...act, tz: spec.tz, encounter }, world };
    }
    case 'comic': {
      const world = spec.tz === ownerTz ? undefined : previewWorld(now0, spec.tz, true);
      const place = placeOfType('cafe', spec.tz);
      const from = placeInTz(spec.tz, ['hotel', 'home']) ?? home;
      const journey = estimateJourney(from, place);
      const o = spec.tz === ownerTz ? { ...TITLE.walk, friendId: 'minsu' } : { ...TYPE_TITLE.cafe!, title: TYPE_TITLE.cafe!.title.replace('{p}', place.name), reason: '오늘은 여기가 끌렸음' };
      const act0 = { ...fakeAct(place, o, journey, now0 - (journey.totalMin + 100) * 60_000, 100, spec.tz, from, spec.jetlag ? now0 + 20 * HOUR_MS : null), tz: spec.tz };
      // `&friction=` — 계획한 곳에서 발길을 돌린 하루를 그대로 만든다 (sim/friction.ts와 같은 모양)
      const alt = spec.friction && diverts(spec.friction) ? pickAlternative(place, act0.key, spec.friction) : null;
      const act = spec.friction
        ? {
          ...act0,
          place: alt ?? act0.place,
          outcome: {
            kind: spec.friction, plannedPlaceId: place.id, plannedTitle: act0.option.title, divertedAt: act0.arriveAt,
            line: narrate({ t: 'friction', kind: spec.friction, planned: place, actual: alt ?? undefined }, { name: memory().name, seed: act0.key }),
          },
        }
        : act0;
      return { spec, now0, act, comic: makeComic(act, memory()), world };
    }
    case 'sleeping':
      return { spec, now0, world: spec.tz === ownerTz ? undefined : previewWorld(now0, spec.tz, true) };
    case 'timetable': {
      if (spec.judge) return { spec, now0, world: judgeWorld(now0, spec.judge) };
      if (spec.plan !== 'none') return { spec, now0, world: planWorld(now0, spec.plan) };
      const now = spec.hour === null ? now0 : dayStartIn(now0, spec.tz) + spec.hour * HOUR_MS;
      if (spec.tz === ownerTz && spec.hour === null) return { spec, now0 };
      if (spec.tz === ownerTz) {
        const s = useWorld.getState();
        return { spec, now0, world: { now, today: s.today, plans: s.plans, timeline: s.timeline, anchor: s.anchor } };
      }
      return { spec, now0, world: previewWorld(now, spec.tz) };
    }
    default:
      return { spec, now0 };
  }
}

/** The forced phase for `?preview=`, the faked day around it (`&tz=`; the timetable screen and sheet read it) and, for a
 *  `timetable` preview with its own moment, that moment. Ticks with the sim clock (moving/active progress) but never
 *  writes the store. */
/** undefined 필드를 걷어낸다 (Partial 스프레드가 기존 값을 지우지 않게). */
const strip = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** 스토어의 지금 상태로 만든 최소 world — `?preview=timetable&money=` 처럼 world가 없는 조합에 쓴다. */
const storeWorld = (): TimetableWorld => {
  const s = useWorld.getState();
  return { now: s.now, today: s.today, plans: s.plans, timeline: s.timeline, anchor: s.anchor, status: s.status };
};

export function usePreview(): { phase: Phase | null; world: TimetableWorld | null; now: number | null } {
  const spec = useMemo(() => parsePreview(), []);
  const now = useWorld(s => s.now);
  const now0 = useRef(now).current;
  const base = useMemo(() => (spec ? buildPreview(spec, now0) : null), [spec, now0]);
  if (!base) return { phase: null, world: null, now: null };
  const world = base.world ?? null;
  const phase = ((): Phase => {
    switch (base.spec.kind) {
      case 'moving': {
        const act = base.act!;
        return movingPhase(Math.min(now, act.arriveAt - 500), act);
      }
      case 'active': {
        const act = base.act!;
        const t = Math.min(now, act.endAt - 60_000);
        return { kind: 'active', act, remainingMin: Math.max(1, Math.ceil((act.endAt - t) / 60_000)), progress: (t - act.arriveAt) / Math.max(1, act.endAt - act.arriveAt), tz: act.tz, jetlag: base.spec.jetlag, companions: companionsOf(act, memory()), encounter: encounterOf(act, memory()) };
      }
      case 'comic':
        return { kind: 'comic', act: base.act!, comic: base.comic!, tz: base.act!.tz, jetlag: base.spec.jetlag, companions: companionsOf(base.act!, memory()), encounter: encounterOf(base.act!, memory()) };
      case 'sleeping': {
        const tz = base.spec.tz;
        const at = placeInTz(tz, ['home', 'hotel']) ?? placeById('home');
        return { kind: 'sleeping', until: blockEndAt(dayStartIn(now, tz), 'sleep'), at, tz };
      }
      case 'timetable': {
        const tz = base.spec.tz;
        if (world) {
          const t = world.now;
          let jetlag = base.spec.jetlag;
          for (const a of world.timeline) if (a.arriveAt <= t) jetlag = base.spec.jetlag || (a.jetlagUntil !== null && t < a.jetlagUntil);
          const at = currentPlaceAt(t, world.timeline, world.anchor);
          const blk = blockAtIn(t, tz);
          const nb = nextBlockId(blk);
          const upcoming = world.timeline.find(a => a.departAt > t);
          return { kind: 'waiting', at, currentBlockId: blk, nextBlockId: nb, nextStartAt: upcoming ? upcoming.departAt : nb ? blockStartAt(dayStartIn(t, tz), nb) : null, tz, jetlag, companions: [] };
        }
        const blk = blockAtIn(now, tz);
        const nb = nextBlockId(blk);
        return { kind: 'waiting', at: placeById('home'), currentBlockId: blk, nextBlockId: nb, nextStartAt: nb ? blockStartAt(dayStartIn(now, tz), nb) : null, tz, jetlag: base.spec.jetlag, companions: [] };
      }
      default: {
        const blk = blockAtIn(now, ownerTz);
        const nb = nextBlockId(blk);
        return { kind: 'waiting', at: placeById('home'), currentBlockId: blk, nextBlockId: nb, nextStartAt: nb ? blockStartAt(dayStartIn(now, ownerTz), nb) : null, tz: ownerTz, jetlag: false, companions: [] };
      }
    }
  })();
  // 상태 강제(`&money=`…): world가 없으면 스토어 값에서 하나 만들어 얹는다 — 화면은 world.status를 먼저 본다
  const forced = base.spec.status;
  const withStatus = forced
    ? { ...(world ?? storeWorld()), status: { ...(world?.status ?? useWorld.getState().status ?? INITIAL_STATUS), ...strip(forced) } }
    : world;
  return { phase, world: withStatus, now: base.spec.kind === 'timetable' && world ? world.now : null };
}

/** How long the fake `?preview=summary&gap=1` owner was away — long enough that the band reads as a real absence. */
const PREVIEW_GAP_MS = 11 * HOUR_MS + 8 * 60_000;

/** Overlays forced by `?preview=summary|book` (fake content when the real book is empty). */
/** `&request=` — 쪽지 하나를 강제로 띄운다 (ADR-0001 §1). */
function fakeRequest(kind: RequestKind, now: number): AgentRequest {
  const common = { at: now, dueAt: now + 2 * HOUR_MS, told: false };
  if (kind === 'worry') {
    return { ...common, id: 'preview:worry', kind, line: '오늘 너 좀 조용하네. 뭐 때문인지 하나만 골라줘.', choices: WORRY_CHOICES };
  }
  if (kind === 'money') {
    return { ...common, id: 'preview:money', kind, line: `이번 주 ${wonKo(12_400)} 남았어. 좀 아껴도 돼?`, choices: [{ id: 'save', label: '응, 아껴' }, { id: 'spend', label: '그냥 하고 싶은 거 해', isDefault: true }] };
  }
  return { ...common, id: 'preview:decide', kind, refId: 'evening', line: '저녁 블록 아직 비었는데, 네가 정할래?', choices: [{ id: 'mine', label: '내가 정할게' }, { id: 'yours', label: '네가 골라', isDefault: true }] };
}

/** `&call=` — 통화 하나를 강제로 띄운다. */
function fakeCall(kind: 'in' | 'answered' | 'refused', now: number): CallEvent {
  if (kind === 'refused') return { id: 'preview:out', at: now, dir: 'out', result: 'refused', block: 'quiet', text: lateText('quiet', 'preview:out') };
  const lines = callLines('cafe', 'preview:in', undefined);
  return kind === 'in'
    ? { id: 'preview:in', at: now, dir: 'in', result: 'missed', lines }
    : { id: 'preview:in', at: now, dir: 'in', result: 'answered', lines };
}

export function usePreviewOverlay(): { summary: DaySummaryItem[] | null; book: Comic[] | null; gap: { from: number; to: number } | null; request: AgentRequest | null; call: CallEvent | null; chat: boolean } {
  const spec = useMemo(() => parsePreview(), []);
  const realBook = useWorld(s => s.book);
  const now0 = useRef(useWorld.getState().now).current;
  return useMemo(() => {
    const request = spec?.request ? fakeRequest(spec.request, now0) : null;
    const call = spec?.call ? fakeCall(spec.call, now0) : null;
    const chat = spec?.chat ?? false;
    if (!spec || (spec.kind !== 'summary' && spec.kind !== 'book')) return { summary: null, book: null, gap: null, request, call, chat };
    const fake = previewComics(now0);
    if (spec.kind === 'summary') return { summary: fake.items, book: null, gap: spec.gap ? { from: now0 - PREVIEW_GAP_MS, to: now0 } : null, request, call, chat };
    return { summary: null, book: realBook.length ? [...realBook].reverse() : fake.comics, gap: null, request, call, chat };
  }, [spec, realBook, now0]);
}
