// ─── theworld domain types ──────────────────────────────────────────────────
// Everything the simulation, map and screens share. Keep this file dependency-free.

import type { Agent } from './agents';

export type BlockId = 'sleep' | 'morning' | 'am' | 'lunch' | 'pm' | 'evening' | 'night';

/** Big categories the user assigns to a block. `sleep` is only ever on the sleep block. */
export type Category = 'sleep' | 'meal' | 'play' | 'exercise' | 'study' | 'work' | 'rest' | 'travel';

export type TransportMode = 'walk' | 'car' | 'subway' | 'train' | 'plane' | 'boat';

export type PlaceType =
  | 'home' | 'friend_home' | 'cafe' | 'restaurant' | 'park' | 'gym' | 'school' | 'library' | 'cinema'
  | 'mall' | 'river' | 'beach' | 'museum' | 'arcade' | 'bar' | 'office' | 'station' | 'airport' | 'port'
  | 'temple' | 'market' | 'hotel' | 'stadium' | 'mountain' | 'island';

export interface LngLat { lng: number; lat: number }

export interface Place {
  id: string;
  name: string;            // 실제 이름 (한글)
  type: PlaceType;
  lng: number;
  lat: number;
  area: string;            // 동네 (연남동, 해운대…)
  city: string;            // 도시 키 (seoul, busan, jeju, tokyo, newyork…)
  country: string;         // ISO-ish (KR, JP, US…)
  emoji: string;
  /** How you get to this place from another city; default is decided by distance. */
  reachBy?: 'boat' | 'plane' | 'train';
  /** `friend_home` only: the agent whose home this is (FRIENDS_SPEC — a friend's home is only ever suggested through them). */
  ownerFriendId?: string;
}

/** A city's transport hubs used to build multi-leg journeys. */
export interface CityHubs { station?: string; airport?: string; port?: string }

/** A friend in the character's memory. Every friend is also an `Agent` (src/sim/agents.ts) living its own day. */
export interface Friend {
  id: string; name: string; homePlaceId: string; color: string; emoji: string;
  /** when we became friends (a talked encounter) — their home is only suggested from the next day on */
  metAt?: number;
  metPlaceId?: string;
}

export interface Memory {
  name: string;                 // 캐릭터 이름
  likes: string[];
  dislikes: string[];
  traits: string[];
  homePlaceId: string;
  friends: Friend[];
  visited: { placeId: string; at: number }[];
}

// ─── days & zones (TIMEZONE_SPEC) ───────────────────────────────────────────
/** `${dateKey}@${tz}` — one lived day. The same calendar date in another zone is a different day. */
export type DayKey = string;
export const makeDayKey = (dateKey: string, tz: string): DayKey => `${dateKey}@${tz}`;
export const splitDayKey = (key: DayKey): { dateKey: string; tz: string } => {
  const i = key.indexOf('@');
  return i < 0 ? { dateKey: key, tz: 'UTC' } : { dateKey: key.slice(0, i), tz: key.slice(i + 1) };
};

/** Where the timeline starts: the character's place, the moment, and the zone it lives in. */
export interface Anchor { placeId: string; t: number; tz: string }

export interface ActivityOption {
  id: string;
  title: string;        // "연남동 카페에서 그림 그리기"
  reason: string;       // "지난주에 갔던 곳, 창가 자리 좋았음" — memory-based justification
  emoji: string;
  placeId: string;
  category: Category;
  /** If set, this activity spans these consecutive blocks (trips). Defaults to the block it was offered in. */
  spanBlocks?: BlockId[];
  /** Trips: nights spent there before the agent books the way home (0 = 당일치기). */
  stayDays?: number;
  friendId?: string;
  /** the friend whose own plan pre-filled this block (FRIENDS_SPEC §2) — the option card shows "같이 가자고 해요" */
  proposedBy?: string;
}

export interface BlockPlan {
  blockId: BlockId;
  category: Category | null;
  options: ActivityOption[];
  chosenId: string | null;
  /** who decided: the owner, the agent at block start, or a friend who planned first (`chosenBy: 'friend'`) */
  chosenBy: 'user' | 'agent' | 'friend' | null;
}

export interface Leg {
  mode: TransportMode;
  fromId: string;
  toId: string;
  /** [lng, lat][] — straight/geodesic estimate first, refined with real streets when routing resolves */
  path: [number, number][];
  distanceKm: number;
  durationMin: number;
  label: string;        // "걸어서", "KTX 서울 → 부산", "2호선"
  refined: boolean;     // true once real routing has replaced the path
}

export interface Journey { legs: Leg[]; totalMin: number }

export interface ScheduledActivity {
  key: string;               // `${dayKey}:${blockId}` — unique even when a date is lived twice (two zones)
  dayKey: DayKey;            // the day it was planned in (its departure block belongs to this day)
  blockIds: BlockId[];       // blocks of `dayKey` the option spans
  option: ActivityOption;
  place: Place;
  fromPlace: Place;
  journey: Journey;
  departAt: number;          // ms
  arriveAt: number;          // ms
  endAt: number;             // ms  (activity end → comic)
  comicUntil: number;        // ms  (comic shown until here, then waiting)
  originTz: string;          // zone the character left in — the journey's blocks (sleep, meals) follow it
  tz: string;                // zone of the destination — the character's zone from arriveAt on
  jetlagUntil: number | null;// "시차 적응 중" until here (24 h after a ≥ 3 h zone jump), else null
  /** friend ids going along (from `option.friendId`) — companionship is data, never copy (FRIENDS_SPEC 동행 표시 규칙) */
  companions: string[];
  /** another agent was at the same place for ≥ 30 min; `talked` = the talk roll succeeded (FRIENDS_SPEC §4) */
  encounter?: Encounter;
}

/** 마주침: someone else's agent shared this place. `talked` → a new friend when the activity ends; `again` → already a friend. */
export interface Encounter { agentId: string; talked: boolean; again?: boolean }

export interface ComicPanel {
  caption: string;
  beat: 'arrive' | 'doing' | 'twist' | 'end';
  withFriend?: boolean;
  bg: string;                // token colour for the panel ground
}

export interface Comic {
  id: string;
  blockId: BlockId;
  dateKey: string;
  title: string;             // "카페 어라운드에서 생긴 일"
  placeName: string;
  placeType: PlaceType;
  createdAt: number;
  panels: ComicPanel[];      // 1 or 4
  summary: string;           // one-line summary for the catch-up sheet
}

/** What the character does on board during a journey: sleeps in the sleep block, eats in meal blocks (train/plane/boat only). */
export type Onboard = 'sleep' | 'meal' | null;

/** The encounter of a phase, resolved for the screens: who it was, and whether we ended up talking. */
export interface PhaseEncounter { agent: Agent; talked: boolean; again?: boolean }

/**
 * Every phase carries `tz`, the zone the screens draw the clock and block times in (the character's local time).
 * active/comic/moving carry the activity's `companions` (resolved friends) and its `encounter`; waiting carries the
 * companions of the activity it is waiting for.
 */
export type Phase =
  | { kind: 'sleeping'; until: number; at: Place; tz: string }
  | { kind: 'waiting'; at: Place; currentBlockId: BlockId; nextBlockId: BlockId | null; nextStartAt: number | null; tz: string; jetlag: boolean; companions: Friend[] }
  | { kind: 'moving'; act: ScheduledActivity; legIndex: number; legProgress: number; position: LngLat; heading: number; remainingMin: number; totalProgress: number; tz: string; onboard: Onboard; companions: Friend[]; encounter?: PhaseEncounter }
  | { kind: 'active'; act: ScheduledActivity; remainingMin: number; progress: number; tz: string; jetlag: boolean; companions: Friend[]; encounter?: PhaseEncounter }
  | { kind: 'comic'; act: ScheduledActivity; comic: Comic; tz: string; jetlag: boolean; companions: Friend[]; encounter?: PhaseEncounter };

export interface DaySummaryItem { blockId: BlockId; comic: Comic; act: ScheduledActivity }
