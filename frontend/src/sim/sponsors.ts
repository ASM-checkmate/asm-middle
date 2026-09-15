// ─── 이동 제휴 (ADR-0031) ─────────────────────────────────────────────────────
// 도시마다 귀가 택시 하나. 취침 전 이동(ADR-0030)이 이 도시의 집·숙소로 갈 때 차 여정을 이 라벨로 만들고, 지도에 광고 카드를 띄운다.
// 로고 자산은 쓰지 않는다 — 이름·한 줄 문구·아이콘(map/AdCard가 그린다)만. 'AD' 표기는 카드가 붙인다.
import type { RideSponsor } from './types';

export const RIDE_SPONSORS: Record<string, RideSponsor> = {
  busan: { id: 'dongbaek-taxi', name: '동백택시', label: '동백택시', tagline: '부산 시민의 택시 — 앱으로 부르면 바로 와요', emoji: '🌺' },
};

/** 그 도시의 귀가 택시 (없으면 null) */
export const rideSponsorFor = (city: string): RideSponsor | null => RIDE_SPONSORS[city] ?? null;
