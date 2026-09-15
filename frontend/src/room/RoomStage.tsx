// ─── 방 안의 인물을 로그와 손가락으로 움직인다 (ADR-0015 · ADR-0028) ────────────────────
// 자리는 sim이 정한다(activityLog의 줄 → 큐)지만, 사용자가 바닥이나 트리거 존을 누르면 거기로 걸어간다.
// 인물의 위치는 연속 좌표이고 걷는 시간은 거리 ÷ 속도(실제 시간)다 — 시계 배속과 무관하게, 멀면 오래 걷는다.
// 처음 그릴 때(화면 진입·미리보기)는 지금까지의 마지막 큐 자리에 바로 서고, 새 줄이 붙을 때만 걸어간다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Character, type Pose } from '../character';
import type { LogLine } from '../sim/actlog';
import type { Cast } from '../sim/agents';
import { DEFAULT_LOOK, type Friend } from '../sim/types';
import { rng } from '../sim/rng';
import { Props, SeatItem, zonesOf, type Cue, type RoomSpec, type Spot, type Zone } from './Room';
import './room.css';

const SIZE = 96;              // 인물 한 변 (px). 발은 그림의 91 % 행
const PRESENT_SIZE = 84;      // 같은 공간에 있던 사람 — 조금 작게, 뒤쪽에 (FRIENDS_SPEC §6 표)
/** 배경 인물 자리: 옆 손님 자리(ghostSeat) 다음은 방마다 이 이름 중 처음 있는 것 (창가·카운터·둘째 옆자리·물가…) */
const PRESENT_SPOTS = ['window', 'counter', 'side2', 'shore', 'kiosk', 'water', 'mirror', 'escalator', 'label', 'fountain', 'kitchen', 'path'];
/**
 * 등을 보이는 게 자연스러운 자리 — 무언가를 마주 보고 서는 곳(카운터·창·키오스크·거울·설명판·에스컬레이터·부엌)과 물가.
 * 그 밖(옆자리·분수·길)은 그냥 앞을 본다: 방은 내 캐릭터가 지금 보는 장면이라 얼굴을 가릴 이유가 없다.
 * 얼굴을 감추는 것은 **사진** 쪽 규칙이다 (FRIENDS_SPEC §6 — 남의 사진에 얼굴이 실리지 않게).
 */
const BACK_SPOTS = new Set(['window', 'counter', 'kiosk', 'mirror', 'escalator', 'label', 'kitchen', 'shore', 'water']);
const FEET = 0.91;
const SPEED = 120;            // 걷는 속도 (px/s) — 방을 대각선으로 가로지르는 데 4초쯤. 옛 1.4초 고정과 비슷한 체감
const MIN_WALK_MS = 320;      // 아주 가까워도 걸음 한 번은 보인다
const DWELL_MS = 4000;
const POSE_MS = 8000;         // 걷지 않는 큐의 자세(생각·기쁨)는 잠깐 — 지나면 자리의 자세로
const NEAR = 64;              // 존 근처 판정: 발과 존 자리의 거리 (px)
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
const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y);

interface Bubble { key: number; spot: Spot; text: string; kind?: Cue['kind']; stay?: boolean }

export interface RoomStageProps {
  room: RoomSpec;
  /** 지금까지 찍힌 로그 (시각 순, 화면이 이미 now로 걸렀다) */
  log: LogLine[];
  /** 자리에 앉았을 때의 자세 (활동 종류) */
  seatPose: Pose;
  /** 지금 이 순간의 인물 구성 (sim/agents castAt): 동행은 옆자리 정면, 만난 사람은 `at` 뒤부터 met 자리에서 손 흔들고, 같은 공간의 사람들은 뒷모습으로 배경에 */
  cast?: Cast;
  /** cast 없이 동행만 (시간표의 기다리는 방 — TimetableScreen) */
  companions?: Friend[];
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

/**
 * 방 안의 무대. 인물은 로그 큐(sim) · 사용자의 탭 · 살아 있기(산책·잔동작) 세 출처로 움직이는데, 우선순위는
 * 로그 > 사용자 > 살아 있기다: 로그 큐는 뭘 하고 있든 끊고 가고(방은 sim이 사는 곳), 사용자 탭은 산책·잔동작을 끊고,
 * 산책·잔동작은 인물이 쉬고 있을 때만 끼어든다. 큐의 `then`과 산책의 복귀 자리는 사용자가 마지막으로 고른 존(없으면 내 자리)이다.
 */
export function RoomStage({ room, log, seatPose, cast: castProp, companions = [], seed, leaving = false }: RoomStageProps) {
  const cast: Cast = castProp ?? { companions, present: [] };
  const rest = restingSpot(room, log);
  const zones = useMemo(() => zonesOf(room), [room]);
  const presentRef = useRef(cast.present.length);          // 옆 손님 타이머가 읽는다 — 배경 인물이 있으면 그 자리에 손님이 안 온다
  presentRef.current = cast.present.length;
  const [pos, setPos] = useState<Spot>(room.spots[rest.spot]!);   // 발 위치 (걷는 동안은 도착점까지 rAF가 DOM에 직접 쓴다)
  const posRef = useRef(pos);
  const [at, setAt] = useState<string | null>(rest.spot);        // 이름난 자리에 서 있으면 그 이름 (바닥 아무 데나면 null)
  const atRef = useRef(at);
  atRef.current = at;
  const base = useRef(room.seat);                                  // 큐의 then·산책이 돌아오는 자리 — 사용자가 존을 고르면 그 자리
  const [pose, setPose] = useState<Cue['pose'] | undefined>(rest.pose);
  const [walking, setWalking] = useState(false);
  const [heading, setHeading] = useState<{ back: boolean; left: boolean }>({ back: false, left: false });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const seen = useRef<number>(log.length ? log[log.length - 1]!.at : -Infinity);
  const timers = useRef<number[]>([]);                             // 살아 있기 스케줄러·자세 되돌리기 — 언마운트에만 지운다
  const pending = useRef<number[]>([]);                            // 지금 행동의 뒤따르는 타이머(머물다 돌아오기) — 다음 행동이 끊는다
  const anim = useRef(0);                                          // 걷는 rAF
  const actorRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);                              // 말풍선 키 — StrictMode가 효과를 두 번 돌려도 겹치지 않게
  const [fidget, setFidget] = useState<Fidget | null>(null);
  const [guest, setGuest] = useState<{ spot: string; color: string; gone: boolean; walking: boolean } | null>(null);
  const busy = useRef(false);                          // 걷는 중·자리 비운 중 — 잔동작·산책이 겹치지 않게
  const restingRef = useRef(false);                    // 이름난 자리에 서서 잠깐 자세도 없이 쉬는 중 — 잔동작·산책이 끼어들 수 있다
  const seatedRef = useRef(false);
  const [gone, setGone] = useState(false);             // 문 밖으로 나갔다
  const goneRef = useRef(false);

  /** 옆 손님이 일어나 문으로 나간다 — 머문 시간이 다 됐거나, 내가 그 자리로 가려고 할 때 */
  const leaveGuest = () => {
    setGuest(g => g && (g.walking ? g : { ...g, spot: room.door, walking: true }));
    timers.current.push(window.setTimeout(() => setGuest(g => g && { ...g, gone: true }), 1600));
    timers.current.push(window.setTimeout(() => setGuest(null), 2100));
  };
  /** 인물 div의 자리를 DOM에 직접 쓴다 — 걷는 동안 매 프레임 React를 돌리지 않으려고. z-index는 바닥 접점 행 */
  const place = (p: Spot) => {
    const el = actorRef.current;
    if (!el) return;
    el.style.transform = `translate(${p.x - SIZE / 2}px, ${p.y - SIZE * FEET}px)`;
    el.style.zIndex = String(Math.round(p.y));
  };
  useLayoutEffect(() => { place(pos); }, [pos]);

  /** 지금 행동(걷기와 그 뒤의 머물기)을 끊는다 — 다음 행동이 그 자리에서 이어진다 */
  const cancelAction = () => {
    cancelAnimationFrame(anim.current);
    pending.current.forEach(clearTimeout); pending.current = [];
  };
  /** 자리(이름 또는 좌표)로 걸어간다 — 걷는 시간은 거리 ÷ 속도, 방향은 출발·도착점으로, 도착하면 after */
  const walkTo = (to: string | Spot, after?: () => void) => {
    const name = typeof to === 'string' ? to : null;
    const dest = name ? room.spots[name]! : (to as Spot);
    cancelAction();
    const from = { ...posRef.current };
    const ms = reducedMotion() ? 0 : Math.max(MIN_WALK_MS, (dist(from, dest) / SPEED) * 1000);
    setHeading({ back: dest.y < from.y - 30, left: dest.x < from.x - 10 });
    setWalking(true); setAt(null); busy.current = true; setFidget(null);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = ms ? Math.min(1, (t - t0) / ms) : 1;
      const p = { x: from.x + (dest.x - from.x) * k, y: from.y + (dest.y - from.y) * k };
      posRef.current = p; place(p);
      if (k < 1) { anim.current = requestAnimationFrame(step); return; }
      setPos(p); setAt(name); setWalking(false); setHeading(h => ({ ...h, back: false })); busy.current = false;
      after?.();
    };
    anim.current = requestAnimationFrame(step);
  };
  const say = (text: string, kind?: Cue['kind'], where?: Spot) => {
    const p = where ?? { x: posRef.current.x, y: posRef.current.y - SIZE * FEET };
    setBubbles(b => [...b.slice(-2), { key: ++seq.current, spot: p, text, kind }]);
  };
  const show = (c: Cue, line: LogLine) => say(c.say ?? line.text, c.kind, c.at ? room.spots[c.at] : undefined);

  // 새 줄이 붙으면 큐를 실행한다 — sim이 방의 주인이라, 사용자가 시킨 일도 끊는다
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
          // 돌아갈 자리는 큐의 then이 아니라 사용자가 마지막으로 고른 곳 — 큐는 "잠깐 갔다 온다"만 말한다
          if (c.then) pending.current.push(window.setTimeout(() => walkTo(base.current, () => setPose(undefined)), DWELL_MS));
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
    goneRef.current = true; busy.current = true; setFidget(null); setPose(undefined);
    walkTo(room.door, () => { busy.current = true; setGone(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  // 살아 있기: 로그와 무관한 잔동작·자리 비우기·옆 손님. 시드로 결정론적, 로그 큐·사용자 탭이 오면 그쪽이 우선(busy면 건너뛴다)
  useEffect(() => {
    const r = rng(`room:${seed}`);
    const k = lifeSpeed();
    const span = ([a, b]: [number, number]) => (a + r.next() * (b - a)) / k;
    const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
    const fidgets: Fidget[] = ['look', 'stretch', 'nod', 'sip'];
    const tickFidget = () => later(span(FIDGET_MS), () => {
      if (!busy.current && restingRef.current) {
        // 한 모금은 테이블 위 컵이 떠오르는 것이라 내 자리에서만
        const f = r.pick(seatedRef.current ? fidgets : fidgets.filter(x => x !== 'sip'));
        setFidget(f);
        later(2600, () => setFidget(cur => (cur === f ? null : cur)));
      }
      tickFidget();
    });
    const tickStroll = () => later(span(STROLL_MS), () => {
      if (!busy.current && restingRef.current && !reducedMotion() && room.strolls.length) {
        const s = r.pick(room.strolls.filter(x => x.spot !== atRef.current));
        if (!s) { tickStroll(); return; }
        busy.current = true;
        walkTo(s.spot, () => {
          busy.current = true; setPose(s.pose);
          pending.current.push(window.setTimeout(() => walkTo(base.current, () => { setPose(undefined); }), span(STAY_MS)));
        });
      }
      tickStroll();
    });
    const tickGuest = () => later(span(GUEST_MS), () => {
      // 임의의 옆 손님은 배경 인물이 없을 때만 — 같은 공간의 사람들이 그 자리(ghostSeat)를 쓴다. 내가 거기 앉아 있어도 안 온다
      if (!presentRef.current && !reducedMotion() && atRef.current !== room.ghostSeat) {
        const color = r.pick(GUEST_COLORS);
        setGuest({ spot: room.door, color, gone: false, walking: true });
        later(60, () => setGuest(g => g && { ...g, spot: room.ghostSeat }));
        later(1700, () => setGuest(g => g && { ...g, walking: false }));
        later(span(GUEST_STAY_MS), leaveGuest);
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
    return () => { cancelAction(); timers.current.forEach(clearTimeout); timers.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 사용자 입력 (ADR-0028): 존을 누르면 거기 가서 그 일을, 바닥을 누르면 거기까지 걷기 ───
  /** 존을 눌렀다: 걸어가서 존의 자세·말. 이 자리가 이제 돌아올 곳이다 */
  const tapZone = (z: Zone) => {
    if (goneRef.current) return;
    base.current = z.spot;
    if (z.spot === room.ghostSeat) leaveGuest();
    const arrive = () => { setPose(z.pose); if (z.say) say(z.say); };
    if (atRef.current === z.spot && !busy.current) { arrive(); return; }
    walkTo(z.spot, arrive);
  };
  /** 바닥을 눌렀다: 화면 좌표 → 방 좌표(방이 축소돼 있어도), 바닥 범위 안으로 당겨서 걷는다. 도착하면 그냥 서 있는다 */
  const tapFloor = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (goneRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const k = r.width / room.w;
    const floorTop = Math.min(...Object.values(room.spots).map(s => s.y));   // 벽 아래 첫 자리 행 — 그보다 위는 벽
    const x = Math.min(room.w - SIZE * 0.35, Math.max(SIZE * 0.35, (e.clientX - r.left) / k));
    const y = Math.min(room.h - 8, Math.max(floorTop, (e.clientY - r.top) / k));
    walkTo({ x, y }, () => setPose(undefined));
  };

  const me = pos;
  const seated = !walking && at === room.seat;
  seatedRef.current = seated && !pose;
  restingRef.current = !walking && !pose && at !== null;
  const myPose: Pose = walking ? 'walk' : (pose ?? (seated ? seatPose : 'idle'));
  // 근처의 존 하나(발과 가장 가까운 것) — 빛나고 이름표가 뜬다. 걷는 중·거기 서 있는 중엔 없다
  const near = walking ? null : zones.map(z => ({ z, d: dist(me, room.spots[z.spot]!) })).filter(x => x.d < NEAR).sort((a, b) => a.d - b.d)[0]?.z ?? null;
  const friend = cast.companions[0];
  const met = cast.met;
  // 같은 공간에 있던 사람들: 옆 손님 자리부터, 그 다음은 방에 있는 이름난 자리 (창가·카운터…) — 최대 둘
  const presentSpots = [room.ghostSeat, ...PRESENT_SPOTS.filter(s => s !== room.ghostSeat && !!room.spots[s])];
  const present = cast.present.slice(0, presentSpots.length).map((p, i) => ({ ...p, spot: presentSpots[i]! }));
  const atStyle = (s: Spot, size = SIZE): CSSProperties => ({ transform: `translate(${s.x - size / 2}px, ${s.y - size * FEET}px)`, zIndex: Math.round(s.y) });

  return (
    <div className={`room ${fidget === 'sip' ? 'is-sipping' : ''}`} style={{ width: room.w, height: room.h }} aria-hidden="true" onPointerDown={tapFloor}>
      {room.back}
      {zones.map(z => (
        <div key={z.key} className={`room-zone ${near?.key === z.key ? 'is-near' : ''} ${at === z.spot ? 'is-here' : ''}`}
          style={{ left: z.x, top: z.y, width: z.w, height: z.h }} onPointerDown={e => { e.stopPropagation(); tapZone(z); }} />
      ))}
      {near && at !== near.spot && (
        <div className="room-zone-tag" style={{ left: near.x + near.w / 2, top: near.y - 4, zIndex: 997 }}>{near.label}</div>
      )}
      <Props props={room.props} />
      <div ref={actorRef} className={`room-actor is-me ${heading.left ? 'face-left' : ''} ${seated ? 'is-seated' : ''} ${gone ? 'is-gone' : ''} ${fidget && fidget !== 'sip' ? `fidget-${fidget}` : ''}`}>
        <Character pose={myPose} size={SIZE} back={heading.back && walking} />
      </div>
      {seated && !pose && (
        <div className="room-prop" style={{ left: room.seatItem.x - 32, top: room.seatItem.y - 20, zIndex: room.seatItem.base }}><SeatItem pose={seatPose} /></div>
      )}
      {friend && (
        <div className="room-actor is-still is-seated" style={atStyle(room.spots[room.friendSeat]!)}>
          <Character pose={seatPose === 'draw' || seatPose === 'read' ? seatPose : 'sit'} size={SIZE} variant="friend" color={friend.color} />
        </div>
      )}
      {/* 같은 공간에 있던 사람들 (FRIENDS_SPEC §6 표): 배경에 뒷모습·작게·얼굴 없이, 살짝 흐리게. 말을 건 상대도 `at` 전엔 이 중 하나고,
          `at`이 지나면 배경에서 빠져 met 자리에 정면으로 선다. 설렘 대상(cast의 glance)만 슬쩍 돌아본 3/4 얼굴 (AFFECTION_SPEC §4) */}
      {present.map(p => (
        <div key={p.id} className="room-actor is-still is-present" style={atStyle(room.spots[p.spot]!, PRESENT_SIZE)}>
          <Character pose={p.spot === room.ghostSeat ? 'sit' : 'idle'} size={PRESENT_SIZE} variant="friend" color={p.color} look={p.hairStyle ? { ...DEFAULT_LOOK, hairStyle: p.hairStyle } : undefined} back={BACK_SPOTS.has(p.spot)} glance={BACK_SPOTS.has(p.spot) && p.glance} paused />
        </div>
      ))}
      {met && (
        <>
          <div className="room-actor is-still is-seated" style={atStyle(room.spots[room.metSpot]!)}>
            <Character pose="wave" size={SIZE} variant="friend" color={met.color} look={met.hairStyle ? { ...DEFAULT_LOOK, hairStyle: met.hairStyle } : undefined} />
          </div>
          <div className="room-bubble is-stay" style={{ left: room.spots[room.metSpot]!.x, top: room.spots[room.metSpot]!.y - SIZE * FEET - 4, zIndex: 999 }}>안녕!</div>
        </>
      )}
      {guest && !present.length && (
        <div className={`room-actor is-guest ${guest.gone ? 'is-gone' : ''} ${guest.walking ? '' : 'is-seated'} ${guest.walking && guest.spot === room.ghostSeat ? 'face-left' : ''}`} style={atStyle(room.spots[guest.spot]!)}>
          {/* 들어올 땐 위로 걸으니 뒷모습, 앉으면 정면, 나갈 땐 아래로 걸으니 정면 */}
          <Character pose={guest.walking ? 'walk' : 'sit'} size={SIZE} variant="friend" color={guest.color} back={guest.walking && guest.spot === room.ghostSeat} />
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
