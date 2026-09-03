import type { ActivityOption, BlockId, Category, Memory, Place, PlaceType } from './types';
import type { CompanionCtx } from './agents';
import { PLACES, placeById, cityNameKo } from './places';
import { rng } from './rng';
import { haversineKm } from './geo';
import { nextBlockId } from './blocks';

// Rule-based proposal engine: 3 concrete activities for a block, grounded in category + memory + past
// visits + friends. Specific, never repetitive within a day, walkable in the morning / at lunch, farther
// in the afternoon. (An LLM can replace this later; keep the signature.)

export interface SuggestCtx {
  dateKey: string;
  blockId: BlockId;
  category: Category;
  memory: Memory;
  from: Place;
  regenSalt?: number;
  /** Places already proposed/chosen in other blocks today — they are avoided (soft: used only if nothing else fits). */
  usedPlaceIds?: string[];
  /** Who can come along in this block (FRIENDS_SPEC §3). Without it no companion variant is offered. */
  companions?: CompanionCtx;
}

type R = ReturnType<typeof rng>;

interface Idea {
  types: PlaceType[];
  blocks?: BlockId[];                                   // blocks this idea fits (undefined = any)
  emoji: string;
  alt?: string[];                                       // fallback emojis when the first is already used
  titles: ((p: Place, c: SuggestCtx, r: R) => string)[];
  reasons: string[];                                    // {like} {friend} {trait} {area} {name}
  friend?: boolean;                                     // 동행 버전: needs a free friend; sets friendId (never a name in the title)
}

// ─── vocabulary ───────────────────────────────────────────────────────────
const MEAL_WORD: Record<BlockId, string> = { sleep: '야식', morning: '아침', am: '브런치', lunch: '점심', pm: '늦은 점심', evening: '저녁', night: '야식' };
const LATE: BlockId[] = ['evening', 'night'];
const DAY: BlockId[] = ['morning', 'am', 'lunch', 'pm'];
const BUSY: BlockId[] = ['am', 'pm', 'evening', 'night'];
const OUT: BlockId[] = ['am', 'lunch', 'pm', 'evening'];

/** How far (km) a block should normally roam from where the character is. */
const REACH: Record<BlockId, number> = { sleep: 1, morning: 2.2, am: 8, lunch: 3, pm: 30, evening: 7, night: 10 };

const hasLike = (m: Memory, ...keys: string[]) => m.likes.some(l => keys.some(k => l.includes(k)));
const short = (p: Place) => p.name.replace(/\s*\(.*\)$/, '');
const isMorning = (b: BlockId) => b === 'morning' || b === 'am';
/** Korean "(으)로" particle: 뉴욕으로, 도쿄로, 서울로. */
const ro = (w: string) => { const c = w.charCodeAt(w.length - 1); if (c < 0xac00 || c > 0xd7a3) return `${w}로`; const t = (c - 0xac00) % 28; return t === 0 || t === 8 ? `${w}로` : `${w}으로`; };
const themePark = (p: Place) => /월드|스튜디오|랜드/.test(p.name);
/** "이태원동 케르반 이태원" → "케르반 이태원": prefix the neighbourhood only when the name doesn't carry it already. */
const areaName = (p: Place) => p.name.includes(p.area.replace(/동$/, '')) ? short(p) : `${p.area} ${short(p)}`;

// ─── ideas per category ───────────────────────────────────────────────────
const IDEAS: Record<Exclude<Category, 'sleep' | 'travel'>, Idea[]> = {
  meal: [
    { types: ['restaurant'], emoji: '🍚', alt: ['🍜', '🍛'],
      titles: [(p, c) => `${short(p)}에서 ${MEAL_WORD[c.blockId]}`, (p, c) => `${short(p)} 가서 ${MEAL_WORD[c.blockId]} 든든하게`, (p, c) => `${areaName(p)}에서 ${MEAL_WORD[c.blockId]}`],
      reasons: ['요즘 자꾸 생각나던 집', '{like}만큼 좋아하는 집', '지난번에 못 먹은 메뉴가 있음', '{trait} 성격이라 웨이팅 없는 시간 노림', '이 동네 오면 꼭 들르는 곳'] },
    { types: ['market'], blocks: ['lunch', 'pm', 'evening', 'night'], emoji: '🥟', alt: ['🍢', '🧺'],
      titles: [p => `${short(p)}에서 먹거리 투어`, p => `${short(p)} 돌면서 군것질`, p => `${short(p)}에서 전이랑 떡볶이`],
      reasons: ['시장 음식은 실패가 없음', '한 바퀴 돌면 배부름', '{like} 좋아하면 시장 구경도 좋아할 듯', '거기 이모님이 덤을 잘 주심'] },
    { types: ['cafe'], blocks: ['morning', 'am', 'lunch'], emoji: '🥐', alt: ['🍞', '🥯'],
      titles: [p => `${short(p)}에서 브런치`, p => `${short(p)}에서 빵이랑 커피`, p => `${short(p)} 갓 구운 빵 타임`],
      reasons: ['아침엔 여기가 한산함', '창가 자리 좋았음', '빵 나오는 시간이 딱 지금', '{trait} 아침엔 가볍게'] },
    { types: ['home'], emoji: '🍳', alt: ['🍲', '🥘'],
      titles: [(_p, c) => LATE.includes(c.blockId) ? '집에서 라면 끓여 먹기' : '집에서 요리해 먹기', () => '냉장고 털어서 볶음밥', () => '집에서 계란밥 뚝딱'],
      reasons: ['냉장고에 재료가 남아 있음', '{trait} 성격이라 집밥이 편함', '어제 장 본 게 있음', '밖에 나가기 귀찮은 날'] },
    { types: ['bar'], blocks: LATE, emoji: '🍢', alt: ['🍻'],
      titles: [p => `${short(p)}에서 안주랑 한 잔`, p => `${short(p)}에서 야식`],
      reasons: ['밤엔 여기 분위기가 최고', '{friend}가 여기 안주 맛있대', '{like} 얘기하기 좋은 곳'] },
    { types: ['friend_home'], friend: true, emoji: '🍲', alt: ['🥘'],
      titles: [(p, c) => `${short(p)}에서 ${MEAL_WORD[c.blockId]} 해 먹기`, p => `${short(p)} 가서 밥 얻어먹기`],
      reasons: ['{friend}가 요리 실력 자랑하고 싶대', '{friend}네 냉장고가 가득하다고 함'] },
    // ── 동행 버전 (제목엔 이름 없음; 누구랑 가는지는 friendId로만) ──
    { types: ['restaurant'], friend: true, emoji: '🍽️', alt: ['🍻'],
      titles: [(p, c) => `${short(p)}에서 같이 ${MEAL_WORD[c.blockId]}`, p => `${short(p)} 둘이서 한 상`],
      reasons: ['{friend} 에이전트도 그 시간 비어 있음', '{friend}가 여기 먹고 싶다고 함', '{friend}랑 밀린 얘기 많음'] },
    { types: ['bar'], friend: true, blocks: LATE, emoji: '🍻', alt: ['🍢'],
      titles: [p => `${short(p)}에서 같이 한 잔`, p => `${short(p)} 안주 투어`],
      reasons: ['{friend}랑 밀린 얘기 많음', '{friend}가 같이 가자고 함', '거기 라이브 있는 날'] },
    { types: ['market'], friend: true, blocks: ['lunch', 'pm', 'evening'], emoji: '🥟', alt: ['🍡'],
      titles: [p => `${short(p)}에서 같이 먹방`, p => `${short(p)} 골목 먹거리 나눠 먹기`],
      reasons: ['{friend}가 시장 음식 좋아함', '둘이 가면 더 많이 먹을 수 있음'] },
  ],
  play: [
    { types: ['cafe'], emoji: '☕', alt: ['🎨', '🫖'],
      titles: [(p, c) => hasLike(c.memory, '그림') ? `${short(p)}에서 그림 그리기` : `${short(p)}에서 멍때리기`, p => `${short(p)} 신메뉴 먹어보기`, p => `${short(p)} 창가에서 사람 구경`],
      reasons: ['지난주에 갔던 곳, 창가 자리 좋았음', '{tlike} 하기 좋은 분위기', '음악 취향이 딱 맞는 곳', '{trait} 성격에 잘 맞는 조용한 곳'] },
    { types: ['home'], emoji: '🎮', alt: ['📺', '🎧'],
      titles: [() => '집에서 게임하기', () => '밀린 드라마 정주행', () => '집에서 음악 크게 틀고 춤'],
      reasons: ['어젯밤에 못 깬 스테이지', '밖에 나가기 귀찮은 날', '새 에피소드 올라옴', '{trait} 성격이라 집이 제일 편함'] },
    { types: ['river'], emoji: '🛹', alt: ['🚲', '🪁'],
      titles: [(p, c) => hasLike(c.memory, '스케이트보드') ? `${short(p)}에서 스케이트보드` : `${short(p)}에서 자전거`, p => `${short(p)} 돗자리 펴고 뒹굴기`, p => `${short(p)}에서 라면 끓여 먹기`],
      reasons: ['{friend} 에이전트도 같은 시간에 한강', '날씨가 좋아 보임', '{tlike} 하기엔 한강이 최고', '노을 시간 맞춰 가면 완벽'] },
    { types: ['park'], emoji: '📷', alt: ['🌳', '🍃'],
      titles: [p => `${short(p)} 산책하며 사진 찍기`, p => `${short(p)}에서 비눗방울 놀이`, p => `${short(p)} 벤치에서 그림 그리기`],
      reasons: ['사진 찍기 좋은 날씨', '{friend}가 거기 강아지 많다고 함', '바람 쐬고 싶음'] },
    { types: ['arcade'], blocks: BUSY, emoji: '🕹️', alt: ['🎯', '🎡'],
      titles: [p => themePark(p) ? `${short(p)}에서 놀이기구 타기` : `${short(p)}에서 오락실 한 판`, p => themePark(p) ? `${short(p)} 퍼레이드 보기` : `${short(p)} 인형뽑기 도전`, p => themePark(p) ? `${short(p)} 자유이용권 뽕뽑기` : `${short(p)}에서 리듬게임`],
      reasons: ['지난번 최고 기록 깨보기', '{friend}한테 진 거 복수', '동전 모아둔 게 있음', '{trait} 성격도 여기선 신남'] },
    { types: ['cinema'], blocks: BUSY, emoji: '🎬', alt: ['🍿'],
      titles: [p => `${short(p)}에서 영화 보기`, (p, c) => isMorning(c.blockId) ? `${short(p)} 조조로 영화` : c.blockId === 'night' ? `${short(p)}에서 심야 영화` : `${short(p)}에서 팝콘이랑 영화`],
      reasons: ['보고 싶던 게 개봉함', '평일 낮은 자리가 널널함', '{like} 나오는 영화라고 함'] },
    { types: ['mall'], blocks: OUT, emoji: '🛍️', alt: ['🎁'],
      titles: [p => `${short(p)} 구경`, p => `${short(p)} 윈도쇼핑`, p => `${short(p)} 팝업스토어 구경`],
      reasons: ['지하철 타고 가면 금방', '팝업스토어 열렸다고 함', '{like} 굿즈 있을지도'] },
    { types: ['market'], blocks: ['lunch', 'pm', 'evening'], emoji: '🏮', alt: ['🍡'],
      titles: [p => `${short(p)} 골목 구경`, p => `${short(p)}에서 군것질하며 구경`],
      reasons: ['거기 골목이 예쁘다고 함', '{friend}가 추천한 곳', '사진 찍기 좋은 곳'] },
    { types: ['museum'], blocks: DAY, emoji: '🎨', alt: ['🏛️'],
      titles: [p => `${short(p)} 전시 보기`, p => `${short(p)}에서 그림 구경`],
      reasons: ['{like} 관련 전시 중', '조용히 걷기 좋은 곳', '한동안 전시를 못 봄'] },
    { types: ['mountain'], blocks: ['pm', 'evening', 'night'], emoji: '🌆', alt: ['🗼'],
      titles: [p => `${short(p)} 올라가서 야경`, p => `${short(p)} 케이블카 타기`],
      reasons: ['야경 보기 좋은 날', '{friend}랑 전부터 가자고 했던 곳'] },
    { types: ['bar'], blocks: LATE, emoji: '🎶', alt: ['🍻'],
      titles: [p => `${short(p)}에서 라이브 듣기`, p => `${short(p)}에서 한 잔`],
      reasons: ['오늘 라이브 있는 날', '밤엔 여기가 제일 좋음', '{like} 얘기 실컷 하기'] },
    { types: ['beach'], emoji: '🏖️', alt: ['🌊'],
      titles: [p => `${short(p)}에서 물놀이`, p => `${short(p)} 모래사장 산책`],
      reasons: ['{tlike} 좋아하니까', '파도 소리 듣고 싶음'] },
    { types: ['temple'], blocks: DAY, emoji: '🏯', alt: ['🏮'],
      titles: [p => `${short(p)} 둘러보기`, p => `${short(p)} 마당 한 바퀴`],
      reasons: ['안 가본 곳이라 궁금함', '사진 찍기 좋은 곳', '조용히 걷고 싶은 날'] },
    { types: ['stadium'], blocks: DAY, emoji: '⚽', alt: ['🏟️'],
      titles: [p => `${short(p)} 구경하기`, p => `${short(p)} 한 바퀴`],
      reasons: ['오늘 경기 있는 날', '넓은 데서 뛰어놀고 싶음'] },
    // ── 동행 버전 (예전 '만남' 범주가 여기로 들어왔다; 제목엔 이름 없음) ──
    { types: ['friend_home'], friend: true, emoji: '👋', alt: ['🏡'],
      titles: [p => `${short(p)}에 놀러 가기`, p => `${short(p)}에서 게임 대결`],
      reasons: ['{friend}가 새 게임 샀다고 함', '한동안 못 봄', '{friend}네 강아지 보고 싶음'] },
    { types: ['cafe'], friend: true, emoji: '🍰', alt: ['☕'],
      titles: [p => `${short(p)}에서 수다 떨기`, p => `${short(p)} 디저트 나눠 먹기`],
      reasons: ['{friend}가 여기 케이크 먹어보고 싶대', '조용해서 얘기하기 좋음', '{friend} 에이전트도 그 시간 비어 있음'] },
    { types: ['river', 'park'], friend: true, emoji: '🧺', alt: ['🍃'],
      titles: [p => `${short(p)}에서 피크닉`, p => `${short(p)} 같이 산책`],
      reasons: ['둘 다 좋아하는 곳', '날씨가 딱 피크닉', '{friend}가 돗자리 있대'] },
    { types: ['arcade'], friend: true, blocks: BUSY, emoji: '🎯', alt: ['🕹️'],
      titles: [p => `${short(p)}에서 오락실 대결`, p => `${short(p)} 인형뽑기 내기`],
      reasons: ['지난번엔 {friend}가 이김', '리벤지 매치'] },
    { types: ['cinema'], friend: true, blocks: BUSY, emoji: '🍿', alt: ['🎬'],
      titles: [p => `${short(p)}에서 같이 영화`, p => `${short(p)} 팝콘 반반`],
      reasons: ['{friend}도 보고 싶어 하던 영화', '팝콘은 반반'] },
  ],
  exercise: [
    { types: ['gym'], emoji: '🏋️', alt: ['🧗', '💪'],
      titles: [p => p.name.includes('클라임') ? `${short(p)}에서 클라이밍` : `${short(p)}에서 운동`, p => `${short(p)}에서 하체 루틴`, p => `${short(p)}에서 러닝머신 30분`],
      reasons: ['이번 주 아직 한 번도 안 감', '{trait} 성격에 루틴이 중요', '새 운동화 신어볼 날', '{friend}가 같이 가자고 함'] },
    { types: ['river'], emoji: '🏃', alt: ['🚲'],
      titles: [p => `${short(p)} 러닝`, p => `${short(p)} 자전거`, p => `${short(p)} 따라 걷기 1만 보`],
      reasons: ['강바람 맞으면서 뛰기 좋은 시간', '지난번 기록 깨보기', '{tlike} 겸 운동'] },
    { types: ['park'], emoji: '🚶', alt: ['🍃'],
      titles: [p => `${short(p)} 빠르게 걷기`, p => `${short(p)}에서 줄넘기`, p => `${short(p)} 한 바퀴 조깅`],
      reasons: ['가까워서 부담 없음', '공기 마시며 몸 풀기', '{trait} 성격엔 가벼운 운동이 딱'] },
    { types: ['mountain'], blocks: ['am', 'pm'], emoji: '⛰️', alt: ['🥾'],
      titles: [p => `${short(p)} 가볍게 오르기`, p => `${short(p)} 정상 찍기`],
      reasons: ['정상에서 보는 뷰가 좋다고 들음', '오후니까 좀 멀리 가도 됨', '{friend}랑 등산 약속'] },
    { types: ['home'], emoji: '🧘', alt: ['🤸'],
      titles: [() => '집에서 홈트 30분', () => '요가 매트 펴고 스트레칭', () => '집에서 플랭크 챌린지'],
      reasons: ['비 올 것 같음', '{trait} 성격이라 집에서 하는 게 편함', '유튜브에 새 루틴 올라옴'] },
    { types: ['stadium'], blocks: DAY, emoji: '⚽', alt: ['🏟️'],
      titles: [p => `${short(p)} 트랙 뛰기`, p => `${short(p)}에서 축구 보기`],
      reasons: ['트랙이 넓어서 뛰기 좋음', '오늘 경기 있는 날'] },
    { types: ['beach'], emoji: '🏊', alt: ['🌊'],
      titles: [p => `${short(p)}에서 수영`, p => `${short(p)} 모래 위 달리기`],
      reasons: ['{tlike} 좋아하니까', '파도랑 놀기 좋은 날'] },
  ],
  study: [
    { types: ['library'], emoji: '📚', alt: ['📖'],
      titles: [p => `${short(p)}에서 책 읽기`, p => `${short(p)}에서 두 챕터 끝내기`, p => `${short(p)} 신간 코너 구경`],
      reasons: ['{like} 관련 책 빌려둠', '조용한 데서 집중하고 싶음', '반납일이 내일', '창가 자리가 좋았음'] },
    { types: ['cafe'], emoji: '✏️', alt: ['📝'],
      titles: [p => `${short(p)}에서 공부`, p => `${short(p)}에서 노트 정리`],
      reasons: ['콘센트 자리 있음', '집중 잘 되던 곳', '{trait} 성격엔 적당한 소음이 도움'] },
    { types: ['home'], emoji: '💻', alt: ['🖥️'],
      titles: [() => '집에서 온라인 강의', () => '책상 정리하고 책 한 챕터', () => '집에서 단어 외우기'],
      reasons: ['밀린 강의 3개', '비 올 것 같음', '{trait} 성격이라 혼자가 편함'] },
    { types: ['school'], blocks: DAY, emoji: '🎓', alt: ['🏫'],
      titles: [p => `${short(p)} 도서관에서 공부`, p => `${short(p)} 빈 강의실 찾기`],
      reasons: ['학교 도서관이 제일 조용함', '{friend}도 거기 있다고 함'] },
    { types: ['museum'], blocks: DAY, emoji: '🏛️', alt: ['🎨'],
      titles: [p => `${short(p)} 도슨트 듣기`, p => `${short(p)}에서 배우며 구경`],
      reasons: ['{like} 관련 전시 중', '보면서 배우는 게 더 잘 됨'] },
  ],
  work: [
    { types: ['office'], emoji: '💼', alt: ['🏢'],
      titles: [p => `${short(p)} 출근`, p => `${short(p)}에서 집중 작업`],
      reasons: ['오늘 회의 있음', '마감이 코앞', '{trait} 성격이라 공간 바꾸면 잘 됨'] },
    { types: ['cafe'], emoji: '💻', alt: ['☕'],
      titles: [p => `${short(p)}에서 노트북 작업`, p => `${short(p)}에서 메일 정리`],
      reasons: ['와이파이 빠름', '동네라 걸어갈 수 있음', '콘센트 자리 있음'] },
    { types: ['home'], emoji: '🖥️', alt: ['🏠'],
      titles: [() => '집에서 재택', (_p, c) => isMorning(c.blockId) ? '집에서 오전 업무 끝내기' : '집에서 밀린 업무 정리'],
      reasons: ['{trait} 성격이라 혼자 하는 게 편함', '오늘은 통화만 두 개'] },
    { types: ['library'], emoji: '📝', alt: ['📚'],
      titles: [p => `${short(p)}에서 자료 조사`, p => `${short(p)}에서 기획서 쓰기`],
      reasons: ['조용해서 글이 잘 써짐', '참고 자료가 거기 있음'] },
  ],
  rest: [
    { types: ['home'], emoji: '🛋️', alt: ['😴', '🎧'],
      titles: [() => '집에서 낮잠', () => '집에서 음악 들으며 뒹굴기', () => '이불 속에서 만화책'],
      reasons: ['어제 늦게 잠', '{trait} 성격이라 충전 필요', '오늘은 아무것도 안 하는 날'] },
    { types: ['park', 'river'], emoji: '🍃', alt: ['🌳'],
      titles: [p => `${short(p)} 벤치에서 멍때리기`, p => `${short(p)} 그늘에서 낮잠`],
      reasons: ['바람 쐬고 싶음', '가까워서 부담 없음', '나무 그늘이 좋은 곳'] },
    { types: ['cafe'], emoji: '📖', alt: ['🫖'],
      titles: [p => `${short(p)}에서 책 읽으며 쉬기`, p => `${short(p)}에서 차 한 잔`],
      reasons: ['조용한 오후에 딱', '창가 자리 좋았음', '{tlike} 하기도 좋은 곳'] },
    { types: ['temple'], blocks: DAY, emoji: '🍵', alt: ['🏮'],
      titles: [p => `${short(p)} 툇마루에 앉아 있기`, p => `${short(p)} 마당 천천히 걷기`],
      reasons: ['조용해서 머리가 맑아짐', '풍경 소리 듣고 싶음'] },
    { types: ['beach'], emoji: '🌅', alt: ['🌊'],
      titles: [p => `${short(p)}에서 파도 소리 듣기`],
      reasons: ['{tlike} 좋아하니까', '아무것도 안 하고 바다만'] },
    { types: ['library'], emoji: '📰', alt: ['📚'],
      titles: [p => `${short(p)}에서 잡지 넘기기`],
      reasons: ['에어컨 빵빵하고 조용함', '아무 생각 없이 보기 좋음'] },
    { types: ['friend_home'], friend: true, emoji: '🛋️', alt: ['🏡'],
      titles: [p => `${short(p)} 소파에서 뒹굴기`, p => `${short(p)}에서 아무것도 안 하기`],
      reasons: ['{friend}네가 제일 편함', '조용히 같이 있기 좋은 날', '한동안 못 봄'] },
    // 숙소 (hotels only exist in far-away cities, so this never shows at home): the evening/night of a trip ends in bed
    { types: ['hotel'], blocks: LATE, emoji: '🛏️', alt: ['🏨', '🛁'],
      titles: [p => `${short(p)}에서 쉬기`, p => `${short(p)} 체크인하고 뒹굴기`, p => `${short(p)} 침대에서 발 뻗기`],
      reasons: ['오늘은 숙소에서 충전', '침대가 부르는 밤', '{trait} 성격이라 저녁엔 숙소가 편함', '내일을 위해 일찍 쉬기'] },
  ],
};

// ─── helpers ──────────────────────────────────────────────────────────────
const GENERIC_EMOJI = ['✨', '🌈', '🎈', '🍀', '🐾', '🌼', '🎀', '🧸'];
function pickEmoji(cands: string[], used: Set<string>): string {
  for (const e of cands) if (!used.has(e)) { used.add(e); return e; }
  for (const e of GENERIC_EMOJI) if (!used.has(e)) { used.add(e); return e; }
  return cands[0];
}

/** A like that actually matches this place type (for "{tlike}"), or null. */
const likeHit = (m: Memory, p: Place, r: R): string | null => {
  const KEYS: Partial<Record<PlaceType, string[]>> = {
    cafe: ['카페', '커피', '그림', '책'], beach: ['바다', '수영'], river: ['스케이트보드', '자전거', '한강', '러닝'], park: ['산책', '사진', '강아지'],
    library: ['책', '공부'], gym: ['운동', '클라이밍'], cinema: ['영화'], arcade: ['게임'], museum: ['전시', '그림'], market: ['먹는 거', '시장'],
  };
  const keys = KEYS[p.type] ?? [];
  const hit = m.likes.filter(l => keys.some(k => l.includes(k)));
  return hit.length ? r.pick(hit) : null;
};

function fill(s: string, m: Memory, p: Place, r: R, friendName?: string): string {
  return s
    .replace(/\{tlike\}/g, likeHit(m, p, r) ?? (m.likes.length ? r.pick(m.likes) : '이런 거'))
    .replace(/\{like\}/g, m.likes.length ? r.pick(m.likes) : '이런 거')
    .replace(/\{friend\}/g, friendName ?? (m.friends.length ? r.pick(m.friends).name : '친구'))
    .replace(/\{trait\}/g, m.traits.length ? r.pick(m.traits) : '느긋한')
    .replace(/\{area\}/g, p.area)
    .replace(/\{name\}/g, short(p));
}

const visitedRecently = (m: Memory, id: string) => m.visited.some(v => v.placeId === id);

/** Memory-grounded reasons that depend on this specific place. */
function dynamicReasons(ctx: SuggestCtx, p: Place, dKm: number): string[] {
  const out: string[] = [];
  if (p.type === 'home') return out;
  if (visitedRecently(ctx.memory, p.id)) out.push('지난번에 갔던 곳, 또 가고 싶음', '저번에 좋았던 기억이 남아 있음');
  const nearFriend = ctx.memory.friends.find(f => { try { return haversineKm(placeById(f.homePlaceId), p) < 1.5; } catch { return false; } });
  if (nearFriend) out.push(`${nearFriend.name}네 집이랑 가까움`, `${nearFriend.name} 에이전트도 같은 시간에 근처`);
  if (dKm < 0.9) out.push('걸어서 10분, 동네라 편함');
  else if (dKm < 1.7) out.push('슬슬 걸어가기 좋은 거리');
  else if (dKm > 5 && ctx.blockId === 'pm') out.push('오후니까 좀 멀리 가도 됨', '지하철 타고 가면 금방');
  else if (dKm > 5 && ctx.blockId === 'am') out.push('오전이니까 좀 멀리 가도 됨', '지하철 타고 가면 금방');
  return out;
}

/** Score-and-pick one place for an idea: near for morning/lunch, far allowed for pm; avoid places used elsewhere today. */
function pickPlace(cands: Place[], ctx: SuggestCtx, r: R, softUsed: Set<string>, relaxed: boolean): Place | null {
  const reach = REACH[ctx.blockId];
  // Strict passes: only places inside the block's reach and not already proposed today.
  if (!relaxed) cands = cands.filter(p => haversineKm(ctx.from, p) <= reach * 1.25 && !softUsed.has(p.id));
  if (!cands.length) return null;
  const scored = cands.map(p => {
    const d = haversineKm(ctx.from, p);
    let s = d + r.next() * Math.max(1.0, reach * 0.5);   // per-block jitter so different blocks rotate through the nearby places
    if (d > reach) s += (d - reach) * 3;                   // over the block's reach: strongly disfavoured
    if (softUsed.has(p.id)) s += reach * 4 + 20;           // already proposed today: only if nothing else
    if (visitedRecently(ctx.memory, p.id)) s -= reach * 0.15;
    return { p, s };
  }).sort((a, b) => a.s - b.s);
  return r.pick(scored.slice(0, Math.min(4, scored.length))).p;
}

/** Trips to another city take the rest of the day from this block (so the journey fits). */
function spanFor(blockId: BlockId, p: Place, from: Place): BlockId[] {
  const far = p.country !== 'KR' || p.city === 'jeju' || p.city === 'udo';
  const veryFar = haversineKm(from, p) > 3000;
  const span: BlockId[] = [blockId];
  let n = nextBlockId(blockId);
  let count = veryFar ? 6 : far ? 3 : 2;
  while (n && n !== 'sleep' && count-- > 0) { span.push(n); n = nextBlockId(n); }
  return span;
}

type TripKind = 'train' | 'boat' | 'plane-near' | 'plane-far';
const tripKind = (from: Place, p: Place): TripKind => {
  if (p.reachBy === 'boat') return 'boat';
  if (p.country === from.country && p.city !== 'jeju' && p.city !== 'udo') return 'train';
  return haversineKm(from, p) > 3000 ? 'plane-far' : 'plane-near';
};
/** "우도 우도 서빈백사" → "우도 서빈백사": drop the city when the place name already starts with it. */
const cityName = (c: string, p: Place) => short(p).startsWith(c) ? short(p) : `${c} ${short(p)}`;
const TRIP_TITLES: Record<TripKind, ((city: string, p: Place) => string)[]> = {
  train: [(c, p) => `${cityName(c, p)} 당일치기`, (c, p) => `KTX 타고 ${cityName(c, p)}`, (c, p) => `${c}까지 가서 ${short(p)}`],
  boat: [(c, p) => `배 타고 ${cityName(c, p)}`, (c, p) => `${cityName(c, p)}까지 뱃길로`],
  'plane-near': [(c, p) => `${c}행 비행기, ${short(p)}`, (c, p) => `${cityName(c, p)} 보러 가기`],
  'plane-far': [(c, p) => `${ro(c)} 훌쩍, ${short(p)}`, (c, p) => `${cityName(c, p)}까지 날아가기`],
};
const TRIP_REASONS: Record<TripKind, string[]> = {
  train: ['기차 타고 창밖 보는 거 좋아함', '{friend}랑 전부터 얘기하던 곳', '기차역 계란이랑 사이다 생각남', '당일치기로 딱 좋은 거리'],
  boat: ['배 위에서 갈매기 보고 싶음', '바다 건너는 것도 여행의 맛', '뱃길로 가는 게 더 낭만', '{trait} 성격엔 배가 딱'],
  'plane-near': ['비행기 창가 자리 찜해둠', '평일에 가면 한산하다고 함', '{friend}가 거기 사진 보여줌', '짧은 비행, 긴 여운'],
  'plane-far': ['한 번은 꼭 가보고 싶었던 곳', '{friend}랑 전부터 얘기하던 곳', '{trait} 성격이라 큰 결심 한 번', '멀리 갈수록 이야기가 많아짐'],
};
const TRIP_EMOJI: Record<TripKind, string> = { train: '🚄', boat: '⛴️', 'plane-near': '✈️', 'plane-far': '🛫' };
/** Nights a trip keeps the character there before the agent books the way home (FRIENDS_SPEC §5). 당일치기 = 0. */
const STAY_NIGHTS: Record<string, number> = {
  busan: 1, gangneung: 1, gyeongju: 1, jeonju: 1, yeosu: 1, jeju: 2, udo: 2,
  fukuoka: 2, tokyo: 2, osaka: 2, taipei: 2, newyork: 3,
};
export const stayDaysFor = (p: Place, title = '') => title.includes('당일치기') ? 0 : STAY_NIGHTS[p.city] ?? (p.country !== 'KR' ? 2 : 1);
/** 체류 칩: 국내는 당일치기·1박·2박, 해외는 1·2·3·5박 (FRIENDS_SPEC §5). */
export const STAY_CHOICES = (o: ActivityOption): number[] => {
  let domestic = true;
  try { domestic = placeById(o.placeId).country === 'KR'; } catch { /* unknown place → domestic chips */ }
  return domestic ? [0, 1, 2] : [1, 2, 3, 5];
};
/** The same option with `n` nights — the title's "(n박)" / "당일치기" suffix is rewritten to match. */
export function withStayDays(o: ActivityOption, n: number): ActivityOption {
  const base = o.title.replace(/\s*\(\d+박\)\s*$/, '').replace(/\s*당일치기\s*$/, '').trim();
  return { ...o, title: n > 0 ? `${base} (${n}박)` : `${base} 당일치기`, stayDays: n };
}

function travelOptions(ctx: SuggestCtx, r: R, softUsed: Set<string>): ActivityOption[] {
  const HUB: PlaceType[] = ['station', 'airport', 'port'];
  const home = placeById(ctx.memory.homePlaceId);
  const away = ctx.from.city !== home.city;
  // Away from home the home city is not a "trip" — "집으로 돌아가기" below is the way there.
  const dests = PLACES.filter(p => p.city !== ctx.from.city && !HUB.includes(p.type) && !(away && p.city === home.city));
  const buckets: Record<TripKind, Place[]> = { train: [], boat: [], 'plane-near': [], 'plane-far': [] };
  for (const p of dests) buckets[tripKind(ctx.from, p)].push(p);
  // One option per kind, always in this order, so the far-away flight (뉴욕) is never shuffled out of the list.
  // Late blocks can't fit a long trip: evening drops the long-haul flight, night keeps only the train.
  const allowed: TripKind[] = ctx.blockId === 'night' ? ['train'] : ctx.blockId === 'evening' ? ['train', 'boat', 'plane-near'] : ['train', 'boat', 'plane-near', 'plane-far'];
  let kinds = allowed.filter(k => buckets[k].length);
  // Away from home the way back takes the first slot; the boat gives way so the long flight keeps its own.
  if (away && kinds.length > 3) kinds = kinds.filter(k => k !== 'boat');
  const out: ActivityOption[] = [];
  const usedEmoji = new Set<string>();
  const usedCity = new Set<string>();
  // TIMEZONE_SPEC: away from home the first travel option is always the way back (spans the rest of the day like a trip).
  if (away) out.push({ id: `${ctx.blockId}-0-${home.id}`, title: '집으로 돌아가기', reason: '슬슬 집이 그리움', emoji: pickEmoji(['🏠'], usedEmoji), placeId: home.id, category: 'travel', spanBlocks: spanFor(ctx.blockId, home, ctx.from) });
  for (const kind of kinds) {
    const pool = buckets[kind].filter(p => !softUsed.has(p.id) && !usedCity.has(p.city));
    const fresh = pool.filter(p => !visitedRecently(ctx.memory, p.id));
    const p = r.pick(fresh.length ? fresh : pool.length ? pool : buckets[kind]);
    if (!p) continue;
    usedCity.add(p.city);
    const friend = ctx.memory.friends.length && r.next() < 0.35 ? r.pick(ctx.memory.friends) : undefined;
    const city = cityNameKo(p.city);
    const title = r.pick(TRIP_TITLES[kind])(city, p);
    const stayDays = stayDaysFor(p, title);
    out.push({
      id: `${ctx.blockId}-${out.length}-${p.id}`,
      title: stayDays ? `${title} (${stayDays}박)` : title,
      reason: fill(r.pick(TRIP_REASONS[kind]), ctx.memory, p, r, friend?.name),
      emoji: pickEmoji([p.emoji, TRIP_EMOJI[kind]], usedEmoji),
      placeId: p.id,
      category: 'travel',
      spanBlocks: spanFor(ctx.blockId, p, ctx.from),
      stayDays,
      friendId: friend?.id,
    });
  }
  // A closer excursion (mountain/temple) rounds it out — the night block, which only has the train, lives on these.
  if (out.length < 3) {
    const local = PLACES.filter(p => p.city === ctx.from.city && ['mountain', 'temple', 'island'].includes(p.type) && !softUsed.has(p.id));
    for (const p of r.shuffle(local)) {
      if (out.length >= 3) break;
      out.push({ id: `${ctx.blockId}-${out.length}-${p.id}`, title: `${short(p)}까지 가보기`, reason: '멀리 안 가도 여행 기분', emoji: pickEmoji([p.emoji, '🧳'], usedEmoji), placeId: p.id, category: 'travel' });
    }
  }
  return out;
}

// ─── main ─────────────────────────────────────────────────────────────────
const mealOrder = (i: { types: string[] }) => i.types.includes('restaurant') ? 0 : i.types.includes('cafe') ? 1 : i.types.includes('home') || i.types.includes('friend_home') ? 3 : 2;

export function suggestOptions(ctx: SuggestCtx): ActivityOption[] {
  const r = rng(`${ctx.dateKey}:${ctx.blockId}:${ctx.category}:${ctx.regenSalt ?? 0}`);
  const softUsed = new Set(ctx.usedPlaceIds ?? []);
  if (ctx.category === 'travel') return travelOptions(ctx, r, softUsed);

  const ideas = r.shuffle(IDEAS[ctx.category as Exclude<Category, 'sleep' | 'travel'>] ?? IDEAS.rest)
    .filter(i => !i.blocks || i.blocks.includes(ctx.blockId))
    .filter(i => !i.friend || (!!ctx.companions && ctx.memory.friends.length > 0))
    // 밥 시간엔 밥집(또는 카페 브런치)이 항상 3개 안에 들어가도록 앞으로 당긴다 — 집밥·친구네는 뒤로
    .sort((x, y) => (ctx.category === 'meal' ? mealOrder(x) - mealOrder(y) : 0));
  const local = PLACES.filter(p => p.city === ctx.from.city);
  const home = placeById(ctx.memory.homePlaceId);
  /** 친구 집 제안 규칙: only a friend's home, only while they are in it, and only from the day after we met. */
  const friendHomeOk = (p: Place) => !!p.ownerFriendId && !!ctx.companions?.homeOk(p.ownerFriendId) && ctx.memory.friends.some(f => f.id === p.ownerFriendId);
  /** abroad / in another city: home is a flight away, so "집에서 …" ideas are off the table */
  const away = ctx.from.city !== home.city;

  const out: ActivityOption[] = [];
  const usedPlace = new Set<string>();
  const usedEmoji = new Set<string>();
  const usedTypes = new Set<PlaceType>();
  let homeUsed = false;
  // 각 범주의 제안 3개 중 최대 1개가 동행 버전 (FRIENDS_SPEC §3)
  let friendUsed = false;

  // Home is always possible, so it must not show up in every block: skip it in strict passes about half the time.
  const homeShy = r.next() < 0.5;

  /** Who can come to `p` in this block: its owner (friend's home) → someone already going there → someone free. */
  const companionFor = (p: Place) => {
    const c = ctx.companions;
    if (!c) return undefined;
    if (p.ownerFriendId) return ctx.memory.friends.find(f => f.id === p.ownerFriendId);
    return ctx.memory.friends.find(f => c.atPlace(f.id, p.id)) ?? ctx.memory.friends.find(f => c.free(f.id));
  };

  const tryIdea = (idea: Idea, strict: boolean, relaxed = false): boolean => {
    if (idea.friend && (friendUsed || !ctx.companions)) return false;
    let cands: Place[];
    if (idea.types.includes('home')) { if (away || homeUsed || (strict && homeShy)) return false; cands = [home]; }
    else if (idea.types.includes('friend_home')) cands = local.filter(p => friendHomeOk(p) && !usedPlace.has(p.id));
    else cands = local.filter(p => idea.types.includes(p.type) && p.type !== 'home' && p.type !== 'friend_home' && !usedPlace.has(p.id));
    if (strict) cands = cands.filter(p => !usedTypes.has(p.type));
    const p = pickPlace(cands, ctx, r, softUsed, relaxed || idea.types.includes('home'));
    if (!p) return false;
    const dKm = haversineKm(ctx.from, p);
    // 동행: the friend whose home it is, else someone already going there, else someone free in this block.
    const friend = idea.friend ? companionFor(p) : undefined;
    if (idea.friend && !friend) return false;
    const dyn = dynamicReasons(ctx, p, dKm);
    const typed = idea.reasons.filter(s => !s.includes('{tlike}') || likeHit(ctx.memory, p, r));
    const reasonSrc = dyn.length && r.next() < 0.55 ? r.pick(dyn) : r.pick(typed.length ? typed : idea.reasons);
    usedPlace.add(p.id); usedTypes.add(p.type); if (p.type === 'home') homeUsed = true; if (friend) friendUsed = true;
    out.push({
      id: `${ctx.blockId}-${out.length}-${p.id}`,
      title: fill(r.pick(idea.titles)(p, ctx, r), ctx.memory, p, r, friend?.name),
      reason: fill(reasonSrc, ctx.memory, p, r, friend?.name),
      emoji: pickEmoji([idea.emoji, ...(idea.alt ?? []), p.emoji], usedEmoji),
      placeId: p.id,
      category: ctx.category,
      friendId: friend?.id,
    });
    return true;
  };

  // Pass 1: one idea per place type, within reach, unused today. Pass 2: relax type uniqueness.
  // Pass 3: allow farther / already-used places. Pass 4: any idea regardless of block fit.
  for (const idea of ideas) { if (out.length >= 3) break; tryIdea(idea, true); }
  for (const idea of ideas) { if (out.length >= 3) break; tryIdea(idea, false); }
  for (const idea of ideas) { if (out.length >= 3) break; tryIdea(idea, false, true); }
  if (out.length < 3) {
    const all = r.shuffle(IDEAS[ctx.category as Exclude<Category, 'sleep' | 'travel'>] ?? IDEAS.rest).filter(i => !i.friend || (!!ctx.companions && ctx.memory.friends.length > 0));
    for (const idea of all) { if (out.length >= 3) break; tryIdea(idea, false, true); }
  }
  // Rare fallback: a walk from wherever we are (abroad: around the last place, never the far-away home).
  const FALLBACK = away ? ['근처 한 바퀴 산책하기', '골목 천천히 걸어 보기', '벤치에 앉아 하늘 보기'] : ['집 앞 산책하고 오기', '동네 한 바퀴 천천히 걷기', '창문 열고 하늘 보기'];
  const base = away ? ctx.from : home;
  while (out.length < 3) {
    out.push({ id: `${ctx.blockId}-${out.length}-${base.id}`, title: FALLBACK[out.length], reason: '별다른 계획 없는 날', emoji: pickEmoji(['🚶', '🌤️', base.emoji], usedEmoji), placeId: base.id, category: ctx.category });
  }
  return out;
}
