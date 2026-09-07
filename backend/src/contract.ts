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
