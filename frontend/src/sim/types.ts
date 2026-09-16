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

/**
 * 백엔드 모델이 미리 지어 둔 하루 계획 (ADR-0010): 블록마다 범주와 카드 3장. 블록이 시작할 때 `decide()`가 규칙 카드
 * 대신 이걸 쓴다 — 같은 review 문을 지난다. 저장돼야 새로고침해도 같은 하루다.
 */
export type LlmDayPlan = Partial<Record<BlockId, { category: Category; options: ActivityOption[]; at: number }>>;
export type LlmPlans = Record<DayKey, LlmDayPlan>;

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
  /** 우정 — 같이 논 횟수 (FRIENDS_SPEC §6 사다리: 3부터 친한 친구). 없으면 0. 채우는 쪽: settle (M4) */
  bond?: number;
  /** 같이 놀 때마다 하나씩 알게 된 것 ("아메리카노만 마심") — 친한 친구의 프로필에 접기 토글로 (FRIENDS_SPEC §6) */
  learned?: string[];
  /** 설렘 (AFFECTION_SPEC §1) — 0~1과 마지막 갱신 시각(감쇠의 기준점). 주인에겐 숫자로 보이지 않는다. 오르내리는 곳은 sim/affection.ts뿐 */
  crush?: { v: number; at: number };
  /** 상대 성별 (AFFECTION_SPEC §2) — NPC는 풀에서, 진짜 사람은 RemoteAgent에서 */
  gender?: Gender;
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
 * SNS 세 칸(§2.5 PUT /api/me/agent 개정): `visibility`는 서버가 항상 내지만 옛 응답·저장본엔 없을 수 있어 선택이다.
 * `gender`(ADR-0027)·`repShotId`(대표컷 핀, 32자 hex 미디어 id)는 있을 때만.
 */
export interface RemoteAgent extends Agent {
  home: Place;
  gender?: Gender;
  /** 공개 계정이면 추천에 노출·누구나 열람, 비공개면 친구만 (ADR-0025 결정 7). 없으면 비공개로 친다 */
  visibility?: Visibility;
  /** 대표컷 — 본인이 얼굴로 내건 컷의 미디어 id. 핀이 없으면 키 없음 */
  repShotId?: string;
}

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

// ─── 겉모습 (ADR-0019): 사진에서 비전 모델이 고른 옵션 여섯 개. 그리기는 character/가 한다 ───
export const LOOK_SKINS = ['light', 'fair', 'tan', 'brown', 'dark'] as const;
export const LOOK_HAIR_COLORS = ['black', 'dark-brown', 'brown', 'blond', 'red', 'gray', 'white'] as const;
export const LOOK_HAIR_STYLES = ['bowl', 'short', 'buzz', 'bob', 'long', 'curly', 'bald', 'side-part', 'bangs', 'ponytail', 'bun', 'afro', 'spiky', 'pigtails', 'wavy'] as const;
export const LOOK_GLASSES = ['none', 'round', 'square'] as const;
export const LOOK_BEARDS = ['none', 'stubble', 'mustache', 'full'] as const;
export const LOOK_TOPS = ['coral', 'sun', 'mint', 'sky', 'night', 'paper', 'leaf'] as const;
// 얼굴 축 실험(2026-09-11): 색·머리만으로는 개인이 안 살아서 실루엣 축을 더한다. 전부 선택 — 없으면 모모(round·dot·none·none·smile·hidden)
export const LOOK_FACES = ['round', 'long', 'square', 'heart'] as const;
export const LOOK_EYES = ['dot', 'big', 'narrow', 'sharp'] as const;
export const LOOK_BROWS = ['none', 'thin', 'thick', 'angled'] as const;
export const LOOK_NOSES = ['none', 'small', 'big'] as const;
export const LOOK_MOUTHS = ['smile', 'wide', 'flat'] as const;
export const LOOK_EARS = ['hidden', 'out'] as const;
export const LOOK_BUILDS = ['slim', 'normal', 'wide'] as const;
export interface Look {
  skin: (typeof LOOK_SKINS)[number];
  hairColor: (typeof LOOK_HAIR_COLORS)[number];
  hairStyle: (typeof LOOK_HAIR_STYLES)[number];
  glasses: (typeof LOOK_GLASSES)[number];
  beard: (typeof LOOK_BEARDS)[number];
  top: (typeof LOOK_TOPS)[number];
  face?: (typeof LOOK_FACES)[number];
  eyes?: (typeof LOOK_EYES)[number];
  brows?: (typeof LOOK_BROWS)[number];
  nose?: (typeof LOOK_NOSES)[number];
  mouth?: (typeof LOOK_MOUTHS)[number];
  ears?: (typeof LOOK_EARS)[number];
  build?: (typeof LOOK_BUILDS)[number];
}
/** 기본 캐릭터(모모)의 겉모습 — look이 없을 때 그려지는 그대로 */
export const DEFAULT_LOOK: Look = { skin: 'fair', hairColor: 'dark-brown', hairStyle: 'bowl', glasses: 'none', beard: 'none', top: 'coral' };
/** 저장본·응답의 look 검증 — 여섯 칸이 모두 허용값일 때만 */
export const isLook = (v: unknown): v is Look => {
  const o = v as Partial<Record<keyof Look, unknown>> | null;
  return !!o && typeof o === 'object'
    && (LOOK_SKINS as readonly unknown[]).includes(o.skin) && (LOOK_HAIR_COLORS as readonly unknown[]).includes(o.hairColor)
    && (LOOK_HAIR_STYLES as readonly unknown[]).includes(o.hairStyle) && (LOOK_GLASSES as readonly unknown[]).includes(o.glasses)
    && (LOOK_BEARDS as readonly unknown[]).includes(o.beard) && (LOOK_TOPS as readonly unknown[]).includes(o.top)
    && opt(o.face, LOOK_FACES) && opt(o.eyes, LOOK_EYES) && opt(o.brows, LOOK_BROWS) && opt(o.nose, LOOK_NOSES)
    && opt(o.mouth, LOOK_MOUTHS) && opt(o.ears, LOOK_EARS) && opt(o.build, LOOK_BUILDS);
};
const opt = (v: unknown, allowed: readonly string[]) => v === undefined || (allowed as readonly unknown[]).includes(v);

/** 성별 (ADR-0027) — 서버는 검증만 하고 추정하지 않는다. 없으면 모름 */
export type Gender = 'female' | 'male';
/** 계정 공개 여부 (CONTRACT §2.5 PUT /api/me/agent). 서버 기본값은 private */
export type Visibility = 'public' | 'private';

export interface Memory {
  name: string;                 // 캐릭터 이름
  /** 내 캐릭터의 겉모습 (ADR-0019). 없으면 기본 모모 */
  look?: Look;
  /** 성별 (ADR-0027). 없으면 서버에 키를 빼서 이전 값을 지킨다 */
  gender?: Gender;
  /** 계정 공개 여부 (SNS_SPEC §10). 없으면 서버에 키를 빼서 이전 값(처음은 private)을 지킨다 */
  visibility?: Visibility;
  /** 대표컷 핀 — 내 미디어 id(32자 hex). 없으면 키를 빼서 이전 값을 지킨다 */
  repShotId?: string;
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
  /**
   * 광고 가게 (ADR-0031 확장): 이 카드의 장소가 광고 지면이다 — 시간표 카드·활동 장소 태그에 `AD`. 에이전트는 광고 가게 중에서도
   * 취향에 맞는 곳만 고른다(이유는 reason에). 서버 계약(CONTRACT 옵션)엔 없고 클라이언트·시나리오만 쓴다. 사진·앨범에는 붙지 않는다.
   */
  sponsored?: boolean;
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

/** 이동 제휴 (ADR-0031): 귀가 택시 같은 스폰서 — 여정 라벨과 지도 광고 카드에 쓴다. 로고 자산 없이 이름·문구·아이콘만 */
export interface RideSponsor { id: string; name: string; label: string; tagline: string; emoji: string }

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
  /**
   * 같은 공간에 있던 사람들 (FRIENDS_SPEC §6, ADR-0026): 같은 장소에 30분 이상 겹친 에이전트 id — 동행은 뺀다. 그 순간의 사실이지
   * 관계가 아니다: 사진엔 배경의 뒷모습, 글엔 태그 없음. 말을 건 상대(`encounter`)도 대화 전엔 여기 있는 한 사람이다. id 오름차순, 최대 3
   */
  presentNearby: string[];
  /** another agent was at the same place for ≥ 30 min; `talked` = the talk roll succeeded (FRIENDS_SPEC §4) */
  encounter?: Encounter;
  /** 이동 제휴 (ADR-0031): 취침 전 귀가가 그 도시의 제휴 택시를 탈 때 — 지도에 광고 카드 */
  ride?: RideSponsor;
  /** 계획과 어긋난 기록 (sim/friction.ts). 없으면 계획대로 갔다는 뜻이다. */
  outcome?: Outcome;
  /** 아침에 그린 그림 — buildTimeline이 plan.sketch를 복사 (활동 로그 첫 줄·만화 헤더가 act만 받으므로) */
  sketch?: string;
  /** 그림을 어떻게 다뤘나 — buildTimeline이 plan.sketchVerdict를 복사 (출발 줄, ADR-0008) */
  sketchVerdict?: SketchVerdict;
  /** 지갑이 얇아서 알아서 아꼈다/벌러 갔다 — buildTimeline이 plan.frugal을 복사 (활동 로그의 출발 줄) */
  frugal?: 'cheap' | 'earn';
}

// ─── 사진 (ADR-0004 → ADR-0029: 창 없이 아무 때나 최대 3장) ─────────────────────────────
/** 글의 컷 번호(PostCut.win)·NPC 컷 프레이밍이 아직 0~3을 쓴다 — 창(활동 시간 4등분)이 아니라 **앨범 안의 컷 순서**다 */
export type ShotWin = 0 | 1 | 2 | 3;
/** 카메라가 고르는 자세 — character/Character.tsx Pose의 부분집합 (sleep은 없다) */
export type ShotPose = 'idle' | 'walk' | 'sit' | 'wave' | 'draw' | 'happy' | 'eat' | 'read' | 'think';
/**
 * 배경 위 인물 하나의 자리·크기·자세 (ADR-0029): x/y = **발이 닿는 점**(프레임 너비·높이 대비 %, 0~100), scale = 프레임 너비 대비
 * 캐릭터 상자 폭(0.25~1.2). 카메라가 손으로 옮기고, 굽기(photo/bake)와 만화(ShotStage)가 같은 숫자로 그린다
 */
export interface ShotFigure { x: number; y: number; scale: number; pose?: ShotPose }
/**
 * 배경 이동·확대 — 옛 필드(rot·pitch·light·dof·focus)는 카메라가 더 만들지 않지만 옛 컷(shotId 없는 것)을 다시 그릴 때 읽는다.
 * crop.x/y는 촬영 뷰포트 자기 크기 대비 % (translate(x%, y%)), scale=확대(1.0~2.2)
 */
export interface ShotCrop { scale: number; x: number; y: number; rot: number; pitch?: number; light?: number; dof?: number; focus?: 'near' | 'far' }
/**
 * 사용자가 찍은 한 장 (추가전용, 활동당 최대 3장 — sim/shots.ts MAX_SHOTS). 같은 `shotId`를 다시 넣으면 교체.
 * `shotId`: 찍는 순간 구운 픽셀(ADR-0024)의 미디어 id(32자 hex, 폰이 정한다). 굽기가 실패한 컷·옛 컷에는 없다 — 그때는 crop/me로 다시 그린다.
 * `backdrop`: AI 배경 id (sim/backdrops.ts) — 없으면 SVG 무대. `me`/`friend`: 배경 위 자리·크기·자세. `gen`: 서버 화풍 생성 상태
 * ('plain' 단순 합성 그대로 · 'pending' 생성 중 · 'done' 생성본으로 교체됨). 옛 저장본의 `win`은 로드 때 버린다.
 */
export interface UserShot {
  actKey: string; at: number; crop: ShotCrop; shotId?: string; backdrop?: string; me?: ShotFigure; friend?: ShotFigure; gen?: 'plain' | 'pending' | 'done';
  /** 찍을 때 같이 선 말 튼 사람들의 agent id (ADR-0031, 최대 둘) — 썸네일·앨범이 되살릴 때 같은 사람이 서게 */
  mets?: string[];
}

/**
 * 마주침: someone else's agent shared this place. `talked` → a new friend when the activity ends; `again` → already a friend.
 * `at`: 말을 튼 순간 (ms, 활동 시간의 30~64 % 지점, 시드 = 날짜·장소·둘의 id) — 그 전엔 같은 공간의 한 사람(뒷모습), 그 뒤부터 '만난 사람'(정면).
 * talked·again일 때만 있다 (ADR-0026 결정 5: 활동 중간에 대화가 성공하면 앞 컷은 뒷모습, 뒤 컷은 정면)
 */
export interface Encounter { agentId: string; talked: boolean; again?: boolean; at?: number;
  /** 같은 순간 같이 말 튼 나머지 (ADR-0031 — 둘이서 온 관광객). talked일 때만; 정산에서 이들도 친구가 된다 */
  also?: string[] }

// ─── 사진 속 인물 (FRIENDS_SPEC §6 표) ────────────────────────────────────────
/**
 * 만화가 기억하는 인물 하나 — 색과 머리 모양만 (얼굴은 우리가 그리지 않는다: 동행은 정면 기본 얼굴, 배경 인물은 뒷모습).
 * `glance`: 배경 인물이 설렘 대상이라 뒷모습 대신 슬쩍 돌아본 모습 (AFFECTION_SPEC §4 — 찍힐 때의 마음이 컷에 남는다)
 */
export interface CastFigure { id: string; color: string; hairStyle?: Look['hairStyle']; glance?: boolean;
  /** 피부·머리색 등 머리 모양 밖의 겉모습 (ADR-0031 손님 NPC) — 없으면 기본 */
  look?: Partial<Look> }
/**
 * 만화가 기억하는 인물 구성 (Comic.cast) — 활동은 KEEP_DAYS 뒤 타임라인에서 사라지니 컷을 나중에 구울 때(ADR-0024 결정 2) 되찾을 수 없다.
 * `met.at` 전의 컷은 그 사람을 `present`(배경 뒷모습)로, 뒤의 컷은 정면으로 그린다 (sim/agents.ts castOfComic)
 */
export interface ComicCast { companions: CastFigure[]; met?: CastFigure & { at: number }; present: CastFigure[] }

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
  /** 누가 찍었나. 없으면(옛 만화) 'agent'로 본다 */
  by?: 'user' | 'agent';
  /** by==='user'이면 crop.x/y 단위가 %이다 (unit:'pct'). 없으면 px */
  unit?: 'px' | 'pct';
  /** AI 배경(ADR-0029): 배경 id와 그 자리 이름("정원"), 인물의 자리·자세. 없으면 SVG 무대에 기본 자리 */
  backdrop?: string;
  spot?: string;
  me?: ShotFigure;
  friend?: ShotFigure;
  /**
   * 구운 픽셀의 미디어 id (ADR-0024 결정 2). 사용자 컷은 makeComic이 샷에서 복사하고, 에이전트 컷·옛 컷은 다음 열람 때
   * 화면이 한 번 굽고 store.patchPanelShot으로 적는다. 없으면 crop으로 다시 그린다(옛 경로)
   */
  shotId?: string;
}

export interface Comic {
  id: string;
  blockId: BlockId;
  dateKey: string;
  title: string;             // "카페 어라운드에서 생긴 일"
  placeName: string;
  placeType: PlaceType;
  createdAt: number;
  panels: ComicPanel[];      // 1~3 (ADR-0029). 옛 앨범은 4
  summary: string;           // one-line summary for the catch-up sheet
  /** 컷 작성자 수 (헤더 "내가 N장, 모모가 M장"은 화면이 조립). 없으면 전부 에이전트 */
  shots?: { user: number; agent: number };
  /** 아침에 그린 그림(있을 때). act.sketch 복사 */
  sketch?: string;
  /** 책의 검색·범주 필터용 (ADR-0016). 옛 만화에는 없다 — 책이 타임라인의 활동에서 되찾고, 그것도 없으면 범주 없음으로 둔다 */
  category?: Category;
  /** 활동 제목 (option.title) — "활동" 검색이 보는 글 */
  activity?: string;
  /** 동네·도시 키 — 장소 검색은 이름·동네·도시 이름으로 맞춘다 */
  area?: string;
  city?: string;
  /** 같이 있던 사람들 이름 (동행, 말을 건 상대) — 이름으로도 찾힌다 */
  withNames?: string[];
  /** 찍힐 때의 인물 구성 (ADR-0026) — 컷을 나중에 구울 때 쓴다. 옛 만화에는 없다 (화면이 타임라인의 활동에서 되찾는다: util.castOf) */
  cast?: ComicCast;
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
  | { kind: 'sleeping'; until: number; at: Place; tz: string;
      /** 잠들기 시작한 시각 — 수면 슬롯 시작, 또는 취침 전 이동으로 집에 닿은 시각(ADR-0030). 그 뒤 잠깐은 집 방에서 눕는 장면 */
      since: number }
  | { kind: 'waiting'; at: Place; currentBlockId: BlockId; nextBlockId: BlockId | null; nextStartAt: number | null; tz: string; jetlag: boolean; companions: Friend[] }
  | { kind: 'moving'; act: ScheduledActivity; legIndex: number; legProgress: number; position: LngLat; heading: number; remainingMin: number; totalProgress: number; tz: string; onboard: Onboard; companions: Friend[]; encounter?: PhaseEncounter }
  | { kind: 'active'; act: ScheduledActivity; remainingMin: number; progress: number; tz: string; jetlag: boolean; companions: Friend[]; encounter?: PhaseEncounter }
  | { kind: 'comic'; act: ScheduledActivity; comic: Comic; tz: string; jetlag: boolean; companions: Friend[]; encounter?: PhaseEncounter };

export interface DaySummaryItem { blockId: BlockId; comic: Comic; act: ScheduledActivity }
