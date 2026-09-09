// ─── 2.5D 방의 공용 조각 (ADR-0015) ────────────────────────────────────────
// 방 하나 = 벽(뒤) + 바닥(평면) + 소품 목록 + 자리(spot) 목록 + 로그 줄 → 큐(cue) 표. 소품과 인물은 바닥 접점 행(y)으로 앞뒤가 정해진다.
import type { ReactNode } from 'react';
import type { LogLine } from '../sim/actlog';

/** 방 안의 한 자리 — 인물의 발이 놓이는 점 (방 좌표, px) */
export interface Spot { x: number; y: number }

/** 소품: 왼쪽 위 모서리(x, y)에 놓이는 svg 조각과, 앞뒤를 정하는 바닥 접점 행 base */
export interface RoomProp { key: string; x: number; y: number; w: number; h: number; base: number; node: ReactNode }

/** 로그 한 줄이 방 안에서 일으키는 일 */
export interface Cue {
  /** 인물이 가는 자리 */
  go?: string;
  /** go 뒤에 잠깐 있다가 돌아갈 자리 (실제 4초 뒤) */
  then?: string;
  /** 자리 표시가 뜨는 곳 (기본: 인물 위) */
  at?: string;
  /** 표시 글자 (없으면 로그 줄 그대로) */
  say?: string;
  /** 표시 종류: 돈·마찰·음표 */
  kind?: 'money' | 'fx' | 'notes';
  /** 그 자리에서의 자세 (기본: 자리의 자세) */
  pose?: 'idle' | 'think' | 'sit' | 'happy';
}

export interface RoomSpec {
  w: number; h: number;
  /** 뒤 배경(벽·바닥) — 절대 위치 svg들 */
  back: ReactNode;
  props: RoomProp[];
  spots: Record<string, Spot>;
  /** 활동 중 앉는 자리·그 옆 동행 자리·마주친 사람 자리·못 걸어 본 사람(실루엣) 자리 */
  seat: string; friendSeat: string; metSpot: string; ghostSeat: string; door: string;
  /** 로그와 무관하게 1~3분마다 잠깐 다녀오는 곳들 (창가에 밖 보기, 카운터에 물 가지러, 입구 쪽 화장실) */
  strolls: { spot: string; pose: Cue['pose'] }[];
  /** 로그 줄 → 큐. 도착 줄은 '도착'으로 시작하니 prefix로 잡는다 */
  cueOf(line: LogLine): Cue | null;
  /** 앉은 자리 앞(테이블 위)에 놓이는 활동 물건의 자리와 앞뒤 — 손에 든 것은 테이블에 가리니 테이블 위에 따로 놓는다 */
  seatItem: { x: number; y: number; base: number };
}

/** 자세별로 테이블 위에 놓이는 물건: 그림 → 스케치북·연필, 읽기 → 책, 먹기 → 접시, 나머지는 없음 */
export function SeatItem({ pose }: { pose: string }) {
  const ink = { stroke: 'var(--ink)', strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
  if (pose === 'draw') return (
    <svg viewBox="0 0 64 40" width="64" height="40">
      <rect x="4" y="6" width="40" height="28" rx="4" fill="var(--paper)" transform="rotate(-8 24 20)" {...ink} />
      <circle cx="22" cy="20" r="6" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="19.5" cy="19" r="1.2" fill="var(--ink)" /><circle cx="24.5" cy="19" r="1.2" fill="var(--ink)" />
      <g transform="translate(50 24) rotate(40)"><rect x="-3" y="-14" width="6" height="22" rx="2" fill="var(--sun)" {...ink} /><path d="M-3 8 l3 7 l3 -7 z" fill="var(--skin)" {...ink} /></g>
    </svg>
  );
  if (pose === 'read') return (
    <svg viewBox="0 0 64 40" width="64" height="40">
      <path d="M8 10 L32 14 L56 10 L56 32 L32 36 L8 32 Z" fill="var(--sky)" {...ink} />
      <path d="M12 13 L30 16 L30 32 L12 29 Z M34 16 L52 13 L52 29 L34 32 Z" fill="var(--paper)" {...ink} />
    </svg>
  );
  if (pose === 'eat') return (
    <svg viewBox="0 0 64 40" width="64" height="40">
      <ellipse cx="32" cy="22" rx="24" ry="11" fill="var(--card)" {...ink} />
      <path d="M32 8 C38 8 43 17 44 21 Q44 25 40 25 H24 Q20 25 20 21 C21 17 26 8 32 8 Z" fill="var(--paper)" {...ink} />
      <rect x="27" y="20" width="10" height="5" fill="var(--night)" />
    </svg>
  );
  return null;
}

/** 소품 목록을 그린다 — z-index는 바닥 접점 */
export function Props({ props }: { props: RoomProp[] }) {
  return (
    <>
      {props.map(p => (
        <div key={p.key} className="room-prop" style={{ left: p.x, top: p.y, width: p.w, height: p.h, zIndex: Math.round(p.base) }}>
          <svg viewBox={`0 0 ${p.w} ${p.h}`} width={p.w} height={p.h}>{p.node}</svg>
        </div>
      ))}
    </>
  );
}
