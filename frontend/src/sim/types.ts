// ─── theworld domain types ──────────────────────────────────────────────────
// Everything the simulation, map and screens share. Keep this file dependency-free.

import type { Agent } from './agents';
import type { Status } from './status';
import type { Verdict } from './review';
import type { Outcome } from './friction';

export type BlockId = 'sleep' | 'morning' | 'am' | 'lunch' | 'pm' | 'evening' | 'night';

/** Big categories the user assigns to a block. `sleep` is only ever on the sleep block. */
export type Category = 'sleep' | 'meal' | 'play' | 'exercise' | 'study' | 'work' | 'rest' | 'travel';

export type TransportMode = 'walk' | 'car' | 'subway' | 'train' | 'plane' | 'boat';

export type PlaceType =
  | 'home' | 'friend_home' | 'cafe' | 'restaurant' | 'park' | 'gym' | 'school' | 'library' | 'cinema'
  | 'mall' | 'river' | 'beach' | 'museum' | 'arcade' | 'bar' | 'office' | 'station' | 'airport' | 'port'
  | 'temple' | 'market' | 'hotel' | 'stadium' | 'mountain' | 'island';
/** 모든 장소 유형 — 밖에서 들어온 장소(동적 도시 팩, ADR-0009)를 검증할 때 쓴다. */
export const PLACE_TYPES: readonly PlaceType[] = [
  'home', 'friend_home', 'cafe', 'restaurant', 'park', 'gym', 'school', 'library', 'cinema',
  'mall', 'river', 'beach', 'museum', 'arcade', 'bar', 'office', 'station', 'airport', 'port',
  'temple', 'market', 'hotel', 'stadium', 'mountain', 'island',
];

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

/**
 * 도시 하나의 정보 — 웹에서 찾아 온 도시(ADR-0009)가 places.ts의 레지스트리에 들어갈 때의 모양.
 * 붙박이 13개 도시는 places.ts의 상수에 같은 내용이 흩어져 있다.
 */
export interface CityInfo {
  /** 도시 키 ("kyoto") — Place.city와 같다 */
  key: string;
  nameKo: string;
  nameEn?: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  /** IANA 시간대 */
  tz: string;
  /** 여행 옵션의 기본 체류 박수 (0 = 당일치기) */
  stayNights: number;
  hubs: CityHubs & { intlAirport?: string; hasSubway?: boolean };
}

/** A friend in the character's memory. Every friend is also an `Agent` (src/sim/agents.ts) living its own day. */
export interface Friend {
  id: string; name: string; homePlaceId: string; color: string; emoji: string;
  /** when we became friends (a talked encounter) — their home is only suggested from the next day on */
  metAt?: number;
  metPlaceId?: string;
}

// ─── 진짜 사람 에이전트 (BACKEND-CONTRACT §2.3·§3.4, FRIENDS_SPEC §4) ──────────
// 서버가 붙으면 NPC 풀 자리에 실제 사용자 에이전트의 발행 일정이 들어온다. 굴림·판정은 그대로 프런트(ADR-0006 결정 5)라,
// 서버 데이터는 world의 `remote` 캐시로만 들어오고 buildTimeline은 그 캐시만 읽는다 (동기·순수·결정적).

/** 서버가 주는 장소 모양 (§2.3 RemotePlace). `type`이 문자열이라 `validRemotePlace`(sim/remote.ts)를 지나야 `Place`가 된다. */
export interface RemotePlace {
  id: string; name: string; type: string; lng: number; lat: number; area: string; city: string; country: string; emoji: string;
  reachBy?: 'boat' | 'plane' | 'train';
  ownerFriendId?: string;
}

/**
 * 다른 사용자의 에이전트 (§2.3 RemoteAgent). `id` = 서버 userId. `Agent`를 그대로 만족시켜 encounterOf·talkChance·화면이
 * 바뀌지 않는다. `home`은 내 카탈로그에 없는 집이라 동봉된다 — type 'friend_home', ownerFriendId = id, id = `home:${userId}`.
 */
export interface RemoteAgent extends Agent { home: Place }

/** 사용자가 발행한 확정 일정 한 건 (§2.3 PublishedActivity) — ScheduledActivity에서 뽑고, 상대에겐 AgentActivity가 된다. */
export interface PublishedActivity {
  /** ScheduledActivity.key `${dayKey}:${blockId}` — 창 교체의 upsert 키 */
  key: string;
  agentId: string;
  dayKey: DayKey;
  blockId: BlockId;
  /** 우회(friction) 반영된 실제 장소. 상대 카탈로그에 없을 수 있어 `place`를 같이 싣는다 */
  placeId: string;
  place?: Place;
  category: Category;
  title: string;
  emoji: string;
  arriveAt: number;
  endAt: number;
  tz: string;
  /** 동행 친구 id — 지금은 실어 두기만 한다 (FRIENDS_SPEC §2 후속) */
  companions: string[];
}

/** `POST /api/agents/at`의 hit 하나 — 캐시에는 프로필 대신 id만 (프로필은 `RemoteCache.agents`) */
export interface RemoteHit { agentId: string; overlapMs: number; activity: PublishedActivity }

/**
 * world 저장본의 remote 캐시 (§3.4). `slots`는 활동 key마다 **한 번만** 채우고 도착이 지난 key는 다시 묻지 않는다
 * (마주침 결정성). `days`는 친구별 발행된 하루 (오늘·내일). `friendsAt`은 친구 목록을 마지막으로 받은 실제 시각.
 */
export interface RemoteCache {
  fetchedAt: number;
  agents: Record<string, RemoteAgent>;
  slots: Record<string, RemoteHit[]>;
  days: Record<string, PublishedActivity[]>;
  friendsAt: number;
}

/** 사용자가 골라 준 오늘의 고민 (docs/adr/0001-agentness.md — 고민 듣기). 하루 뒤 감쇠한다. */
export type WorryKey = 'work' | 'people' | 'body' | 'money' | 'focus' | 'blue' | 'bored' | 'none';

export interface Memory {
  name: string;                 // 캐릭터 이름
  likes: string[];
  dislikes: string[];
  traits: string[];
  homePlaceId: string;
  friends: Friend[];
  visited: { placeId: string; at: number }[];
  /** 에이전트가 물어서 들은 고민. 다음 블록의 범주를 이쪽으로 튼다. */
  worry?: { key: WorryKey; at: number };
  /** 대화에서 가자고 한 여행지 (도시 키). 다음 여행 카드의 첫 장이 된다 (ADR-0009). */
  wish?: { city: string; at: number };
}

// ─── days & zones (TIMEZONE_SPEC) ───────────────────────────────────────────
/** `${dateKey}@${tz}` — one lived day. The same calendar date in another zone is a different day. */
export type DayKey = string;
export const makeDayKey = (dateKey: string, tz: string): DayKey => `${dateKey}@${tz}`;
export const splitDayKey = (key: DayKey): { dateKey: string; tz: string } => {
  const i = key.indexOf('@');
  return i < 0 ? { dateKey: key, tz: 'UTC' } : { dateKey: key.slice(0, i), tz: key.slice(i + 1) };
};

/**
 * Where the timeline starts: the character's place, the moment, the zone it lives in — and the accumulated
 * status baked in at that moment. `status` is optional so the QA harness can still build bare anchors;
 * `foldStatus` falls back to INITIAL_STATUS when it is missing (sim/status.ts).
 */
export interface Anchor { placeId: string; t: number; tz: string; status?: Status }

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
  /**
   * 에이전트가 확정하며 남기는 자기 예측 ("12시쯤 가면 웨이팅 없을 듯"). 결과가 사용자의 계획이 아니라
   * **에이전트 자신의 말**을 배반하게 만드는 장치다 (docs/adr/0001-agentness.md).
   */
  forecast?: string;
}

/**
 * 에이전트가 이 블록에 대해 뭐라고 했는가 (`chosenBy`는 "누가 골랐나", 이쪽은 "에이전트가 받아들였나").
 * `refused`/`pushback`이면 `chosenId`는 그대로 두고 `verdict`만 실린다 — 사용자의 선택이 확정되지 않았다는 뜻이다.
 */
export type PlanStatus = 'empty' | 'proposed' | 'confirmed' | 'pushback' | 'refused' | 'forced' | 'sketched';

export interface SketchVerdict {
  kind: 'seen' | 'near' | 'clash' | 'blocked' | 'unread';
  /** 그림이 무엇으로 보였나 ("컵"). unread면 빈 문자열 */
  seen: string;
  /** clash일 때 사용자가 골라 뒀던 범주 */
  askedCategory?: Category;
}

export interface BlockPlan {
  blockId: BlockId;
  category: Category | null;
  options: ActivityOption[];
  chosenId: string | null;
  /** who decided: the owner, the agent at block start, or a friend who planned first (`chosenBy: 'friend'`) */
  chosenBy: 'user' | 'agent' | 'friend' | null;
  /** 에이전트의 판단 결과 (docs/adr/0001-agentness.md) */
  status: PlanStatus;
  /** `pushback`/`refused`/`forced`일 때의 근거와 한 줄 */
  verdict?: Verdict;
  /**
   * 사용자가 그림으로 넘긴 계획 (ADR-0004). dataURL(PNG, 긴 변 ≤ 240px). sketched 불변식: category≠null,
   * chosenId=null, chosenBy=null, verdict=undefined, options는 setCategory가 만든 3장 유지 — 블록이 시작하면
   * 에이전트가 그 3장 안에서 review 문으로 고른다(chosenBy 'agent'). 카드 경로로 돌아오면 지워진다.
   */
  sketch?: string;
  /**
   * 비전 모델이 그림을 읽은 결과 (ADR-0007). 그림을 넘길 때 백엔드에 미리 묻고 여기 적어 둔다 — 블록이 시작하면
   * decide()가 `optionId`를 먼저 본다. 못 읽었으면 optionId null. 사용자에겐 보이지 않는다 (그림은 비밀).
   */
  sketchRead?: { optionId: string | null; seen: string; category: Category | null };
  /**
   * 블록이 시작할 때 에이전트가 그림을 어떻게 다뤘는가 (ADR-0008) — 출발 줄이 이걸로 정해진다.
   * seen: 알아보고 그 카드로 · near: 범주는 맞는데 그 카드가 없어 비슷한 걸로 · clash: 범주와 그림이 어긋나 내 맘대로 ·
   * blocked: 알아봤지만 돈·피로에 막혀 딴 데로 · unread: 못 알아봄
   */
  sketchVerdict?: SketchVerdict;
  /** 돈이 빠듯해서 에이전트가 알아서 아꼈다(`cheap`: 싼 데로) 또는 벌러 갔다(`earn`: work). 묻지 않고 한다 — 출발 줄에 이유만 찍힌다 */
  frugal?: 'cheap' | 'earn';
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
  /** 계획과 어긋난 기록 (sim/friction.ts). 없으면 계획대로 갔다는 뜻이다. */
  outcome?: Outcome;
  /** 아침에 그린 그림 — buildTimeline이 plan.sketch를 복사 (활동 로그 첫 줄·만화 헤더가 act만 받으므로) */
  sketch?: string;
  /** 그림을 어떻게 다뤘나 — buildTimeline이 plan.sketchVerdict를 복사 (출발 줄, ADR-0008) */
  sketchVerdict?: SketchVerdict;
  /** 지갑이 얇아서 알아서 아꼈다/벌러 갔다 — buildTimeline이 plan.frugal을 복사 (활동 로그의 출발 줄) */
  frugal?: 'cheap' | 'earn';
}

// ─── 사진 (ADR-0004 오너 결정 7) ─────────────────────────────────────────────
/** 카메라 장면 창: 활동 시간(arriveAt~endAt) 4등분. 0 도착 · 1 하는 중 · 2 한창 · 3 마무리 */
export type ShotWin = 0 | 1 | 2 | 3;
/**
 * 사용자가 찍은 한 장 (추가전용 이벤트, 같은 actKey+win은 뒤가 이긴다).
 * crop.x/y는 촬영 뷰포트 자기 크기 대비 % (translate(x%, y%)), scale=확대(1.0~2.2), rot=기울임(deg, -15~15),
 * pitch=각도(위/아래에서 보는 앵글, deg, -18~18, 없으면 0), light=조도(밝기 배율 0.55~1.45, 없으면 1),
 * dof=심도(0 = 전부 선명 … 1 = 초점 밖이 최대 흐림, 없으면 0), focus=초점(near: 캐릭터가 선명하고 배경이 흐림 ·
 * far: 배경이 선명하고 캐릭터가 흐림 — 톡 눌러서 정한다, 없으면 near).
 */
export interface ShotCrop { scale: number; x: number; y: number; rot: number; pitch?: number; light?: number; dof?: number; focus?: 'near' | 'far' }
export interface UserShot { actKey: string; win: ShotWin; at: number; crop: ShotCrop }
/** 에이전트가 대충 찍은 흔적 (오너 결정 14: 에이전트 컷은 거의 항상 하나 이상). */
export type PanelFlaw = 'blur' | 'dark' | 'overzoom' | 'cut' | 'tilt';

/** 마주침: someone else's agent shared this place. `talked` → a new friend when the activity ends; `again` → already a friend. */
export interface Encounter { agentId: string; talked: boolean; again?: boolean }

export interface ComicPanel {
  caption: string;
  beat: 'arrive' | 'doing' | 'twist' | 'end';
  withFriend?: boolean;
  bg: string;                // token colour for the panel ground
  /**
   * 그 컷이 찍힌 시각 (ms). 완성도 높은 삽화는 "누가 만든 결과물"로 읽히고,
   * 시각이 박힌 컷은 **목격 자료**로 읽힌다 (docs/adr/0001-agentness.md).
   */
  t: number;
  /** 크롭과 앵글 — 컷마다 화각이 달라야 "그린 그림"이 아니라 "찍힌 사진"이 된다 */
  crop: ShotCrop;
  /** 잘 안 찍힌 컷 (가끔 하나). 못 찍힌 사진만큼 증거처럼 읽히는 건 없다 */
  blur?: boolean;
  /** 누가 찍었나. 없으면(옛 만화) 'agent'로 본다 */
  by?: 'user' | 'agent';
  /** by==='user'이면 crop.x/y 단위가 %이다 (unit:'pct'). 없으면 px */
  unit?: 'px' | 'pct';
  /** 에이전트가 대충 찍은 흔적. by==='user'면 항상 없음 */
  flaws?: PanelFlaw[];
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
  /** 컷 작성자 수 (헤더 "내가 N장, 모모가 M장"은 화면이 조립). 없으면 전부 에이전트 */
  shots?: { user: number; agent: number };
  /** 아침에 그린 그림(있을 때). act.sketch 복사 */
  sketch?: string;
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
