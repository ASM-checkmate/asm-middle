// ─── 방 랩 (dev page, `?lab=room`) ────────────────────────────────────────────
// 방은 그림 한 장(public/rooms/<방>, scripts/room-build.py)이고 사람은 늘 그 위를 걷는다 — 가구 뒤로 사라지지 않는다.
// 바닥을 누르면 걸을 수 있는 자리로 끌어들여 걸어가고, 트리거존에 들어서면 그 자리의 동작(자기·화장)이 걸린다.
// 동작은 '그 물건 + 사람'을 그린 방 전체 그림 몇 장이라 배경째 갈아 끼운다.
import { useEffect, useRef, useState } from 'react';
import { Room } from './room/Room';
import { Sprite, type Step } from './room/Sprite';
import { clamp, scaleAt, zoneAt, type Pt, type RoomJson } from './room/types';

const CSS = `
.rlab{box-sizing:border-box;min-height:100%;background:#1B1715;color:#F4EDE6;padding:18px 14px 40px;font-family:var(--body);display:grid;justify-items:center;gap:14px}
.rlab h1{font-family:var(--display);font-size:22px;margin:0}
.rlab .sub{font-family:var(--mono);font-size:11px;color:#A69C93;letter-spacing:.08em;text-align:center}
.rlab .stage{border-radius:18px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45);cursor:crosshair}
.rlab .rows{width:390px;display:grid;gap:10px}
.rlab .row{display:grid;grid-template-columns:52px 1fr;align-items:center;gap:8px}
.rlab .row b{font-family:var(--display);font-weight:400;font-size:13px;color:#CFC4BA}
.rlab .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rlab .chip{min-height:34px;padding:0 12px;border-radius:999px;border:1px solid #4A403A;background:#2A2422;color:#EDE4DC;font-size:13px;font-family:var(--display)}
.rlab .chip.on{background:#F2B233;color:#1B1715;border-color:#F2B233}
.rlab .hint{font-family:var(--mono);font-size:11px;color:#8C817A;width:390px;line-height:1.5}
.rlab .actor{position:absolute;left:0;top:0}
.rlab .actor img{display:block;pointer-events:none}
/* 접지 그림자: 발 밑 타원 두 겹(진한 심 + 퍼지는 테). 없으면 잘라 낸 그림이 바닥에 안 닿고 붕 뜬 것처럼 보인다 */
.rlab .shadow{position:absolute;left:0;top:0;border-radius:50%;pointer-events:none}
.rlab .shadow.core{background:radial-gradient(closest-side,rgba(46,32,20,.62),rgba(46,32,20,.44) 42%,rgba(46,32,20,0))}
.rlab .shadow.halo{background:radial-gradient(closest-side,rgba(46,32,20,.26),rgba(46,32,20,.15) 46%,rgba(46,32,20,0))}
`;

const ROOM_IDS = ['anime', 'bedroom'] as const;
type RoomId = (typeof ROOM_IDS)[number];
const ROOM_KO: Record<RoomId, string> = { anime: '애니풍 침실', bedroom: '클레이 침실' };

/** 방의 빛: 잘라 낸 사람 그림은 초록 배경에서 고르게 비춘 것이라 방의 노란 햇빛과 톤이 어긋난다 — 살짝 덧입혀 같은 공기로 만든다 */
const LIGHT: Record<RoomId, { tint: string; shadow: number; skew: number }> = {
  anime:   { tint: 'saturate(.86) contrast(.9) brightness(.99) sepia(.2) hue-rotate(-14deg)', shadow: 1, skew: -14 },
  bedroom: { tint: 'saturate(.94) contrast(.95) brightness(.96) sepia(.12) hue-rotate(-8deg)', shadow: 0.9, skew: -8 },
};

/** 정면 걷기 한 바퀴: 왼발 닿음·밀기·스침·뻗기·오른발 닿음, 그다음 밀기·뻗기는 좌우 뒤집어 (5장으로 여덟 칸) */
const FRONT_WALK: Step[] = [0, 1, 2, 3, 4, { f: 1, flip: true }, 2, { f: 3, flip: true }];
/** 맨 앞(배율 1)에서의 키 */
const SIZE = 215;
/** 걷는 속도 (방 px / 초) — 거리에 따라 걸리는 시간이 달라져야 걸음이 자연스럽다 */
const SPEED = 150;

export function RoomLab() {
  const [rid, setRid] = useState<RoomId>(((new URLSearchParams(location.search).get('room') as RoomId) || 'anime'));
  const [room, setRoom] = useState<RoomJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<Pt>([60, 556]);
  const [walking, setWalking] = useState(false);
  const [away, setAway] = useState(false);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [debug, setDebug] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setRoom(null); setErr(null); setWalking(false); setSceneId(null);
    fetch(`/rooms/${rid}/room.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: RoomJson) => { setRoom(j); setAt(j.home as Pt); })
      .catch(e => setErr(String(e)));
  }, [rid]);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** 그 자리로 걸어간다 — 바닥 밖이면 가장 가까운 바닥으로, 도착해서 존 안이면 그 동작이 걸린다 */
  const go = (r: RoomJson, x: number, y: number) => {
    const [tx, ty] = clamp(r.walk, x, y);
    const dist = Math.hypot(tx - at[0], ty - at[1]);
    const t = Math.max(260, Math.round((dist / SPEED) * 1000));
    clearTimeout(timer.current);
    setSceneId(null); setAway(ty < at[1] - 4); setMs(t); setAt([tx, ty]); setWalking(true);
    timer.current = window.setTimeout(() => {
      setWalking(false);
      const z = zoneAt(r, tx, ty);
      if (z) { setAt(z.stand as Pt); setSceneId(z.scene); }
    }, t + 30);
  };

  if (err) return <div className="rlab"><style>{CSS}</style><div className="hint">public/rooms/{rid}/room.json 을 못 읽었어요 ({err}) — python3 scripts/room-build.py {rid}</div></div>;
  if (!room) return <div className="rlab"><style>{CSS}</style><div className="hint">방 여는 중…</div></div>;

  const light = LIGHT[rid];
  const s = scaleAt(room, at[1]);
  const scene = sceneId ? room.scenes[sceneId] : undefined;
  const w = SIZE * 0.42;
  const actor = (
    <div className="actor" style={{ transform: `translate(${at[0]}px, ${at[1]}px) scale(${s.toFixed(3)})`, transformOrigin: '0 0', transition: `transform ${ms}ms linear` }}>
      <div className="shadow halo" style={{ width: w * 0.86, height: w * 0.26, opacity: light.shadow, transform: `translate(-50%, -50%) skewX(${light.skew}deg)` }} />
      <div className="shadow core" style={{ width: w * 0.40, height: w * 0.115, opacity: light.shadow, transform: `translate(-50%, -50%) skewX(${light.skew}deg)` }} />
      {walking
        ? <Sprite set={away ? 'walk-back' : 'walk-front'} order={away ? [1, 2, 3, 2] : FRONT_WALK} interval={away ? 200 : 140} size={SIZE} style={{ filter: light.tint }} />
        : <Sprite set="idle" order={[0, 0, 0, 1, 0, 0, 2, 0]} interval={700} size={SIZE} style={{ filter: light.tint }} />}
    </div>
  );

  const onFloor = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    go(room, Math.round(e.clientX - r.left), Math.round(e.clientY - r.top));
  };

  return (
    <div className="rlab">
      <style>{CSS}</style>
      <h1>방 랩</h1>
      <div className="sub">ROOM LAB · 방은 그림 한 장 · 바닥 안에서만 걷고 · 존에 들어서면 그 동작</div>
      <div className="stage" onClick={onFloor} title="바닥을 누르면 걸어간다">
        <Room room={room} scene={scene} actor={actor} debug={debug} />
      </div>
      <div className="rows">
        <div className="row">
          <b>방</b>
          <div className="chips">
            {ROOM_IDS.map(id => <button key={id} className={`chip${rid === id ? ' on' : ''}`} onClick={() => setRid(id)}>{ROOM_KO[id]}</button>)}
          </div>
        </div>
        <div className="row">
          <b>존</b>
          <div className="chips">
            {room.zones.map(z => (
              <button key={z.id} className={`chip${sceneId === z.scene ? ' on' : ''}`} onClick={() => go(room, z.stand[0], z.stand[1])}>{z.ko}</button>
            ))}
            <button className="chip" onClick={() => go(room, room.home[0], room.home[1])}>문 앞</button>
          </div>
        </div>
        <div className="row">
          <b>보기</b>
          <div className="chips">
            <button className={`chip${debug ? ' on' : ''}`} onClick={() => setDebug(d => !d)}>디버그</button>
            <span className="hint" style={{ width: 'auto' }}>발 ({Math.round(at[0])}, {Math.round(at[1])}) · 배율 {s.toFixed(2)} · {walking ? '걷는 중' : scene ? scene.ko : '서 있음'}</span>
          </div>
        </div>
      </div>
      <div className="hint">바닥·존은 scripts/room-build.py 의 ROOMS 에 적는다 (walk 다각형, zones). 동작 그림은 '그 물건 + 사람'이 든 방 전체 그림이라 배경째 갈아 끼운다 — 소품을 떼거나 앞뒤를 정하지 않는다.</div>
    </div>
  );
}
