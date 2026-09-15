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

/**
 * 트리거 존 (ADR-0028): 방 안의 누를 수 있는 영역. 누르면 인물이 `spots` 중 비어 있는 가장 가까운 자리로 걸어가고, 도착하는 순간
 * `pose`를 취하며 `say`를 띄운다. 인물이 존 자리 근처(NEAR px)에 있으면 존이 빛나고 이름표가 뜬다 — "여기서 뭘 할 수 있다"는 표시.
 * 자리가 여럿이면 남이 앉은 테이블의 빈 의자로 가는 게 곧 합석이고(개정 1), 같은 존에 있는 사람과는 떠든다.
 */
export interface Zone {
  key: string;
  /** 누를 수 있는 사각형 (방 좌표, 왼쪽 위 모서리와 크기) */
  x: number; y: number; w: number; h: number;
  /** 걸어가 서는 자리들 (spots의 이름, 선호 순). 의자·스툴 하나가 자리 하나 — 남이 쓰는 자리는 건너뛴다 */
  spots: string[];
  /** 도착했을 때의 자세. 없으면 자리의 자세(내 자리면 활동 자세, 그 밖은 서 있기) */
  pose?: Cue['pose'];
  /** 도착하면 머리 위에 잠깐 뜨는 말 */
  say?: string;
  /** 근처에서 뜨는 이름표 */
  label: string;
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
  /** 트리거 존. 없으면 내 자리와 strolls에서 만든다 (`zonesOf`) */
  zones?: Zone[];
  /** 앉은 자리 앞(테이블 위)에 놓이는 활동 물건의 자리와 앞뒤 — 손에 든 것은 테이블에 가리니 테이블 위에 따로 놓는다 */
  seatItem: { x: number; y: number; base: number };
}

/** 자리 이름 → 이름표. 방마다 존을 손으로 안 잡아도 자리 이름만으로 존이 되게 */
const SPOT_LABEL: Record<string, string> = {
  seat: '내 자리', side: '옆자리', door: '입구', window: '창가', counter: '카운터', kitchen: '부엌', bed: '침대', water: '물가',
  shelf: '책장', treadmill: '러닝머신', cooler: '정수기', mirror: '거울', escalator: '에스컬레이터', board: '안내판', easel: '이젤',
  label: '설명판', desk: '책상', fountain: '분수', flowers: '꽃밭', path: '산책로', shore: '물가', bike: '자전거', bridge: '다리',
  shells: '조개', kiosk: '매점',
};

/** 자리 하나를 감싸는 기본 존: 발 자리 위로 인물 한 명 크기의 상자 */
function zoneAround(key: string, spot: Spot, pose: Cue['pose'], label: string): Zone {
  return { key, x: spot.x - 48, y: spot.y - 74, w: 96, h: 86, spots: [key], pose, label };
}

/**
 * 방의 트리거 존. 방이 `zones`를 손으로 잡았으면 그것, 아니면 내 자리(자리의 자세)와 산책 목적지(그 자세)를 각각 존으로 만든다.
 * 입구는 뺀다 — 문으로 가는 건 출발(`leaving`)의 몫이고, 사용자가 눌러서 나가면 안 된다.
 */
export function zonesOf(room: RoomSpec): Zone[] {
  if (room.zones) return room.zones;
  // 내 자리 존은 동행 의자도 품는다 — 동행이 없으면 거기 앉아도 되고, 있으면 같은 테이블의 사람이다
  const seat = { ...zoneAround(room.seat, room.spots[room.seat]!, undefined, SPOT_LABEL[room.seat] ?? '내 자리'), spots: [room.seat, room.friendSeat] };
  const strolls = room.strolls.filter(s => s.spot !== room.door && s.spot !== room.seat)
    .map(s => zoneAround(s.spot, room.spots[s.spot]!, s.pose, SPOT_LABEL[s.spot] ?? s.spot));
  return [seat, ...strolls];
}

/** 자세별로 테이블 위에 놓이는 물건: 그림 → 스케치북·연필, 읽기 → 책, 먹기 → 빈 접시(주먹밥은 손에 들려 보이므로 접시엔 안 올린다), 나머지는 없음 */
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
