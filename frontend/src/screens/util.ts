import type { ActivityOption, BlockId, DayKey, Phase, PlaceType, TransportMode } from '../sim/types';
import { splitDayKey } from '../sim/types';
import { blockDef, weekdayKoIn } from '../sim/blocks';
import { DAY_MS, dayStartIn, hhmmIn } from '../sim/tz';
import { cityNameKo } from '../sim/places';
import type { Pose } from '../character';

/** "카페 레이어드 연남에서 그림 그리기" → "그림 그리기" (same rule as sim/comic.ts). */
export const shortTitle = (t: string) => {
  const s = t.replace(/^.*?(에서|에|까지)\s?/, '');
  return s || t;
};

/** "놀기" → "노는" (ㄹ-final stems drop ㄹ before -는). */
const dropRieul = (stem: string) => {
  const c = stem.charCodeAt(stem.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8 ? stem.slice(0, -1) + String.fromCharCode(c - 8) : stem;
};
/** Nouns that end in 기 (not verb stems). */
const NOUN_GI = /(줄넘기|당일치기|일기|이야기|얘기|놀이기구|뽑기)$/;
const TRIP = /(당일치기|타고|뱃길로|행 비행기|훌쩍|날아가기|보러 가기|까지 가서|돌아가기)/;
const TAIL: [RegExp, string][] = [
  [/하고 오기$/, '하는 중'], [/놀러 가기$/, '노는 중'], [/보러 가기$/, '보는 중'], [/얻어먹기$/, '얻어먹는 중'],
  [/(가보기|둘러보기)$/, '둘러보는 중'], [/차 한 잔$/, '차 마시는 중'], [/한 잔$/, '한 잔 하는 중'], [/한 바퀴$/, '한 바퀴 도는 중'],
  [/커피$/, '커피 마시는 중'], [/빵 타임$/, '빵 먹는 중'], [/책 한 챕터$/, '책 읽는 중'],
  [/(아침|점심|저녁|야식|밥|디저트|떡볶이|든든하게|브런치)$/, '$1 먹는 중'],
  [/(영화|야경|전시|퍼레이드|축구|만화책)$/, '$1 보는 중'], [/(강의|라이브)$/, '$1 듣는 중'],
  [/(자전거|스케이트보드|케이블카)$/, '$1 타는 중'], [/춤$/, '춤추는 중'], [/수다$/, '수다 떠는 중'],
  [/1만 보$/, '1만 보 걷는 중'], [/러닝머신 30분$/, '러닝머신 뛰는 중'], [/홈트 30분$/, '홈트 하는 중'],
  [/출근$/, '일하는 중'], [/재택$/, '재택근무 중'],
];
const TRAVEL_DOING: Partial<Record<PlaceType, string>> = {
  beach: '바다 보며 노는 중', mountain: '산길 걷는 중', island: '섬 구경하는 중', temple: '천천히 둘러보는 중', museum: '천천히 둘러보는 중',
  mall: '구경하는 중', market: '시장 구경하는 중', hotel: '쉬는 중', river: '강바람 쐬는 중', park: '산책하는 중',
  home: '짐 푸는 중',
};

/** Activity-in-progress phrase for the stat card: "그림 그리기" → "그림 그리는 중", beach trip → "바다 보며 노는 중". */
export const progressLabel = (opt: ActivityOption, place?: { type: PlaceType }): string => {
  const s = shortTitle(opt.title).trim();
  if (opt.category === 'travel' && place) {
    const typed = TRAVEL_DOING[place.type];
    if (typed && (TRIP.test(opt.title) || /가보기$/.test(s) || ['beach', 'mountain', 'island'].includes(place.type))) return typed;
    if (TRIP.test(opt.title)) return '여행 중';
  }
  for (const [re, rep] of TAIL) if (re.test(s)) return s.replace(re, rep);
  if (/기$/.test(s) && !NOUN_GI.test(s)) return `${dropRieul(s.slice(0, -1))}는 중`;
  return `${s} 중`;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** "09:00 – 12:00" */
export const blockRange = (id: BlockId) => {
  const b = blockDef(id);
  return `${pad(b.startHour)}:00 – ${pad(b.endHour)}:00`;
};

/** Remaining minutes → "1:40" or "12분" (DM Mono in the UI). */
export const fmtRemain = (min: number) => {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${pad(m % 60)}` : `${m}분`;
};

/** Minutes until a timestamp, floored at 0. */
export const minutesUntil = (t: number, now: number) => Math.max(0, Math.ceil((t - now) / 60_000));

/** State label under the clock (deck: "오전 블록 시작 전", "이동 중", "활동 중", "활동 끝"). */
export const phaseLabel = (p: Phase): string => {
  switch (p.kind) {
    case 'waiting': return p.nextBlockId ? `${blockDef(p.nextBlockId).label} 블록 시작 전` : '오늘 하루 끝';
    case 'moving': return '이동 중';
    case 'active': return '활동 중';
    case 'comic': return '활동 끝';
    case 'sleeping': return '자는 중';
  }
};
/** The city the character's clock belongs to: where it is — or, on the way somewhere, the city it left (its zone is still that one). */
export const phaseCity = (p: Phase): string =>
  p.kind === 'moving' ? p.act.fromPlace.city : p.kind === 'waiting' || p.kind === 'sleeping' ? p.at.city : p.act.place.city;
/** "뉴욕 · 목요일 · 활동 중" — weekday in the character's zone; the city only when it is not the home city (TIMEZONE_SPEC 시계와 화면). */
export const chromeLabel = (now: number, p: Phase, homeCity: string) => {
  const city = phaseCity(p);
  return `${city !== homeCity ? `${cityNameKo(city)} · ` : ''}${weekdayKoIn(now, p.tz)} · ${phaseLabel(p)}`;
};

/** Timetable title: "오늘의 생활계획표" at home, "뉴욕 · 9월 4일의 생활계획표" when the day is lived in another zone than the owner's. */
export const dayTitle = (dayKey: DayKey, city: string, abroad: boolean) => {
  if (!abroad) return '오늘의 생활계획표';
  const [, m, d] = splitDayKey(dayKey).dateKey.split('-').map(Number);
  return `${cityNameKo(city)} · ${m}월 ${d}일의 생활계획표`;
};

/** What the character is inside of during a journey ("비행기", "기차"…). */
export const vehicleName = (mode: TransportMode) =>
  ({ walk: '길', car: '차', subway: '지하철', train: '기차', plane: '비행기', boat: '배' } as Record<TransportMode, string>)[mode];
/** Timetable note on a block a journey from another day/zone covers: "비행 중 · 도착하면 뉴욕 시간으로". */
export const transitNote = (mode: TransportMode, destCity: string, zoneChanges: boolean) => {
  const going = mode === 'plane' ? '비행 중' : mode === 'train' ? '기차로 이동 중' : mode === 'boat' ? '배로 이동 중' : '이동 중';
  return zoneChanges ? `${going} · 도착하면 ${cityNameKo(destCity)} 시간으로` : `${going} · 도착할 때까지 지켜봐요`;
};

/** A pose that fits the activity (draw/eat/read/happy/sit…). */
export const poseFor = (opt: ActivityOption): Pose => {
  const t = opt.title;
  if (/그림/.test(t)) return 'draw';
  if (/산책|러닝|자전거|스케이트|오르기|걷기/.test(t)) return 'walk';
  if (/책 읽|읽기|독서|공부|강의|노트북|작업|출근|재택/.test(t)) return 'read';
  if (/먹|브런치|요리|밥|든든|메뉴/.test(t)) return 'eat';
  if (/낮잠|뒹굴|멍때|쉬기|음악|영화|게임/.test(t)) return 'sit';
  if (/만나|놀러|피크닉|사진|파티/.test(t)) return 'wave';
  switch (opt.category) {
    case 'meal': return 'eat';
    case 'study': case 'work': return 'read';
    case 'rest': return 'sit';
    default: return 'happy';
  }
};

/** Comic panel poses per beat. */
export const beatPose = (beat: 'arrive' | 'doing' | 'twist' | 'end', opt?: ActivityOption): Pose => {
  switch (beat) {
    case 'arrive': return 'walk';
    case 'doing': return opt ? poseFor(opt) : 'draw';
    case 'twist': return 'think';
    case 'end': return 'happy';
  }
};

/** Tiny cross-screen intent: which comic the book should open on. */
export const bookIntent: { comicId: string | null } = { comicId: null };

// ─── 공백 (SPEC 자율 생활과 개입) ────────────────────────────────────────────
/** "그저께" 보다 멀면 그냥 날짜로 부른다. */
const DAY_WORD = ['오늘', '어제', '그저께'];

/** 캐릭터의 현지 자정 기준으로 `t`가 며칠 전인지 (0 = 오늘). */
const daysBack = (t: number, now: number, tz: string) =>
  Math.round((dayStartIn(now, tz) - dayStartIn(t, tz)) / DAY_MS);

/** "어제 21:04" — 오늘·어제·그저께는 말로, 그보다 오래면 "9월 3일 21:04". */
const stampOf = (t: number, now: number, tz: string) => {
  const n = daysBack(t, now, tz);
  if (n >= 0 && n < DAY_WORD.length) return `${DAY_WORD[n]} ${hhmmIn(t, tz)}`;
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hhmmIn(t, tz)}`;
};

/** 대화 실의 날짜 구분선 — "오늘" · "어제" · "9월 3일 수요일". */
export const dayStamp = (t: number, now: number, tz: string) => {
  const n = daysBack(t, now, tz);
  if (n >= 0 && n < DAY_WORD.length) return DAY_WORD[n];
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayKoIn(t, tz)}`;
};

/** "11시간 8분" / "42분" — 공백의 길이. */
const spanOf = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
};

/**
 * 사용자가 자리를 비운 구간을 캐릭터의 현지 시각으로 읽는다. 타임스탬프 자체가
 * "내가 없을 때도 세계가 돌아갔다"는 증거라 catch-up 시트 맨 위에 찍는다.
 * @param from 마지막으로 봤던 순간 (sim ms)
 * @param to   지금 (sim ms)
 * @param tz   캐릭터가 사는 시간대
 * @returns    범위 문구와 길이 문구. 둘 다 이미 사람이 읽는 형태다.
 */
export const gapLabel = (from: number, to: number, tz: string) => {
  const sameDay = daysBack(from, to, tz) === 0;   // 같은 날이면 "오늘"을 두 번 쓰지 않는다
  return {
    range: `${stampOf(from, to, tz)} ~ ${sameDay ? hhmmIn(to, tz) : stampOf(to, to, tz)}`,
    span: spanOf(to - from),
  };
};
