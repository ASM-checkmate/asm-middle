// ─── 방 안의 인물을 로그로 움직인다 (ADR-0015) ───────────────────────────────
// 자리는 sim이 정한다(activityLog의 줄 → 큐), 걷는 시간은 실제 시간(1.4초 transition)이다 — 시계 배속과 무관하게 걷는 것처럼 보인다.
// 처음 그릴 때(화면 진입·미리보기)는 지금까지의 마지막 큐 자리에 바로 서고, 새 줄이 붙을 때만 걸어간다.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Character, type Pose } from '../character';
import type { LogLine } from '../sim/actlog';
import type { Friend, PhaseEncounter } from '../sim/types';
import { rng } from '../sim/rng';
import { Props, SeatItem, type Cue, type RoomSpec, type Spot } from './Room';
import './room.css';

const SIZE = 96;              // 인물 한 변 (px). 발은 그림의 91 % 행
const FEET = 0.91;
const WALK_MS = 1400;
const DWELL_MS = 4000;
const POSE_MS = 8000;         // 걷지 않는 큐의 자세(생각·기쁨)는 잠깐 — 지나면 자리의 자세로
// 살아 있기 (ADR-0015 개정 1): 실제 시간 기준. 잔동작 20~40초, 자리 비우기 60~180초(3~6초 머묾), 옆 손님 40~160초마다 30~60초 앉았다 감
const FIDGET_MS: [number, number] = [20_000, 40_000];
const STROLL_MS: [number, number] = [60_000, 180_000];
const STAY_MS: [number, number] = [3_000, 6_000];
const GUEST_MS: [number, number] = [40_000, 160_000];
const GUEST_STAY_MS: [number, number] = [30_000, 60_000];
const GUEST_COLORS = ['#FFC64D', '#A9DCF5', '#8FD37E', '#FFD2C4'];
type Fidget = 'look' | 'stretch' | 'nod' | 'sip';
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** QA: `&life=10`이면 잔동작·산책·손님 간격이 10배 빨라진다 (dev 빌드만) */
const lifeSpeed = (): number => { if (!import.meta.env.DEV) return 1; const v = Number(new URLSearchParams(location.search).get('life')); return v > 0 ? v : 1; };

interface Bubble { key: number; spot: Spot; text: string; kind?: Cue['kind']; stay?: boolean }

export interface RoomStageProps {
  room: RoomSpec;
  /** 지금까지 찍힌 로그 (시각 순, 화면이 이미 now로 걸렀다) */
  log: LogLine[];
  /** 자리에 앉았을 때의 자세 (활동 종류) */
  seatPose: Pose;
  companions: Friend[];
  encounter?: PhaseEncounter;
  /** 결정론적 난수 시드 (활동 키) — 같은 활동은 다시 봐도 같은 순서로 움직인다 */
  seed: string;
  /** 출발: 문으로 걸어 나가 사라진다 (ADR-0015 개정 2). 한 번 true가 되면 되돌리지 않는다 */
  leaving?: boolean;
}

/** 큐가 최종적으로 남기는 자리·자세 — 처음 그릴 때 dwell을 건너뛰고 바로 여기에 선다 */
function restingSpot(room: RoomSpec, log: LogLine[]): { spot: string; pose?: Cue['pose'] } {
  let spot = room.seat, pose: Cue['pose'];
  for (const l of log) {
    const c = room.cueOf(l);
    if (!c) continue;
    if (c.go) { spot = c.then ?? c.go; pose = c.then ? undefined : c.pose; }
    // 걷지 않는 큐의 자세는 잠깐뿐이라 처음 그릴 때는 무시한다
  }
  return { spot, pose };
}

export function RoomStage({ room, log, seatPose, companions, encounter, seed, leaving = false }: RoomStageProps) {
  const rest = restingSpot(room, log);
  const [spot, setSpot] = useState(rest.spot);
  const [pose, setPose] = useState<Cue['pose'] | undefined>(rest.pose);
  const [walking, setWalking] = useState(false);
  const [still, setStill] = useState(true);          // 첫 그림: transition 없이
  const [heading, setHeading] = useState<{ back: boolean; left: boolean }>({ back: false, left: false });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const seen = useRef<number>(log.length ? log[log.length - 1]!.at : -Infinity);
  const timers = useRef<number[]>([]);
  const seq = useRef(0);                              // 말풍선 키 — StrictMode가 효과를 두 번 돌려도 겹치지 않게
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const [fidget, setFidget] = useState<Fidget | null>(null);
  const [guest, setGuest] = useState<{ spot: string; color: string; gone: boolean; walking: boolean } | null>(null);
  const busy = useRef(false);                          // 걷는 중·자리 비운 중 — 잔동작·산책이 겹치지 않게
  const seatedRef = useRef(false);
  const [gone, setGone] = useState(false);             // 문 밖으로 나갔다

  /** 자리로 걸어간다 — 방향은 출발·도착 자리로, 도착하면 자리의 자세 */
  const walkTo = (to: string, after?: () => void) => {
    const from = room.spots[spotRef.current]!, dest = room.spots[to]!;
    setHeading({ back: dest.y < from.y - 30, left: dest.x < from.x - 10 });
    setStill(false); setWalking(true); setSpot(to); busy.current = true; setFidget(null);
    timers.current.push(window.setTimeout(() => { setWalking(false); setHeading(h => ({ ...h, back: false })); busy.current = false; after?.(); }, WALK_MS));
  };
  const show = (c: Cue, line: LogLine) => {
    const at = room.spots[c.at ?? spotRef.current] ?? room.spots[room.seat]!;
    setBubbles(b => [...b.slice(-2), { key: ++seq.current, spot: c.at ? at : { x: at.x, y: at.y - SIZE * FEET }, text: c.say ?? line.text, kind: c.kind }]);
  };

  // 새 줄이 붙으면 큐를 실행한다
  useEffect(() => {
    const fresh = log.filter(l => l.at > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1]!.at;
    for (const line of fresh) {
      const c = room.cueOf(line);
      if (!c) continue;
      if (c.go) {
        walkTo(c.go, () => {
          setPose(c.pose);
          show(c, line);
          if (c.then) timers.current.push(window.setTimeout(() => walkTo(c.then!, () => setPose(undefined)), DWELL_MS));
        });
      } else {
        if (c.pose) { const p = c.pose; setPose(p); timers.current.push(window.setTimeout(() => setPose(cur => (cur === p ? undefined : cur)), POSE_MS)); }
        show(c, line);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.length]);
  // 출발: 하던 걸 멈추고(busy) 문으로 걸어가 사라진다 — 그 뒤 화면이 지도로 넘어간다 (Home의 출발 홀드)
  useEffect(() => {
    if (!leaving) return;
    busy.current = true; setFidget(null); setPose(undefined);
    walkTo(room.door, () => { busy.current = true; setGone(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  // 살아 있기: 로그와 무관한 잔동작·자리 비우기·옆 손님. 시드로 결정론적, 로그 큐가 오면 그쪽이 우선(busy면 건너뛴다)
  useEffect(() => {
    const r = rng(`room:${seed}`);
    const k = lifeSpeed();
    const span = ([a, b]: [number, number]) => (a + r.next() * (b - a)) / k;
    const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
    const fidgets: Fidget[] = ['look', 'stretch', 'nod', 'sip'];
    const tickFidget = () => later(span(FIDGET_MS), () => {
      if (!busy.current && seatedRef.current) {
        const f = r.pick(fidgets);
        setFidget(f);
        later(2600, () => setFidget(cur => (cur === f ? null : cur)));
      }
      tickFidget();
    });
    const tickStroll = () => later(span(STROLL_MS), () => {
      if (!busy.current && seatedRef.current && !reducedMotion() && room.strolls.length) {
        const s = r.pick(room.strolls);
        busy.current = true;
        walkTo(s.spot, () => {
          busy.current = true; setPose(s.pose);
          later(span(STAY_MS), () => walkTo(room.seat, () => { setPose(undefined); }));
        });
      }
      tickStroll();
    });
    const tickGuest = () => later(span(GUEST_MS), () => {
      if (!encounter && !reducedMotion()) {
        const color = r.pick(GUEST_COLORS);
        setGuest({ spot: room.door, color, gone: false, walking: true });
        later(60, () => setGuest(g => g && { ...g, spot: room.ghostSeat }));
        later(1700, () => setGuest(g => g && { ...g, walking: false }));
        later(span(GUEST_STAY_MS), () => {
          setGuest(g => g && { ...g, spot: room.door, walking: true });
          later(1600, () => setGuest(g => g && { ...g, gone: true }));
          later(2100, () => setGuest(null));
        });
      }
      tickGuest();
    });
    tickFidget(); tickStroll(); tickGuest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  // 첫 그림: 마지막 줄의 표시는 보여 준다 (방금 벌어진 일처럼)
  useEffect(() => {
    const last = log[log.length - 1];
    const c = last && room.cueOf(last);
    if (c) show(c, last);
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = room.spots[spot]!;
  const seated = !walking && spot === room.seat;
  seatedRef.current = seated && !pose;
  const myPose: Pose = walking ? 'walk' : (pose ?? (seated ? seatPose : 'idle'));
  const friend = companions[0];
  const met = encounter?.talked ? encounter.agent : null;
  const ghost = encounter && !encounter.talked ? encounter.agent : null;
  const at = (s: Spot): CSSProperties => ({ transform: `translate(${s.x - SIZE / 2}px, ${s.y - SIZE * FEET}px)`, zIndex: Math.round(s.y) });

  return (
    <div className={`room ${fidget === 'sip' ? 'is-sipping' : ''}`} style={{ width: room.w, height: room.h }} aria-hidden="true">
      {room.back}
      <Props props={room.props} />
      <div className={`room-actor ${still ? 'is-still' : ''} ${heading.left ? 'face-left' : ''} ${seated ? 'is-seated' : ''} ${gone ? 'is-gone' : ''} ${fidget && fidget !== 'sip' ? `fidget-${fidget}` : ''}`} style={at(me)}>
        <Character pose={myPose} size={SIZE} back={heading.back && walking} />
      </div>
      {seated && !pose && (
        <div className="room-prop" style={{ left: room.seatItem.x - 32, top: room.seatItem.y - 20, zIndex: room.seatItem.base }}><SeatItem pose={seatPose} /></div>
      )}
      {friend && (
        <div className="room-actor is-still is-seated" style={at(room.spots[room.friendSeat]!)}>
          <Character pose={seatPose === 'draw' || seatPose === 'read' ? seatPose : 'sit'} size={SIZE} variant="friend" color={friend.color} />
        </div>
      )}
      {met && (
        <>
          <div className="room-actor is-still is-seated" style={at(room.spots[room.metSpot]!)}>
            <Character pose="wave" size={SIZE} variant="friend" color={met.color} />
          </div>
          <div className="room-bubble is-stay" style={{ left: room.spots[room.metSpot]!.x, top: room.spots[room.metSpot]!.y - SIZE * FEET - 4, zIndex: 999 }}>안녕!</div>
        </>
      )}
      {guest && (
        <div className={`room-actor is-guest ${guest.gone ? 'is-gone' : ''} ${guest.walking ? '' : 'is-seated'} ${guest.walking && guest.spot === room.ghostSeat ? 'face-left' : ''}`} style={at(room.spots[guest.spot]!)}>
          {/* 들어올 땐 위로 걸으니 뒷모습, 앉으면 정면, 나갈 땐 아래로 걸으니 정면 */}
          <Character pose={guest.walking ? 'walk' : 'sit'} size={SIZE} variant="friend" color={guest.color} back={guest.walking && guest.spot === room.ghostSeat} />
        </div>
      )}
      {ghost && (
        <div className="room-actor is-still is-ghost" style={at(room.spots[room.ghostSeat]!)}>
          <Character pose="sit" size={SIZE} variant="friend" color="#A08C76" paused />
        </div>
      )}
      {bubbles.map(b => (
        <div key={b.key} className={`room-bubble ${b.kind === 'money' ? 'is-money' : ''} ${b.kind === 'fx' ? 'is-fx' : ''} ${b.kind === 'notes' ? 'is-notes' : ''}`} style={{ left: b.spot.x, top: b.spot.y - 8, zIndex: 998 }}>
          <span>{b.text}</span>
        </div>
      ))}
    </div>
  );
}
