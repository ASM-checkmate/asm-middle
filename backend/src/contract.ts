// ─── 프론트 ↔ 백엔드 계약 (docs/CONTRACT.md) ───────────────────────────────
// 프론트의 sim/types.ts와 같은 이름을 쓰되 **복사**한다. 두 패키지가 서로를 import하지 않는다 —
// 계약이 바뀌면 문서와 양쪽 타입을 같이 고친다. (A2A/CONTRACT.md와 같은 방식)

export type Tier = 'small' | 'good';

/** 무엇 때문에 지쳤는가. 프론트 sim/types.ts의 WorryKey에서 'none'을 뺀 것. */
export type WorryKey = 'work' | 'people' | 'body' | 'money' | 'focus' | 'blue' | 'bored';
export const WORRY_KEYS: readonly WorryKey[] = ['work', 'people', 'body', 'money', 'focus', 'blue', 'bored'];

/** 한 묶음의 내 말에 답을 써 달라는 요청. 시각·읽음 같은 **시간은 프론트의 규칙이 정한다** — 여기서는 말만 짓는다. */
export interface ReplyRequest {
  tier: Tier;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  situation: {
    /** "우리 집", "연남동 카페" — 프론트가 phase에서 뽑은 한 조각 */
    where: string;
    /** "커피 마시는 중", "자는 중" */
    doing: string;
    /** 에이전트 시각 "16:25" */
    hhmm: string;
    /** 못 받는 상황이었다가 이제 봤다 (자느라·이동 중·조용한 데·밥) */
    lateWhy: string | null;
    /** 0–100 */
    mood: number;
    /** 0–100 */
    fatigue: number;
    /** 며칠 안에 들은 고민 */
    worry: WorryKey | null;
  };
  /** 최근 대화 몇 줄 (오래된 것부터). 이번 묶음은 빼고. */
  recent: { from: 'me' | 'agent'; text: string }[];
  /** 이번 묶음 — 연달아 보낸 내 말들 (보낸 순서) */
  texts: string[];
}

export interface ReplyResponse {
  /** 답장 한 줄. null이면 읽고 답하지 않는다 (읽씹). */
  text: string | null;
  /** 지쳤다는 말로 들었으면 그 갈래 */
  worry: WorryKey | null;
  /** 전화를 걸어 달라는 말로 들었다 */
  callMe: boolean;
  /** 어디로 여행 가자는 말로 들었으면 그 도시 이름 (한국어, ≤30자). 아니면 null (ADR-0009) */
  trip: string | null;
  /** 실제로 쓴 모델 */
  model: string;
  /** 걸린 시간 (ms) */
  ms: number;
}

export interface ModelsResponse {
  tiers: Record<Tier, { model: string; installed: boolean }>;
  ollama: boolean;
}

/** 그림(스케치)이 어느 옵션을 가리키는지 읽어 달라는 요청 (ADR-0007). */
export interface SketchReadRequest {
  tier: Tier;
  /** 240px PNG dataURL — 프론트 SketchOverlay가 만든 그대로 */
  sketch: string;
  /** 그 블록의 범주 ("play", "meal" …) — 그림은 이 범주 안에서만 뜻이 있다 */
  category: string;
  /** 고를 수 있는 옵션들 (그 블록의 카드 3장) */
  options: { id: string; title: string; placeName: string; placeType: string }[];
}

/** 앱의 활동 범주 (프론트 sim/types.ts Category에서 'sleep'을 뺀 것). 그림이 어느 범주로 읽히는지에 쓴다. */
export type SketchCategory = 'meal' | 'play' | 'exercise' | 'study' | 'work' | 'rest' | 'travel';
export const SKETCH_CATEGORIES: readonly SketchCategory[] = ['meal', 'play', 'exercise', 'study', 'work', 'rest', 'travel'];

export interface SketchReadResponse {
  /** 그림이 가리키는 옵션. 못 알아봤거나 어느 것도 아니면 null — 아는 척하지 않는다 */
  optionId: string | null;
  /** 그림이 어느 범주의 활동으로 읽히는가. 활동이 아니거나 모르면 null. 사용자가 고른 범주와 어긋나는지를 프론트가 본다 (ADR-0008) */
  category: SketchCategory | null;
  /** 그림이 무엇으로 보였는지 한국어 한 조각 ("컵", "자전거"). 못 봤으면 빈 문자열 */
  seen: string;
  model: string;
  ms: number;
}

// ─── 여행지 찾기 (ADR-0009) ───────────────────────────────────────────────────

/** 프론트 sim/types.ts의 PlaceType **복사**. */
export type PlaceType =
  | 'home' | 'friend_home' | 'cafe' | 'restaurant' | 'park' | 'gym' | 'school' | 'library' | 'cinema'
  | 'mall' | 'river' | 'beach' | 'museum' | 'arcade' | 'bar' | 'office' | 'station' | 'airport' | 'port'
  | 'temple' | 'market' | 'hotel' | 'stadium' | 'mountain' | 'island';
/** 웹에서 찾은 장소가 가질 수 있는 유형 — 집·친구 집·일터·학교는 여행지에 없다. */
export const TRIP_PLACE_TYPES: readonly PlaceType[] = [
  'cafe', 'restaurant', 'park', 'gym', 'library', 'cinema', 'mall', 'river', 'beach', 'museum', 'arcade', 'bar',
  'station', 'airport', 'port', 'temple', 'market', 'hotel', 'stadium', 'mountain', 'island',
];

/** 프론트 sim/types.ts의 Place **복사** (ownerFriendId 없음). */
export interface TripPlace {
  id: string;
  name: string;
  type: PlaceType;
  lng: number;
  lat: number;
  area: string;
  city: string;
  country: string;
  emoji: string;
  reachBy?: 'boat' | 'plane' | 'train';
}

/** 프론트 sim/types.ts의 CityInfo **복사**. */
export interface CityInfo {
  key: string;
  nameKo: string;
  nameEn?: string;
  country: string;
  tz: string;
  stayNights: number;
  hubs: { station?: string; airport?: string; port?: string; intlAirport?: string; hasSubway?: boolean };
}

/** "이 도시의 장소를 찾아 달라"는 요청. */
export interface TripPlanRequest {
  tier: Tier;
  /** 도시 이름 (한국어든 영어든, 1~40자) */
  city: string;
}

/** 도시 팩 — 프론트가 그대로 places.ts에 등록한다. */
export interface TripPlanResponse {
  city: CityInfo;
  /** 허브(공항·역·항구)와 호텔을 포함한 장소들. 전부 `city === city.key` */
  places: TripPlace[];
  /** 근거가 된 검색 결과 URL */
  sources: string[];
  cached: boolean;
  model: string;
  ms: number;
}

// ─── 하루 계획 (ADR-0010) ─────────────────────────────────────────────────────
// 블록마다 "무엇을 할지" 카드 3장을 모델이 짓는다. 프론트 sim/types.ts의 Category·BlockId **복사**.

export type BlockId = 'sleep' | 'morning' | 'am' | 'lunch' | 'pm' | 'evening' | 'night';
/** 모델이 고를 수 있는 범주 — 잠·여행은 규칙이 맡는다. */
export type PlanCategory = 'meal' | 'play' | 'exercise' | 'study' | 'work' | 'rest';
export const PLAN_CATEGORIES: readonly PlanCategory[] = ['meal', 'play', 'exercise', 'study', 'work', 'rest'];
export const PLAN_BLOCKS: readonly BlockId[] = ['morning', 'am', 'lunch', 'pm', 'evening', 'night'];

/** 그 도시에서 갈 수 있는 장소 하나 (프론트 Place의 일부). */
export interface PlanPlace { id: string; name: string; type: PlaceType; area: string }

/** 계획을 지어 달라는 블록 하나. */
export interface PlanBlockRequest {
  id: BlockId;
  /** 정해진 범주. null이면 모델이 고른다 */
  category: PlanCategory | null;
  /** 그 블록이 시작할 때 있는 곳 (장소 이름) */
  from: string;
  /** 오늘 다른 블록에 이미 잡힌 장소 id — 피한다 */
  avoid: string[];
  /** "다른 제안 보기": 방금 보여 준 카드 제목들 — 다른 걸 낸다 */
  previous?: string[];
}

export interface PlanRequest {
  tier: Tier;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  /** "2026-09-08", "화요일" */
  day: { dateKey: string; weekday: string };
  /** 지금 있는 도시 — 카탈로그는 이 도시의 장소들 */
  city: { key: string; nameKo: string; home: boolean };
  status: { money: number; fatigue: number; mood: number };
  worry: WorryKey | null;
  /** 최근 간 곳 이름들 (오래된 것부터) */
  visited: string[];
  /** 갈 수 있는 장소 (≤120). 모델은 이 id만 쓴다 */
  places: PlanPlace[];
  /** 1~6개 */
  blocks: PlanBlockRequest[];
}

export interface PlanOption { placeId: string; title: string; reason: string; emoji: string }
export interface PlanBlock { id: BlockId; category: PlanCategory; options: PlanOption[] }
export interface PlanResponse {
  /** 요청한 블록 중 제대로 지어진 것만. 빠진 블록은 프론트가 규칙으로 채운다 */
  blocks: PlanBlock[];
  model: string;
  ms: number;
}

// ─── 통화 (ADR-0011) ──────────────────────────────────────────────────────────

/** 통화 한 턴 — 사용자가 방금 한 말(또는 통화가 막 붙은 첫 턴)에 에이전트가 뭐라고 하는가. */
export interface CallTurnRequest {
  tier: Tier;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  situation: { where: string; doing: string; hhmm: string; mood: number; fatigue: number };
  /** 왜 붙은 통화인가 — worry(약속한 전화) · ask(걸어 달래서) · friction(어긋남 통보) · out(사용자가 걸었다) */
  why: 'worry' | 'ask' | 'friction' | 'out';
  worry: WorryKey | null;
  /** 지금까지 오간 말 (오래된 것부터, 최대 20줄) */
  transcript: { from: 'me' | 'agent'; text: string }[];
  /** 방금 들은 말. null이면 첫 턴 — 에이전트가 먼저 말한다 */
  user: string | null;
}

/** 응답은 ndjson 스트림이다: 문장마다 `{ "s": "…" }`, 끝에 `{ "done": true, "model": …, "ms": … }`. */
export interface CallTurnDone { done: true; model: string; ms: number }
