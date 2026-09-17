// ─── 데모 시나리오 (ADR-0029, `?scenario=busan`) ─────────────────────────────────
// 오늘 하루를 통째로 심는다: AI 배경이 있는 부산 네 곳을 점심 → 오후 → 저녁 → 밤 블록에 사용자가 고른 것으로 넣는다.
// 두 단계다 — (1) prepScenario: 스토어가 뜨기 **전**(main.tsx boot)에 시계·집·저장본을 localStorage에 준비한다 (스토어는 모듈이 뜰 때
// 시계를 읽고 지난 블록을 정산하므로, 뒤늦게 시계를 돌리면 서울에서 산 아침이 앨범에 남는다). (2) App의 effect가 seedPlans로 블록을 심고
// 표식을 남긴다 — 한 번만, 새로고침해도 하루가 이어진다. `dev=1`처럼 개발용이고 제품 경로에는 없다.
import type { BlockId, BlockPlan, Category } from '../sim/types';
import { BLOCKS } from '../sim/blocks';
import { dayStartIn } from '../sim/tz';
import { placeById, tzOf } from '../sim/places';
import { setForcedEncounters } from '../sim/agents';
import { dayKeyIn } from '../sim/tz';

export interface Scenario {
  key: string;
  /** 첫 블록 직전으로 시계를 옮긴다 (시:분) */
  startAt: [number, number];
  /** 시계 배속 (x30 — 활동 하나가 3~6분) */
  scale?: number;
  /** 캐릭터의 집 (그 도시에 산다) — 없으면 기억의 집 그대로 */
  home?: string;
  blocks: Partial<Record<BlockId, { title: string; reason: string; emoji: string; placeId: string; category: Category; friendId?: string;
    /** 광고 가게 (ActivityOption.sponsored): 일반 선택지 사이에 섞인 광고 카드 — 시간표·활동 태그에 AD. 고르는 건 취향이다 */
    sponsored?: boolean;
    /** 같이 놓인 다른 카드들 (안 고른 것) — 시간표가 카드 3장으로 보이게. 광고 카드는 이 사이(가운데)에 선다 */
    alts?: { title: string; reason: string; emoji: string; placeId: string; friendId?: string }[];
    /** 강제 마주침 (ADR-0031): 이 사람들이 [from, to) 동안 그 자리에 있고 `at`에 말을 튼다 — 굴림 없이 친구가 된다 */
    meet?: { agentIds: string[]; from: [number, number]; to: [number, number]; at: [number, number] } }>>;
}

export const SCENARIOS: Record<string, Scenario> = {
  busan: {
    key: 'busan',
    startAt: [15, 55],
    scale: 30,
    home: 'busan-home',
    // 블록은 오후·저녁·밤 셋뿐이다 — 광안리 드론쇼는 같은 해변의 삼진포차 자리(해변 난간·드론쇼 앞)로 찍는다
    blocks: {
      // 세 일정 다 민수와 — 같이 수업 듣고 그대로 광안리까지. 수업은 민수 일정(광고 아님)
      pm: { title: '부산대에서 민수랑 수업 듣기', reason: '오후 수업, 끝나면 같이 광안리로', emoji: '🏫', placeId: 'pnu', category: 'study', friendId: 'minsu' },
      // 저녁·밤은 카드 3장 중 가운데가 광고 가게 — 모모는 창가 뷰·드론쇼 자리가 마음에 들어 고른다 (광고라서가 아니라)
      evening: { title: '조새호에서 민수랑 조개구이', reason: '창가 자리에 광안대교', emoji: '🦪', placeId: 'josaeho', category: 'meal', friendId: 'minsu', sponsored: true,
        alts: [
          { title: '해운대시장에서 민수랑 회 한 접시', reason: '시장 구경하면서 저녁', emoji: '🐟', placeId: 'haeundae-market', friendId: 'minsu' },
          { title: '자갈치시장에서 민수랑 꼼장어', reason: '부산 왔으면 자갈치', emoji: '🦑', placeId: 'jagalchi-market', friendId: 'minsu' },
        ] },
      // 드론쇼(21:00)에 프랑스 관광객 둘이 옆자리에 — 21:05에 말을 트고 활동이 끝나면 둘 다 친구 (ADR-0031)
      night: { title: '삼진포차에서 민수랑 한잔', reason: '드론쇼 보고 바다 앞에서', emoji: '🍶', placeId: 'samjin-pocha', category: 'play', friendId: 'minsu', sponsored: true,
        alts: [
          { title: '광안리 모래밭에서 민수랑 드론쇼', reason: '앉아서 보는 것도 좋지', emoji: '🌉', placeId: 'gwangalli', friendId: 'minsu' },
          { title: '동백섬 밤 산책', reason: '바다 보면서 걷기', emoji: '🌺', placeId: 'dongbaek-island', friendId: 'minsu' },
        ],
        meet: { agentIds: ['louis', 'chloe'], from: [21, 0], to: [23, 30], at: [21, 5] } },
    },
  },
  // 데모 1편 v3 (2026-09-17, 오너): "에이전트가 잘 논다" — 조새호 없이 부산대 → 광안리 해변 → 삼진포차(아사히 짠, 드론쇼) → 집.
  // 술 광고는 포차 방·사진의 아사히 제품 배치(ADR-0032)로 보인다 — 모모 대사엔 브랜드도 광고도 없다 ("짠", "위하여")
  gwangalli: {
    key: 'gwangalli',
    startAt: [15, 55],
    scale: 30,
    home: 'busan-home',
    blocks: {
      pm: { title: '부산대에서 민수랑 수업 듣기', reason: '오후 수업, 끝나면 같이 광안리로', emoji: '🏫', placeId: 'pnu', category: 'study', friendId: 'minsu' },
      // 저녁은 해변에서 놀기 (광고 아님) — 지하철로 광안리까지
      evening: { title: '광안리에서 민수랑 바다 보기', reason: '해 지는 바다, 발 담그고', emoji: '🌉', placeId: 'gwangalli', category: 'play', friendId: 'minsu',
        alts: [
          { title: '해운대에서 민수랑 모래 놀이', reason: '넓은 해변', emoji: '🏖️', placeId: 'haeundae', friendId: 'minsu' },
          { title: '동백섬 산책', reason: '바다 보면서 걷기', emoji: '🌺', placeId: 'dongbaek-island', friendId: 'minsu' },
        ] },
      // 밤은 해변 바로 옆 포차(광고 가게) — 걸어서 2분. 드론쇼(21:00)에 루이·클로에가 옆자리에
      night: { title: '삼진포차에서 민수랑 한잔', reason: '드론쇼 보고 바다 앞에서', emoji: '🍻', placeId: 'samjin-pocha', category: 'play', friendId: 'minsu', sponsored: true,
        alts: [
          { title: '광안리 모래밭에서 민수랑 드론쇼', reason: '앉아서 보는 것도 좋지', emoji: '🚁', placeId: 'gwangalli', friendId: 'minsu' },
          { title: '자갈치시장에서 민수랑 꼼장어', reason: '부산 왔으면 자갈치', emoji: '🦑', placeId: 'jagalchi-market', friendId: 'minsu' },
        ],
        meet: { agentIds: ['louis', 'chloe'], from: [21, 0], to: [23, 30], at: [21, 5] } },
    },
  },
  // 데모 2편 v3 (2026-09-17, 오너): "기능 소개" — 공시생의 하루. 스타벅스에서 하루 종일 공부(에듀윌 교재, 광고 가게), 저녁은 집, 밤은 코인노래방.
  // 시간표 장면에서 사용자가 밤 카드를 코인노래방으로 실제로 바꾼다. 10:20에 현이(책·공부·카페 취향)가 옆자리에서 말을 튼다
  gongsi: {
    key: 'gongsi',
    startAt: [9, 30],
    scale: 30,
    home: 'busan-home',
    blocks: {
      am: { title: '스타벅스에서 에듀윌 기본서 공부', reason: '아침엔 머리가 제일 잘 돌아감', emoji: '📚', placeId: 'starbucks-pnu', category: 'study', sponsored: true,
        alts: [
          { title: '부산대 도서관에서 공부', reason: '조용한 열람실', emoji: '🏛️', placeId: 'pnu-library' },
          { title: '집에서 인강 듣기', reason: '이불 밖은 위험', emoji: '💻', placeId: 'busan-home' },
        ],
        meet: { agentIds: ['hyeon'], from: [10, 0], to: [12, 0], at: [10, 20] } },
      lunch: { title: '스타벅스에서 샌드위치로 점심', reason: '자리 뺏기기 싫어서', emoji: '🥪', placeId: 'starbucks-pnu', category: 'meal', sponsored: true },
      pm: { title: '스타벅스에서 기출문제 풀기', reason: '오후엔 문제 풀이', emoji: '✏️', placeId: 'starbucks-pnu', category: 'study', sponsored: true },
      evening: { title: '집에서 저녁 먹고 한숨 돌리기', reason: '엄마 반찬', emoji: '🍚', placeId: 'busan-home', category: 'meal' },
      night: { title: '코인노래방에서 스트레스 풀기', reason: '하루 종일 공부했으니까', emoji: '🎤', placeId: 'coin-noraebang-pnu', category: 'play',
        alts: [
          { title: '집에서 넷플릭스 보기', reason: '누워서 한 편', emoji: '📺', placeId: 'busan-home' },
          { title: '온천천에서 밤 산책', reason: '바람 쐬기', emoji: '🌊', placeId: 'oncheoncheon' },
        ] },
    },
  },
};

/**
 * 시나리오의 블록 계획 — 에이전트가 골라 확정한 카드 한 장짜리 (`chosenBy: 'agent'`: 시간표가 "캐릭터가 대신 골랐어요"를 보인다).
 * 확정 계획은 타임라인을 덮으니 `decide()`가 블록 시작에 다시 고르지 않는다 (isBlockFree 거짓).
 */
export function scenarioPlans(sc: Scenario): Partial<Record<BlockId, BlockPlan>> {
  const out: Partial<Record<BlockId, BlockPlan>> = {};
  // 시나리오에 없는 블록은 비운다 — 부팅 때 에이전트가 옛 집(서울) 기준으로 이미 채워 둔 아침이 남아 있으면 첫 이동이 거기서 출발한다
  for (const b of BLOCKS) if (b.id !== 'sleep' && !sc.blocks[b.id]) out[b.id] = { blockId: b.id, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty' };
  for (const [id, b] of Object.entries(sc.blocks) as [BlockId, NonNullable<Scenario['blocks'][BlockId]>][]) {
    const opt = { id: `${sc.key}-${id}`, title: b.title, reason: b.reason, emoji: b.emoji, placeId: b.placeId, category: b.category, ...(b.friendId ? { friendId: b.friendId } : {}), ...(b.sponsored ? { sponsored: true } : {}) };
    const alts = (b.alts ?? []).map((a, i) => ({ id: `${sc.key}-${id}-alt${i}`, title: a.title, reason: a.reason, emoji: a.emoji, placeId: a.placeId, category: b.category, ...(a.friendId ? { friendId: a.friendId } : {}) }));
    // 고른 카드는 가운데 — 첫 카드가 광고로 읽히지 않게
    const options = alts.length ? [alts[0], opt, ...alts.slice(1)] : [opt];
    out[id] = { blockId: id, category: b.category, options, chosenId: opt.id, chosenBy: 'agent', status: 'confirmed' };
  }
  return out;
}

const SEEDED_KEY = 'theworld.scenario.v1';
/** `&day=YYYY-MM-DD`: 시나리오를 그 날짜로 산다 — 마찰 굴림(rollFriction)이 날짜에 묶여 있어 데모를 같은 날로 고정할 때 (녹화). 없으면 오늘 */
function scenarioDayStart(now: number, tz: string): number {
  const d = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('day') : null;
  return dayStartIn(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`).getTime() : now, tz);
}
export const scenarioParam = (): string | null => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scenario') : null);
export const scenarioSeeded = (key: string): boolean => { try { return localStorage.getItem(SEEDED_KEY) === key; } catch { return false; } };
export const markScenarioSeeded = (key: string | null) => { try { if (key) localStorage.setItem(SEEDED_KEY, key); else localStorage.removeItem(SEEDED_KEY); } catch { /* ignore */ } };

/** 스토어가 뜨기 전에 (main.tsx boot): 시계를 첫 블록 직전으로, 집을 그 도시로, 지난 저장본(하루·앨범·본 것)은 비운다. 이미 심은 시나리오면 아무것도 안 한다 */
export function prepScenario(): void {
  const key = scenarioParam();
  const sc = key ? SCENARIOS[key] : undefined;
  // 강제 마주침은 모듈 상태라 매 부팅 다시 놓는다 (이미 심은 시나리오라도) — 새로고침해도 그 사람들은 거기 있다
  if (sc) seedMeets(sc);
  // `&reset=1`: 이미 심었어도 처음부터 다시 — 표식과 저장본을 지우고 새로 심는다
  const reset = typeof location !== 'undefined' && new URLSearchParams(location.search).has('reset');
  if (!sc || (scenarioSeeded(sc.key) && !reset)) return;
  try {
    markScenarioSeeded(null);
    for (const k of ['theworld.media-queue.v1', 'theworld.chatseen.v1']) localStorage.removeItem(k);
    try { indexedDB.deleteDatabase('theworld-media'); } catch { /* 없으면 없는 대로 */ }
    const tz = sc.home ? tzOf(placeById(sc.home)) : 'Asia/Seoul';
    const now = Date.now();
    // `&at=19:40`: 시작 시각을 덮는다 — 저녁·밤 블록의 방을 바로 본다 (QA)
    const atRaw = new URLSearchParams(location.search).get('at');
    const at = atRaw && /^\d{1,2}:\d{2}$/.test(atRaw) ? atRaw.split(':').map(Number) as [number, number] : sc.startAt;
    const start = scenarioDayStart(now, tz) + at[0] * 3600_000 + at[1] * 60_000;
    localStorage.setItem('theworld.clock.v1', JSON.stringify({ anchorReal: now, anchorSim: start, scale: sc.scale ?? 1 }));
    for (const k of ['theworld.world.v5', 'theworld.world.v4', 'theworld.days.v3', 'theworld.book.v1', 'theworld.seen.v3']) localStorage.removeItem(k);
    if (sc.home) {
      const m = JSON.parse(localStorage.getItem('theworld.memory.v2') || '{}') as Record<string, unknown>;
      localStorage.setItem('theworld.memory.v2', JSON.stringify({ ...m, homePlaceId: sc.home }));
    }
  } catch { /* localStorage가 없으면 시나리오도 없다 */ }
}

/** 시나리오의 강제 마주침을 오늘 날짜로 놓는다 (sim/agents setForcedEncounters). 시각은 그 도시의 현지 자정 기준 */
function seedMeets(sc: Scenario): void {
  const tz = sc.home ? tzOf(placeById(sc.home)) : 'Asia/Seoul';
  const dayStart = scenarioDayStart(Date.now(), tz);
  const dayKey = dayKeyIn(dayStart, tz);
  const at = ([h, m]: [number, number]) => dayStart + h * 3600_000 + m * 60_000;
  for (const [blockId, b] of Object.entries(sc.blocks)) {
    if (!b?.meet) continue;
    setForcedEncounters(`${dayKey}:${blockId}`, b.meet.agentIds.map(agentId => ({ agentId, placeId: b.placeId, arriveAt: at(b.meet!.from), endAt: at(b.meet!.to), at: at(b.meet!.at) })));
  }
}
