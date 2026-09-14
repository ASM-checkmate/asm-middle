// ─── 방 랩 (dev page, `?lab=room`) ────────────────────────────────────────────
// 나노바나나 방(public/rooms/bedroom, scripts/room-parts.py)에 프레임 스프라이트 캐릭터를 놓는다: 서 있기·걷기(앞/뒤)는 프레임 반복(Sprite),
// 걸터앉기는 자세 그림, 자기·화장은 장면 프레임. 소품은 base, 인물은 발 y(또는 spot 의 z)로 앞뒤. 바닥을 누르면 걸어간다.
import { useEffect, useState } from 'react';
import { PngRoom } from './room/PngRoom';
import { FrameLoop } from './room/FrameLoop';
import { scaleAt, type RoomJson, type RoomSpot } from './room/types';
import { Sprite, type Step } from './room/Sprite';

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
.rlab .actor{position:absolute;transition:left 1.6s linear,top 1.6s linear}
.rlab .actor img{display:block;pointer-events:none}
`;

/** 정면 걷기 한 바퀴: 왼발 닿음·밀기·스침·뻗기·오른발 닿음, 그다음 밀기·뻗기는 좌우 뒤집어 (5장으로 8칸) */
const FRONT_WALK: Step[] = [0, 1, 2, 3, 4, { f: 1, flip: true }, 2, { f: 3, flip: true }];
/** 서 있는 캐릭터의 기본 높이(맨 앞, 배율 1) */
const SIZE = 215;
/** 자세 그림 (초록 뺀 PNG) 의 가로/세로 비 */
const POSE_SRC: Record<'sit' | 'lie' | 'back', string> = { sit: '/character/poses/sit.png', lie: '/character/poses/lie.png', back: '/character/poses/back.png' };

type At = { x: number; y: number; z?: number; size?: number; pose: RoomSpot['pose']; scene?: string };

/** 방 목록 (public/rooms/<id>/room.json) — 애니풍(anime2, 기본)과 클레이(bedroom) */
const ROOM_IDS = ['anime', 'bedroom'] as const;
const ROOM_KO: Record<(typeof ROOM_IDS)[number], string> = { anime: '애니풍 침실', bedroom: '클레이 침실' };

export function RoomLab() {
  const [rid, setRid] = useState<(typeof ROOM_IDS)[number]>((new URLSearchParams(location.search).get('room') as (typeof ROOM_IDS)[number]) || 'anime');
  const [room, setRoom] = useState<RoomJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<At>({ x: 70, y: 560, pose: 'idle' });
  const [walking, setWalking] = useState(false);
  const [away, setAway] = useState(false);   // 카메라에서 멀어지는 중이면 뒷모습 프레임
  const [debug, setDebug] = useState(false);
  const [doorClosed, setDoorClosed] = useState(false);

  useEffect(() => {
    setRoom(null); setErr(null); setWalking(false);
    fetch(`/rooms/${rid}/room.json`).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: RoomJson) => { setRoom(j); const d = j.spots.door; if (d) setAt({ ...d }); }).catch(e => setErr(String(e)));
  }, [rid]);

  const go = (s: At) => {
    // 걷는 동안은 서서(퍼펫 걷기) 이동하고, 도착하면 그 자리의 자세로
    setAt(a => { setAway(s.y < a.y - 4); return { ...a, x: s.x, y: s.y, z: undefined, size: undefined, scene: undefined, pose: 'idle' }; }); setWalking(true);
    setTimeout(() => { setWalking(false); setAt(s); }, 1650);
  };
  const onFloor = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    go({ x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top), pose: 'idle' });
  };

  if (err) return <div className="rlab"><style>{CSS}</style><div className="hint">public/rooms/{rid}/room.json 을 못 읽었어요 ({err}) — python3 scripts/room-parts.py {rid}</div></div>;
  if (!room) return <div className="rlab"><style>{CSS}</style><div className="hint">방 여는 중…</div></div>;

  const s = scaleAt(room, at.y);
  const h = at.size ?? SIZE * s;
  const standing = walking || at.pose === 'idle';
  // 서 있는 퍼펫은 기본 키(SIZE)로 그리고 transform 의 scale 로 원근을 준다 — 자리 이동과 크기 변화가 한 transition 으로 같이 흐른다
  const move = `translate(${at.x}px, ${at.y}px) scale(${s.toFixed(3)})`;
  // 장면(자기·화장): 갈아 끼우는 소품을 숨기고 "물건 + 사람" 프레임을 반복한다. 사람 스티커는 안 그린다 — 이불 위/아래 같은 가림은 그림 안에 이미 들어 있다
  const scene = !walking && at.pose === 'scene' && at.scene ? room.scenes?.[at.scene] : undefined;
  const props = room.props.filter(p => !p.hidden && !(scene && scene.replaces.includes(p.id)) || (p.id === 'door-closed' && doorClosed));
  const sceneFrames = scene ? scene.frames.map(id => room.props.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p) : [];
  const actor = standing
    ? <div className="actor" style={{ left: 0, top: 0, transform: move, transformOrigin: '0 0', transition: 'transform 1.6s linear' }}>
        {walking
          ? <Sprite set={away ? 'walk-back' : 'walk-front'} order={away ? [1, 2, 3, 2] : FRONT_WALK} interval={away ? 200 : 140} size={SIZE} />
          : <Sprite set="idle" order={[0, 0, 0, 1, 0, 0, 2, 0]} interval={700} size={SIZE} />}
      </div>
    : <div className="actor" style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y}px)` }}><img src={POSE_SRC[at.pose === 'lie' ? 'lie' : 'sit']} alt="" style={{ height: h, transform: 'translate(-50%, -100%)' }} /></div>;

  return (
    <div className="rlab">
      <style>{CSS}</style>
      <h1>방 랩</h1>
      <div className="sub">ROOM LAB · 방 레이어 · 걷기·서 있기·자기·화장 전부 프레임 반복 (조각 없음)</div>
      <div className="stage" onClick={onFloor} title="바닥을 누르면 걸어간다">
        <PngRoom room={{ ...room, props }} debug={debug} actors={scene ? [{ key: 'scene', y: sceneFrames[0]?.base ?? at.y, node: <FrameLoop frames={sceneFrames} interval={scene.interval} /> }] : [{ key: 'me', y: !walking && at.z ? at.z : at.y, node: actor }]} />
      </div>
      <div className="rows">
        <div className="row">
          <b>방</b>
          <div className="chips">
            {ROOM_IDS.map(id => <button key={id} className={`chip${rid === id ? ' on' : ''}`} onClick={() => setRid(id)}>{ROOM_KO[id]}</button>)}
          </div>
        </div>
        <div className="row">
          <b>자리</b>
          <div className="chips">
            {Object.entries(room.spots).map(([k, sp]) => <button key={k} className="chip" onClick={() => go({ ...sp })}>{k}</button>)}
          </div>
        </div>
        <div className="row">
          <b>보기</b>
          <div className="chips">
            <button className={`chip${debug ? ' on' : ''}`} onClick={() => setDebug(d => !d)}>디버그</button>
            <button className={`chip${doorClosed ? ' on' : ''}`} onClick={() => setDoorClosed(d => !d)}>문 닫기</button>
            <span className="hint" style={{ width: 'auto' }}>발 ({at.x}, {at.y}) · 배율 {s.toFixed(2)} · {walking ? '걷는 중' : at.pose}</span>
          </div>
        </div>
      </div>
      <div className="hint">소품·spot 은 scripts/room-parts.py 가 art/gen 의 방 편집본 차분으로 만든다 (public/rooms/bedroom/room.json). 자세 그림은 public/character/poses.</div>
    </div>
  );
}
