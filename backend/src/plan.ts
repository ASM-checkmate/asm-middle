import { PLAN_BLOCKS, PLAN_CATEGORIES, type BlockId, type PlaceType, type PlanBlock, type PlanCategory, type PlanOption, type PlanRequest, type PlanResponse } from './contract.ts';
import { chatJson, type OllamaConfig } from './ollama.ts';

// ─── 하루 계획 (docs/adr/0010-llm-plan.md) ────────────────────────────────────
// 블록마다 "무엇을 할지" 카드 3장을 모델이 짓는다. 장소는 프론트가 보낸 카탈로그의 id만 쓸 수 있고(스키마 enum),
// 범주가 정해진 블록은 그 안에서, 비어 있으면 모델이 범주도 고른다. 언제 시작하고 어디를 거쳐 가는지, 돈·피로에
// 막히는지는 여전히 프론트의 규칙(review·timeline)이 본다 — 모델은 "하고 싶은 것"을 낼 뿐이다.

/** 카드 제목의 최대 길이 ("레이어드에서 커피 한 잔"). 프론트 카드 한 줄. */
export const MAX_TITLE = 24;
/** 이유의 최대 길이 ("지난주에 갔던 곳, 창가 자리 좋았음"). */
export const MAX_REASON = 30;
/** 한 블록에 낼 카드 수. */
export const OPTIONS_PER_BLOCK = 3;

const BLOCK_KO: Record<BlockId, string> = { sleep: '수면(00–07)', morning: '아침(07–09)', am: '오전(09–12)', lunch: '점심(12–14)', pm: '오후(14–18)', evening: '저녁(18–20)', night: '밤(20–24)' };
const CATEGORY_KO: Record<PlanCategory, string> = { meal: '식사', play: '놀기', exercise: '운동', study: '공부', work: '일', rest: '쉬기' };
const WORRY_KO: Record<string, string> = { work: '일', people: '사람', body: '몸', money: '돈', focus: '집중', blue: '기분', bored: '심심함' };
const TYPE_KO: Partial<Record<PlaceType, string>> = {
  home: '집', friend_home: '친구 집', cafe: '카페', restaurant: '식당', park: '공원', gym: '헬스장', school: '학교', library: '도서관', cinema: '영화관',
  mall: '쇼핑몰', river: '강변', beach: '해변', museum: '박물관·명소', arcade: '오락실', bar: '술집', office: '일터', station: '역', airport: '공항', port: '항구',
  temple: '절·신사', market: '시장·거리', hotel: '호텔', stadium: '경기장', mountain: '산', island: '섬',
};
/** 범주마다 말이 되는 장소 유형. 밥을 헬스장에서 먹지 않게 — 여기 없는 조합은 카드에서 뺀다. */
const TYPES_FOR: Record<PlanCategory, readonly PlaceType[]> = {
  meal: ['restaurant', 'cafe', 'market', 'home', 'friend_home', 'hotel', 'bar'],
  play: ['cafe', 'park', 'river', 'beach', 'museum', 'arcade', 'bar', 'mall', 'cinema', 'market', 'temple', 'stadium', 'mountain', 'island', 'friend_home', 'home'],
  exercise: ['gym', 'park', 'river', 'mountain', 'beach', 'stadium', 'home'],
  study: ['library', 'cafe', 'home', 'school', 'museum'],
  work: ['office', 'cafe', 'home', 'library'],
  rest: ['home', 'cafe', 'park', 'river', 'beach', 'hotel', 'friend_home', 'temple', 'library'],
};
const TYPE_EMOJI: Partial<Record<PlaceType, string>> = {
  home: '🏠', friend_home: '🏡', cafe: '☕', restaurant: '🍽️', park: '🌳', gym: '🏋️', school: '🎓', library: '📚', cinema: '🎬', mall: '🛍️', river: '🌊',
  beach: '🏖️', museum: '🏛️', arcade: '🕹️', bar: '🍻', office: '💼', station: '🚄', airport: '✈️', port: '⛴️', temple: '⛩️', market: '🧺', hotel: '🏨', stadium: '🏟️', mountain: '⛰️', island: '🏝️',
};

/**
 * 모델에게 강제하는 응답 형식. placeId는 카탈로그의 id 중 하나만 — 지어낸 장소가 들어올 길이 없다.
 *
 * @param placeIds 카탈로그 id들
 * @param blockIds 지어 달라는 블록들
 */
export const planSchema = (placeIds: string[], blockIds: BlockId[]) => ({
  type: 'object',
  properties: {
    blocks: {
      type: 'array', minItems: blockIds.length, maxItems: blockIds.length,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: blockIds },
          category: { type: 'string', enum: [...PLAN_CATEGORIES] },
          options: {
            type: 'array', minItems: OPTIONS_PER_BLOCK, maxItems: OPTIONS_PER_BLOCK,
            items: {
              type: 'object',
              properties: { placeId: { type: 'string', enum: placeIds }, title: { type: 'string' }, reason: { type: 'string' }, emoji: { type: 'string' } },
              required: ['placeId', 'title', 'reason', 'emoji'],
            },
          },
        },
        required: ['id', 'category', 'options'],
      },
    },
  },
  required: ['blocks'],
} as const);

/**
 * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
 *
 * @param req 요청
 * @returns system(누구이고 어떤 하루인가 + 규칙)과 user(카탈로그 + 블록들)
 */
export function buildPlanPrompt(req: PlanRequest): { system: string; user: string } {
  const { agent: a, status: s } = req;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '딱히 없음');
  const won = (n: number) => `${Math.round(n / 10000)}만 원`;
  const system = [
    `너는 "${a.name}"이다. 자기 하루를 사는 사람이고, 오늘 하루의 시간대마다 무엇을 할지 스스로 정한다.`,
    `성격: ${list(a.traits)}. 좋아하는 것: ${list(a.likes)}. 싫어하는 것: ${list(a.dislikes)}.`,
    `오늘은 ${req.day.dateKey} ${req.day.weekday}. 지금 ${req.city.nameKo}에 있다${req.city.home ? ' (집이 있는 도시)' : ' (여행 중)'}. 지갑 ${won(s.money)}, 피로 ${s.fatigue}/100, 기분 ${s.mood}/100.`,
    req.worry ? `며칠 안에 친구(사용자)가 ${WORRY_KO[req.worry] ?? req.worry} 때문에 힘들다고 했다. 오늘 하루에 그게 조금 묻어나도 좋다.` : '',
    req.visited.length ? `최근에 간 곳: ${req.visited.join(', ')}. 갔던 곳은 "또 가고 싶다"는 이유가 있을 때만.` : '',
    '',
    '규칙:',
    '- 시간대마다 카드 3장. 카드 = 장소(카탈로그 id) + 제목 + 이유 + 이모지. 장소는 반드시 카탈로그의 id만 쓴다.',
    `- 제목은 "장소에서 무엇" 꼴로 ${MAX_TITLE}자 안 ("레이어드에서 그림 그리기", "경의선숲길 산책"). 장소 이름을 넣는다.`,
    `- 이유는 취향·기억·상황에 기대는 한 줄, ${MAX_REASON}자 안, 반말체 명사형 ("창가 자리 좋았음", "요즘 몸이 무거움"). 존댓말 금지.`,
    '- 범주가 정해진 시간대는 그 범주 안에서만. 비어 있으면 네가 고른다: 아침·점심·저녁 시간대는 식사(meal), 나머지는 성격과 상태에 맞게 (피곤하면 쉬기, 기분이 처지면 좋아하는 것, 돈이 없으면 일이나 싼 것).',
    '- 범주와 장소 유형이 맞아야 한다: 식사는 식당·카페·시장·집, 운동은 헬스장·공원·강변·산, 공부는 도서관·카페·집, 일은 일터·카페·집, 쉬기는 집·카페·공원.',
    '- 아침·점심은 가까운 곳(같은 동네), 오후는 멀리 가도 된다. 밤은 집 근처나 집.',
    '- 한 시간대의 카드 3장은 서로 다른 장소. 오늘 이미 잡힌 장소(avoid)와 방금 보여 준 카드(previous)는 피한다.',
    '- 카드 3장이 다 같은 느낌이면 재미없다 — 하나는 무난하게, 하나는 취향에 딱, 하나는 조금 뜻밖에.',
    '- JSON으로만 답한다.',
  ].filter(l => l !== '').join('\n');
  const catalog = req.places.map(p => `- ${p.id}: ${p.name} (${TYPE_KO[p.type] ?? p.type}, ${p.area})`).join('\n');
  const blocks = req.blocks.map(b => [
    `· ${b.id} ${BLOCK_KO[b.id]} — 범주 ${b.category ? CATEGORY_KO[b.category] : '(네가 고른다)'}, 시작할 때 있는 곳: ${b.from}`,
    b.avoid.length ? `  avoid: ${b.avoid.join(', ')}` : '',
    b.previous?.length ? `  previous: ${b.previous.join(' / ')}` : '',
  ].filter(l => l).join('\n')).join('\n');
  const user = ['[갈 수 있는 곳]', catalog, '', '[정할 시간대]', blocks].join('\n');
  return { system, user };
}

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** 이모지 하나만 (ZWJ·변형 선택자 포함). 아니면 빈 문자열. */
const oneEmoji = (v: unknown) => { const s = str(v); const m = s.match(/^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u); return m ? m[0] : ''; };

/**
 * 모델 출력을 계약대로 다듬는다. 순수 함수. 요청에 없는 블록·카탈로그 밖 장소·범주에 안 맞는 장소·겹치는 장소는 버리고,
 * 카드가 2장 미만으로 남은 블록은 통째로 뺀다 (프론트가 규칙으로 채운다). 범주가 정해진 블록은 그 범주로 고정한다.
 *
 * @param raw 모델 출력
 * @param req 요청 (카탈로그와 블록 목록)
 */
export function parsePlan(raw: string, req: PlanRequest): PlanBlock[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  const blocks = (j as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks)) return [];
  const byId = new Map(req.places.map(p => [p.id, p]));
  const asked = new Map(req.blocks.map(b => [b.id, b]));
  const out: PlanBlock[] = [];
  const done = new Set<BlockId>();
  for (const v of blocks) {
    if (!v || typeof v !== 'object') continue;
    const b = v as Record<string, unknown>;
    const id = str(b.id) as BlockId;
    const ask = asked.get(id);
    if (!ask || done.has(id)) continue;
    const category = ask.category ?? (PLAN_CATEGORIES.includes(str(b.category) as PlanCategory) ? (str(b.category) as PlanCategory) : null);
    if (!category) continue;
    const seen = new Set<string>();
    const options: PlanOption[] = [];
    for (const o of Array.isArray(b.options) ? b.options : []) {
      if (!o || typeof o !== 'object') continue;
      const x = o as Record<string, unknown>;
      const placeId = str(x.placeId);
      const place = byId.get(placeId);
      if (!place || seen.has(placeId) || !TYPES_FOR[category].includes(place.type)) continue;
      const title = str(x.title).slice(0, MAX_TITLE);
      if (!title) continue;
      seen.add(placeId);
      options.push({ placeId, title, reason: str(x.reason).slice(0, MAX_REASON) || '왠지 오늘은 여기', emoji: oneEmoji(x.emoji) || TYPE_EMOJI[place.type] || '✨' });
      if (options.length >= OPTIONS_PER_BLOCK) break;
    }
    if (options.length < 2) continue;
    done.add(id);
    out.push({ id, category, options });
  }
  return out;
}

/**
 * 블록들의 카드를 짓는다.
 *
 * @param req 요청
 * @param model 쓸 모델 태그
 * @param cfg Ollama 설정
 * @param timeoutMs 제한 시간 (블록 하나면 짧게, 하루면 길게 — 호출자가 정한다)
 * @throws Ollama 오류·제한 시간 (호출자가 502로 — 프론트는 규칙 카드를 쓴다)
 */
export async function planBlocks(req: PlanRequest, model: string, cfg: OllamaConfig, timeoutMs: number): Promise<PlanResponse> {
  const t0 = Date.now();
  const { system, user } = buildPlanPrompt(req);
  const blockIds = req.blocks.map(b => b.id).filter(id => PLAN_BLOCKS.includes(id));
  const raw = await chatJson(cfg, model, system, user, planSchema(req.places.map(p => p.id), blockIds), undefined, { temperature: 0.7, numPredict: 120 + 260 * blockIds.length, timeoutMs });
  return { blocks: parsePlan(raw, req), model, ms: Date.now() - t0 };
}
