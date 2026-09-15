// ─── 데모 시나리오 (ADR-0029, `?scenario=busan`) ─────────────────────────────────
// 오늘 하루를 통째로 심는다: AI 배경이 있는 부산 네 곳을 점심 → 오후 → 저녁 → 밤 블록에 사용자가 고른 것으로 넣는다.
// 두 단계다 — (1) prepScenario: 스토어가 뜨기 **전**(main.tsx boot)에 시계·집·저장본을 localStorage에 준비한다 (스토어는 모듈이 뜰 때
// 시계를 읽고 지난 블록을 정산하므로, 뒤늦게 시계를 돌리면 서울에서 산 아침이 앨범에 남는다). (2) App의 effect가 seedPlans로 블록을 심고
// 표식을 남긴다 — 한 번만, 새로고침해도 하루가 이어진다. `dev=1`처럼 개발용이고 제품 경로에는 없다.
import type { BlockId, BlockPlan, Category } from '../sim/types';
import { BLOCKS } from '../sim/blocks';
import { dayStartIn } from '../sim/tz';
import { placeById, tzOf } from '../sim/places';

export interface Scenario {
  key: string;
  /** 첫 블록 직전으로 시계를 옮긴다 (시:분) */
  startAt: [number, number];
  /** 시계 배속 (x30 — 활동 하나가 3~6분) */
  scale?: number;
  /** 캐릭터의 집 (그 도시에 산다) — 없으면 기억의 집 그대로 */
  home?: string;
  blocks: Partial<Record<BlockId, { title: string; reason: string; emoji: string; placeId: string; category: Category; friendId?: string }>>;
}

export const SCENARIOS: Record<string, Scenario> = {
  busan: {
    key: 'busan',
    startAt: [15, 55],
    scale: 30,
    home: 'busan-home',
    // 블록은 오후·저녁·밤 셋뿐이다 — 광안리 드론쇼는 같은 해변의 삼진포차 자리(해변 난간·드론쇼 앞)로 찍는다
    blocks: {
      // 세 일정 다 민수와 — 같이 수업 듣고 그대로 광안리까지
      pm: { title: '부산대에서 민수랑 수업 듣기', reason: '오후 수업, 끝나면 같이 광안리로', emoji: '🏫', placeId: 'pnu', category: 'study', friendId: 'minsu' },
      evening: { title: '조새호에서 민수랑 조개구이', reason: '창가 자리에 광안대교', emoji: '🦪', placeId: 'josaeho', category: 'meal', friendId: 'minsu' },
      night: { title: '삼진포차에서 민수랑 한잔', reason: '드론쇼 보고 바다 앞에서', emoji: '🍶', placeId: 'samjin-pocha', category: 'play', friendId: 'minsu' },
    },
  },
};

/** 시나리오의 블록 계획 — 사용자가 확정한 카드 한 장짜리 */
export function scenarioPlans(sc: Scenario): Partial<Record<BlockId, BlockPlan>> {
  const out: Partial<Record<BlockId, BlockPlan>> = {};
  // 시나리오에 없는 블록은 비운다 — 부팅 때 에이전트가 옛 집(서울) 기준으로 이미 채워 둔 아침이 남아 있으면 첫 이동이 거기서 출발한다
  for (const b of BLOCKS) if (b.id !== 'sleep' && !sc.blocks[b.id]) out[b.id] = { blockId: b.id, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty' };
  for (const [id, b] of Object.entries(sc.blocks) as [BlockId, NonNullable<Scenario['blocks'][BlockId]>][]) {
    const opt = { id: `${sc.key}-${id}`, title: b.title, reason: b.reason, emoji: b.emoji, placeId: b.placeId, category: b.category, ...(b.friendId ? { friendId: b.friendId } : {}) };
    out[id] = { blockId: id, category: b.category, options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' };
  }
  return out;
}

const SEEDED_KEY = 'theworld.scenario.v1';
export const scenarioParam = (): string | null => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scenario') : null);
export const scenarioSeeded = (key: string): boolean => { try { return localStorage.getItem(SEEDED_KEY) === key; } catch { return false; } };
export const markScenarioSeeded = (key: string | null) => { try { if (key) localStorage.setItem(SEEDED_KEY, key); else localStorage.removeItem(SEEDED_KEY); } catch { /* ignore */ } };

/** 스토어가 뜨기 전에 (main.tsx boot): 시계를 첫 블록 직전으로, 집을 그 도시로, 지난 저장본(하루·앨범·본 것)은 비운다. 이미 심은 시나리오면 아무것도 안 한다 */
export function prepScenario(): void {
  const key = scenarioParam();
  const sc = key ? SCENARIOS[key] : undefined;
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
    const start = dayStartIn(now, tz) + at[0] * 3600_000 + at[1] * 60_000;
    localStorage.setItem('theworld.clock.v1', JSON.stringify({ anchorReal: now, anchorSim: start, scale: sc.scale ?? 1 }));
    for (const k of ['theworld.world.v5', 'theworld.world.v4', 'theworld.days.v3', 'theworld.book.v1', 'theworld.seen.v3']) localStorage.removeItem(k);
    if (sc.home) {
      const m = JSON.parse(localStorage.getItem('theworld.memory.v2') || '{}') as Record<string, unknown>;
      localStorage.setItem('theworld.memory.v2', JSON.stringify({ ...m, homePlaceId: sc.home }));
    }
  } catch { /* localStorage가 없으면 시나리오도 없다 */ }
}
