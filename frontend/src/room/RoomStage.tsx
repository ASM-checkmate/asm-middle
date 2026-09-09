// ─── 방 안의 인물을 로그로 움직인다 (ADR-0015) ───────────────────────────────
// 자리는 sim이 정한다(activityLog의 줄 → 큐), 걷는 시간은 실제 시간(1.4초 transition)이다 — 시계 배속과 무관하게 걷는 것처럼 보인다.
// 처음 그릴 때(화면 진입·미리보기)는 지금까지의 마지막 큐 자리에 바로 서고, 새 줄이 붙을 때만 걸어간다.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Character, type Pose } from '../character';
import type { LogLine } from '../sim/actlog';
import type { Friend, PhaseEncounter } from '../sim/types';
import { Props, SeatItem, type Cue, type RoomSpec, type Spot } from './Room';
import './room.css';

const SIZE = 96;              // 인물 한 변 (px). 발은 그림의 91 % 행
const FEET = 0.91;
const WALK_MS = 1400;
const DWELL_MS = 4000;

interface Bubble { key: number; spot: Spot; text: string; kind?: Cue['kind']; stay?: boolean }

export interface RoomStageProps {
  room: RoomSpec;
  /** 지금까지 찍힌 로그 (시각 순, 화면이 이미 now로 걸렀다) */
  log: LogLine[];
  /** 자리에 앉았을 때의 자세 (활동 종류) */
  seatPose: Pose;
  companions: Friend[];
  encounter?: PhaseEncounter;
}

/** 큐가 최종적으로 남기는 자리·자세 — 처음 그릴 때 dwell을 건너뛰고 바로 여기에 선다 */
function restingSpot(room: RoomSpec, log: LogLine[]): { spot: string; pose?: Cue['pose'] } {
  let spot = room.seat, pose: Cue['pose'];
  for (const l of log) {
    const c = room.cueOf(l);
    if (!c) continue;
    if (c.go) { spot = c.then ?? c.go; pose = c.then ? undefined : c.pose; }
    else if (c.pose) pose = c.pose;
  }
  return { spot, pose };
}

export function RoomStage({ room, log, seatPose, companions, encounter }: RoomStageProps) {
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

  /** 자리로 걸어간다 — 방향은 출발·도착 자리로, 도착하면 자리의 자세 */
  const walkTo = (to: string, after?: () => void) => {
    const from = room.spots[spotRef.current]!, dest = room.spots[to]!;
    setHeading({ back: dest.y < from.y - 30, left: dest.x < from.x - 10 });
    setStill(false); setWalking(true); setSpot(to);
    timers.current.push(window.setTimeout(() => { setWalking(false); setHeading(h => ({ ...h, back: false })); after?.(); }, WALK_MS));
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
      } else { if (c.pose) setPose(c.pose); show(c, line); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.length]);
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
  const myPose: Pose = walking ? 'walk' : (pose ?? (seated ? seatPose : 'idle'));
  const friend = companions[0];
  const met = encounter?.talked ? encounter.agent : null;
  const ghost = encounter && !encounter.talked ? encounter.agent : null;
  const at = (s: Spot): CSSProperties => ({ transform: `translate(${s.x - SIZE / 2}px, ${s.y - SIZE * FEET}px)`, zIndex: Math.round(s.y) });

  return (
    <div className="room" style={{ width: room.w, height: room.h }} aria-hidden="true">
      {room.back}
      <Props props={room.props} />
      <div className={`room-actor ${still ? 'is-still' : ''} ${heading.left ? 'face-left' : ''} ${seated ? 'is-seated' : ''}`} style={at(me)}>
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
