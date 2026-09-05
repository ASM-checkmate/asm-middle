import type { Anchor, Category, DayKey, Leg, Memory, Place, PlaceType, ScheduledActivity } from './types';
import { splitDayKey } from './types';
import { DAY_MS, dayKeyIn, dayStartOfKey } from './tz';

// ─── 누적 상태 (SPEC 상태, docs/adr/0001-agentness.md) ───────────────────────
// 오늘의 행동이 내일을 제약해야 시간이 실재한다. 상태는 새 저장소가 아니라 **타임라인의 접기**다:
// anchor에 구워진 값에서 시작해 그 뒤 끝난 활동들을 순서대로 더한다. 순수 함수이므로 공백을
// 며칠씩 한 번에 재생해도 같은 값이 나오고, prune()이 anchor를 옮길 때 거기까지의 접기 결과를
// 다시 구우면 5일 창이 굴러가도 지갑이 리셋되지 않는다.

/** 접기로 만들어지는 캐릭터의 수량 상태. `Memory`가 "정체성"이라면 이쪽은 "수량"이다. */
export interface Status {
  /** 지갑 (원). 매달 현지 1일에 용돈이 들어온다. 밀어붙이면 마이너스가 될 수 있다. */
  money: number;
  /** 피로 0–100. 활동과 이동이 올리고 수면과 쉬기가 내린다. */
  fatigue: number;
  /** 기분 0–100 (50 = 평온). 취향 일치·동행이 올리고 dislikes는 내린다. */
  mood: number;
  /** friendId → 친밀도 0–100. 같이 보낸 시간과 조율 결과로 움직인다. */
  affinity: Record<string, number>;
  /** 마지막으로 용돈이 들어온 달 (`2026-09`) — 재생해도 두 번 들어오지 않게 한다. */
  paidMonth: string;
}

/** 상태에 더해지는 변화량. 없는 키는 그대로 둔다. */
export interface StatusDelta {
  money?: number;
  fatigue?: number;
  mood?: number;
  affinity?: Record<string, number>;
}

export const INITIAL_STATUS: Status = { money: 620_000, fatigue: 22, mood: 58, affinity: {}, paidMonth: '' };

/** 현지 1일에 들어오는 용돈. 하루 2만원쯤 — 동네는 넉넉하고 여행 한 번이면 그 달이 빠듯하다. */
export const MONTHLY_ALLOWANCE = 600_000;
/** 하루가 넘어갈 때 한 번 적용되는 회복. */
export const SLEEP_RECOVERY: StatusDelta = { fatigue: -46, mood: 6 };
/** 기분은 하루마다 평온(50) 쪽으로 이만큼 끌린다 — 좋은 날도 나쁜 날도 오래 가지 않는다. */
const MOOD_DRIFT = 4;
/** `work` 범주의 시급. 돈을 버는 유일한 범주다. */
const WAGE_PER_HOUR = 12_000;
/** 한 번에 세는 밤의 상한 (긴 공백을 한 번에 재생할 때 회복이 무한정 쌓이지 않게). */
const MAX_NIGHTS = 7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v);

// ─── 장소 비용 ───────────────────────────────────────────────────────────────
/** 장소 유형별 비용: 들어가면 드는 돈(base) + 머무는 시간에 비례하는 돈(perHour). 없는 유형은 공짜. */
const COST: Partial<Record<PlaceType, { base: number; perHour: number }>> = {
  cafe: { base: 5_500, perHour: 1_500 },
  restaurant: { base: 11_000, perHour: 2_000 },
  bar: { base: 18_000, perHour: 8_000 },
  cinema: { base: 14_000, perHour: 0 },
  arcade: { base: 6_000, perHour: 6_000 },
  gym: { base: 3_000, perHour: 0 },
  mall: { base: 0, perHour: 9_000 },
  market: { base: 0, perHour: 6_000 },
  museum: { base: 8_000, perHour: 0 },
  stadium: { base: 22_000, perHour: 0 },
  hotel: { base: 95_000, perHour: 0 },
  friend_home: { base: 4_000, perHour: 0 },   // 손에 뭐라도 들고 간다
};
const FREE = { base: 0, perHour: 0 };

/** 시간당 피로. 범주가 몸을 얼마나 쓰는지로 정한다. */
const FATIGUE_PER_HOUR: Record<Category, number> = {
  sleep: 0, meal: 2, play: 5, exercise: 14, study: 6, work: 7, rest: -4, travel: 8,
};

/** 이동 수단별 요금과 피로. 요금은 거리에, 피로는 시간에 (걷기만 거리에) 비례한다. */
const FARE: Record<Leg['mode'], { base: number; perKm: number; fatiguePerHour: number; fatiguePerKm: number }> = {
  walk: { base: 0, perKm: 0, fatiguePerHour: 0, fatiguePerKm: 3.2 },
  car: { base: 4_800, perKm: 900, fatiguePerHour: 1.5, fatiguePerKm: 0 },
  subway: { base: 1_400, perKm: 90, fatiguePerHour: 3.5, fatiguePerKm: 0 },
  train: { base: 0, perKm: 140, fatiguePerHour: 2, fatiguePerKm: 0 },
  plane: { base: 30_000, perKm: 190, fatiguePerHour: 3, fatiguePerKm: 0 },
  boat: { base: 8_000, perKm: 120, fatiguePerHour: 2.5, fatiguePerKm: 0 },
};

/**
 * 이동 한 번의 요금 상한. 실제 뉴욕 항공권은 150만원이 넘지만 그러면 해외는 영영 못 간다 —
 * 캐릭터는 마일리지·특가로 간다고 보고, 한 번의 여정이 이 값을 넘지 않게 자른다.
 */
export const JOURNEY_FARE_CAP = 260_000;

/** 이동 구간 하나의 요금 (원, 양수). */
const fareOf = (leg: Leg) => FARE[leg.mode].base + FARE[leg.mode].perKm * leg.distanceKm;

/** 여정 전체의 요금 — 상한으로 자른다. */
const journeyFare = (legs: Leg[]) => Math.min(JOURNEY_FARE_CAP, legs.reduce((n, l) => n + fareOf(l), 0));

/** 이동 구간 하나가 남기는 피로. */
const legFatigue = (leg: Leg) => FARE[leg.mode].fatiguePerHour * (leg.durationMin / 60) + FARE[leg.mode].fatiguePerKm * leg.distanceKm;

/**
 * 이 활동에 드는 돈 — 이동 요금 + 장소 비용 − (일이면) 번 돈.
 * 거절 판단과 "밀어붙이면 이만큼 없어져" 표시가 이 값을 읽는다.
 *
 * @param category 그 블록의 범주
 * @param place 실제로 가는 곳
 * @param legs 거기까지의 이동 구간들
 * @param stayMin 그 장소에 머무는 분
 * @returns 나가는 돈 (원). 버는 활동이면 음수가 나온다.
 */
export function costOf(category: Category, place: Place, legs: Leg[], stayMin: number): number {
  const c = COST[place.type] ?? FREE;
  const hours = Math.max(0, stayMin) / 60;
  const spend = c.base + c.perHour * hours;
  const fare = journeyFare(legs);
  const earn = category === 'work' ? WAGE_PER_HOUR * hours : 0;
  return round(spend + fare - earn);
}

// ─── 활동 하나의 효과 ────────────────────────────────────────────────────────
const mentions = (list: string[], text: string) => list.some(k => k && text.includes(k));

/**
 * 활동 하나가 상태에 남기는 것: 돈, 피로, 취향에 따른 기분, 동행 친밀도.
 *
 * @param a 끝난 활동
 * @param memory 취향(likes/dislikes)을 읽는다
 * @returns 더해질 변화량. 돈은 음수가 지출이다.
 */
export function actDelta(a: ScheduledActivity, memory: Memory): StatusDelta {
  const stayMin = Math.max(0, (a.endAt - a.arriveAt) / 60_000);
  const hours = stayMin / 60;
  const category = a.option.category;

  const money = -costOf(category, a.place, a.journey.legs, stayMin);
  let fatigue = FATIGUE_PER_HOUR[category] * hours;
  for (const leg of a.journey.legs) fatigue += legFatigue(leg);

  const text = `${a.option.title} ${a.option.reason} ${a.place.name}`;
  let mood = 0;
  if (mentions(memory.likes, text)) mood += 6;
  if (mentions(memory.dislikes, text)) mood -= 10;
  if (a.companions.length) mood += 5;

  const affinity: Record<string, number> = {};
  for (const id of a.companions) affinity[id] = 4 * Math.max(1, hours);
  // 말을 튼 마주침은 그 자리에서 친해진다 (FRIENDS_SPEC §4)
  if (a.encounter?.talked) affinity[a.encounter.agentId] = (affinity[a.encounter.agentId] ?? 0) + 6;

  return { money, fatigue, mood, affinity };
}

/** 상태에 변화량을 더한다. 피로·기분·친밀도는 범위로 자르고, 돈만 음수를 허용한다 (밀어붙인 대가). */
export function applyDelta(s: Status, d: StatusDelta): Status {
  const affinity = d.affinity ? { ...s.affinity } : s.affinity;
  if (d.affinity) for (const [id, n] of Object.entries(d.affinity)) affinity[id] = clamp((affinity[id] ?? 0) + n, 0, 100);
  return {
    ...s,
    money: round(s.money + (d.money ?? 0)),
    fatigue: clamp(s.fatigue + (d.fatigue ?? 0), 0, 100),
    mood: clamp(s.mood + (d.mood ?? 0), 0, 100),
    affinity,
  };
}

/** `2026-09-04@Asia/Seoul` → `2026-09` */
const monthOf = (key: DayKey) => splitDayKey(key).dateKey.slice(0, 7);

/** 현지 1일이 지났으면 용돈을 넣는다. `paidMonth`가 재생 시 중복 지급을 막는다. */
function payAllowance(s: Status, month: string): Status {
  if (!month || s.paidMonth === month) return s;
  // 첫 접기(paidMonth가 비어 있음)는 달만 기록한다 — 시작 잔액이 곧 그 달의 몫이다
  const money = s.paidMonth ? s.money + MONTHLY_ALLOWANCE : s.money;
  return { ...s, money: round(money), paidMonth: month };
}

/** 밤 하나: 자고 일어나 피로가 풀리고 기분이 평온 쪽으로 돌아온다. */
function passNight(s: Status): Status {
  const next = applyDelta(s, SLEEP_RECOVERY);
  const pull = next.mood > 50 ? -MOOD_DRIFT : next.mood < 50 ? MOOD_DRIFT : 0;
  return { ...next, mood: clamp(next.mood + pull, 0, 100) };
}

/** 두 날 사이에 지나간 밤의 수 (같은 날이면 0). 긴 공백은 MAX_NIGHTS로 자른다. */
const nightsBetween = (from: DayKey, to: DayKey) =>
  clamp(Math.round((dayStartOfKey(to) - dayStartOfKey(from)) / DAY_MS), 0, MAX_NIGHTS);

/**
 * 상태 접기. anchor에 구워진 값에서 시작해 `until` 이전에 끝난 활동을 순서대로 더한다.
 * 활동 사이에 날이 바뀌면 그만큼 밤을 세고, 달이 바뀌면 용돈을 넣는다.
 * 같은 입력이면 언제나 같은 출력이다 — 공백 일괄 계산 재생이 여기에 기댄다.
 *
 * @param anchor 타임라인의 시작 상태 (`anchor.status`가 없으면 INITIAL_STATUS부터)
 * @param acts 앵커 이후의 활동들 (순서는 상관없다 — 내부에서 종료 순으로 정렬한다)
 * @param until 이 순간까지 접는다 (보통 블록 시작 시각이나 now)
 * @param memory 취향을 읽는다
 * @returns 새 Status. 입력을 변형하지 않는다.
 */
export function foldStatus(anchor: Anchor, acts: ScheduledActivity[], until: number, memory: Memory): Status {
  let s = anchor.status ?? INITIAL_STATUS;
  let day = dayKeyIn(anchor.t, anchor.tz);
  s = payAllowance(s, monthOf(day));
  const done = acts.filter(a => a.endAt <= until).sort((a, b) => a.endAt - b.endAt);
  for (const a of done) {
    if (a.dayKey !== day) {
      for (let n = nightsBetween(day, a.dayKey); n > 0; n--) s = passNight(s);
      s = payAllowance(s, monthOf(a.dayKey));
      day = a.dayKey;
    }
    s = applyDelta(s, actDelta(a, memory));
  }
  return s;
}

/** 저장된 값이 Status 모양인지 확인한다. 아니면 undefined (호출부가 초기값을 쓴다). */
export function validStatus(raw: unknown): Status | undefined {
  const s = raw as Partial<Status> | null;
  if (!s || typeof s !== 'object') return undefined;
  const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
  const affinity: Record<string, number> = {};
  if (s.affinity && typeof s.affinity === 'object') {
    for (const [k, v] of Object.entries(s.affinity)) if (typeof v === 'number' && Number.isFinite(v)) affinity[k] = clamp(v, 0, 100);
  }
  return {
    money: n(s.money, INITIAL_STATUS.money),
    fatigue: clamp(n(s.fatigue, INITIAL_STATUS.fatigue), 0, 100),
    mood: clamp(n(s.mood, INITIAL_STATUS.mood), 0, 100),
    affinity,
    paidMonth: typeof s.paidMonth === 'string' ? s.paidMonth : '',
  };
}

/**
 * 친밀도를 읽는다. 기록이 없으면 시작값을 준다 — 처음부터 친구는 이미 가깝고,
 * 마주쳐서 새로 된 친구는 아직 서먹하다.
 *
 * @param s 지금 상태
 * @param friend 친구 (없으면 0)
 * @returns 0–100
 */
export const affinityOf = (s: Status, friend?: { id: string; metAt?: number }) => {
  if (!friend) return 0;
  return s.affinity[friend.id] ?? (friend.metAt === undefined ? 45 : 25);
};

/** "12,400원" — 근거 칩과 대사의 표기. 마이너스면 "−3,200원". */
export const wonKo = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(round(n)).toLocaleString('ko-KR')}원`;
