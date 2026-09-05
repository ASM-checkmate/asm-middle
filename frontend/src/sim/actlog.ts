import type { PlaceType, ScheduledActivity } from './types';
import { costOf } from './status';
import { rng } from './rng';

// ─── 활동 로그 (docs/adr/0001-agentness.md — 결과가 아니라 과정의 관찰) ────────
// 완성된 그림을 사후에 받는 것보다 지금 뭘 하고 있는지가 조금씩 보이는 편이 강하다.
// 타임스탬프가 찍힌 줄이 활동 중에 하나씩 쌓이고, 마찰이 터지면 그 순간 그 자리에 찍힌다.
// 결정론적이다: 시드가 `log:${act.key}`라 다시 그려도 같은 줄이 같은 시각에 나온다.

export interface LogLine {
  /** 그 줄이 찍힌 시각 (ms) */
  at: number;
  text: string;
  /** 마찰로 찍힌 줄 — 화면에서 강조한다 */
  fx?: boolean;
}

/** 활동 중 어느 지점에서 줄이 하나씩 붙는가 (진행률). */
const BEATS = [0.12, 0.38, 0.62, 0.86];

/** 도착 직후의 첫 줄. */
const ARRIVE: Partial<Record<PlaceType, string[]>> = {
  cafe: ['도착. 창가 자리 비어 있었음', '도착. 줄이 짧다', '도착. 원두 볶는 냄새'],
  restaurant: ['도착. 자리 바로 났음', '도착. 메뉴판부터 봄'],
  park: ['도착. 벤치 하나 비어 있음', '도착. 생각보다 사람 많음'],
  river: ['도착. 바람이 세다', '도착. 물빛이 괜찮음'],
  library: ['도착. 3층 창가 자리', '도착. 아주 조용함'],
  gym: ['도착. 러닝머신 두 대 비었음', '도착. 스트레칭부터'],
  home: ['집. 일단 누움', '집. 불부터 켬'],
  friend_home: ['도착. 초인종 누름', '도착. 문 열어줌'],
  cinema: ['도착. 예매 확인', '도착. 팝콘 줄이 길다'],
  mall: ['도착. 일단 한 바퀴', '도착. 에스컬레이터부터'],
  market: ['도착. 사람이 빽빽함', '도착. 냄새가 좋다'],
  museum: ['도착. 입장권 끊음', '도착. 1층부터'],
  beach: ['도착. 신발에 모래', '도착. 파도 소리'],
  bar: ['도착. 구석 자리 앉음'],
};
const ARRIVE_DEFAULT = ['도착', '도착. 일단 둘러봄'];

/** 활동 중간에 붙는 관찰. 짧고 구체적으로. */
const MIDDLE: Partial<Record<PlaceType, string[]>> = {
  cafe: ['라떼 한 잔 시킴', '옆 테이블이 시끄러움', '노트 꺼냄', '음악이 취향', '두 잔째 고민 중', '창밖 구경'],
  restaurant: ['주문한 거 나옴', '생각보다 양이 많음', '물 두 잔째', '반찬 리필함'],
  park: ['한 바퀴 돎', '벤치에 앉음', '강아지 지나감', '해가 좋다', '신발 끈 다시 묶음'],
  river: ['자전거가 계속 지나감', '앉아서 물 봄', '바람에 머리 엉킴'],
  library: ['책 두 권 꺼냄', '한 챕터 읽음', '졸음이 옴', '메모함'],
  gym: ['20분 뜀', '기구 두 개 돎', '땀이 많이 남', '물 마심'],
  home: ['뒹굴거림', '음악 틀어놓음', '설거지함', '낮잠 잠깐'],
  friend_home: ['게임 한 판', '간식 꺼내옴', '수다 중'],
  cinema: ['광고 끝남', '중간쯤 봄', '옆자리 부스럭거림'],
  mall: ['한 층 더 올라감', '아이쇼핑 중', '다리 아픔'],
  market: ['한 바퀴 더 돎', '시식 함', '가격 물어봄'],
  museum: ['한 방 더 봄', '설명 읽음', '사진 찍음'],
  beach: ['발만 담가봄', '조개 주움', '모래에 앉음'],
  bar: ['한 잔 더 시킴', '안주 나옴'],
};
const MIDDLE_DEFAULT = ['가만히 있음', '주변 구경', '시간 감', '잠깐 앉음', '생각 정리'];

/** "14:32" — 캐릭터의 현지 시각은 화면이 붙인다. 여기선 ms만 준다. */
const pick = (list: string[], seed: string) => rng(seed).pick(list);

/**
 * 지금까지 쌓인 활동 로그. `now` 이전에 찍힌 줄만 돌려준다.
 *
 * @param act 진행 중(또는 끝난) 활동
 * @param now 지금 (sim ms)
 * @returns 시각 순 로그. 아직 아무것도 없으면 빈 배열.
 */
export function activityLog(act: ScheduledActivity, now: number): LogLine[] {
  const out: LogLine[] = [];
  const span = Math.max(1, act.endAt - act.arriveAt);
  const type = act.place.type;

  out.push({ at: act.arriveAt, text: pick(ARRIVE[type] ?? ARRIVE_DEFAULT, `log:${act.key}:arrive`) });

  // 마찰은 그 순간 그 자리에 찍힌다 — 나중에 통보하는 게 아니라 지금 벌어진 일로 보인다
  if (act.outcome) out.push({ at: Math.min(act.outcome.divertedAt, act.arriveAt), text: act.outcome.line, fx: true });

  // 돈을 쓴 활동은 얼마 썼는지가 한 줄 남는다 (상태가 판단의 근거가 되기 전에 사실로 먼저 보인다)
  const spent = costOf(act.option.category, act.place, [], (act.endAt - act.arriveAt) / 60_000);
  if (spent > 0) out.push({ at: act.arriveAt + span * 0.22, text: `${spent.toLocaleString('ko-KR')}원 씀` });

  // 표를 활동마다 한 번 섞어 순서대로 쓴다 — 같은 줄이 두 번 나오지 않는다
  const mid = rng(`log:${act.key}`).shuffle([...(MIDDLE[type] ?? MIDDLE_DEFAULT)]);
  BEATS.forEach((p, i) => {
    if (i >= mid.length) return;
    out.push({ at: act.arriveAt + span * p, text: mid[i] });
  });

  return out.sort((a, b) => a.at - b.at).filter(l => l.at <= now);
}
