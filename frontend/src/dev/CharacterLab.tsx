// ─── Character lab (dev page, mounted at ?lab=character) ─────────────────────
// Every pose and every Rider costume at two sizes on the paper ground, with toggles.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Character, CharacterDefs, Rider } from '../character';
import type { Pose } from '../character';
import type { TransportMode } from '../sim/types';

const POSES: Pose[] = ['idle', 'walk', 'sit', 'sleep', 'wave', 'draw', 'happy', 'eat', 'read', 'think'];
const POSE_KO: Record<Pose, string> = { idle: '가만히', walk: '걷기', sit: '앉기', sleep: '잠', wave: '인사', draw: '그리기', happy: '기쁨', eat: '먹기', read: '읽기', think: '생각' };
const MODES: TransportMode[] = ['walk', 'car', 'plane', 'boat', 'train', 'subway'];
const MODE_KO: Record<TransportMode, string> = { walk: '걷기', car: '자동차', plane: '비행기', boat: '배', train: '기차', subway: '지하철' };

const CSS = `
.clab{box-sizing:border-box;width:100%;max-width:100%;min-width:0;height:100%;background:var(--paper);color:var(--ink);padding:18px 14px 40px;overflow-x:hidden;overflow-y:auto;font-family:var(--body)}
.clab *{min-width:0}
.clab h1{font-family:var(--display);font-size:26px;margin:0 0 2px}
.clab .sub{font-family:var(--mono);font-size:11px;color:var(--ink-2);letter-spacing:.08em;margin-bottom:12px}
.clab h2{font-family:var(--display);font-size:19px;margin:22px 0 10px;display:flex;align-items:baseline;gap:8px}
.clab h2 small{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
.clab .bar{display:flex;flex-wrap:wrap;gap:8px}
.clab .tg{min-height:44px;padding:0 14px;border:2px solid var(--ink);border-radius:999px;background:var(--card);font-family:var(--display);font-size:14px;box-shadow:3px 3px 0 var(--ink);display:inline-flex;align-items:center;gap:6px}
.clab .tg.on{background:var(--sun)}
.clab .tg:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--ink)}
.clab .range{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;color:var(--ink-2);min-height:44px}
.clab .range input{width:140px;accent-color:var(--coral)}
.clab .grid{display:grid;gap:10px}
.clab .grid.big{grid-template-columns:repeat(2,minmax(0,1fr))}
.clab .grid.small{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.clab .cell{background:var(--card);border:2px solid var(--ink);border-radius:20px;box-shadow:4px 4px 0 var(--ink);padding:10px 6px 6px;display:grid;justify-items:center;gap:2px}
.clab .cell.sm{border-radius:14px;padding:6px 2px 4px;box-shadow:3px 3px 0 var(--ink)}
.clab .cell b{font-family:var(--display);font-weight:400;font-size:14px}
.clab .cell.sm b{font-size:11px}
.clab .ground{background:var(--mint-2);border:2px solid var(--ink);border-radius:20px;box-shadow:4px 4px 0 var(--ink);padding:14px 8px 10px;display:grid;justify-items:center;gap:4px;position:relative;overflow:hidden;min-width:0}
.clab .ground>svg,.clab .cell>svg{max-width:100%;height:auto}
.clab .ground::before{content:"";position:absolute;left:0;right:0;top:calc(50% + 34px);height:6px;border-top:3px dashed var(--coral);opacity:.55}
.clab .ground.sm{padding:10px 4px 6px;border-radius:14px;box-shadow:3px 3px 0 var(--ink)}
.clab .ground b{font-family:var(--display);font-weight:400;font-size:14px;position:relative}
.clab .ground.sm b{font-size:11px}
.clab .row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.clab .row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
`;

export function CharacterLab() {
  const [variant, setVariant] = useState<'me' | 'friend'>('me');
  const [facing, setFacing] = useState<'right' | 'left'>('right');
  const [moving, setMoving] = useState(true);
  const [friend, setFriend] = useState(false);
  const [night, setNight] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [doors, setDoors] = useState<'open' | 'closed'>('closed');
  const [boarding, setBoarding] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScale] = useState(1);

  const board = () => { setBoarding(true); setTimeout(() => setBoarding(false), 220); };
  const tg = (on: boolean) => `tg${on ? ' on' : ''}`;

  return (
    <div className="clab" style={{ '--friend': '#5FC9A6' } as CSSProperties}>
      <style>{CSS}</style>
      <CharacterDefs />
      <h1>캐릭터 랩</h1>
      <div className="sub">CHARACTER LAB · 포즈 10 · 탈것 6 · 2 사이즈</div>

      <h2>포즈 <small>Character · 150 / 72px</small></h2>
      <div className="bar">
        <button className={tg(variant === 'friend')} onClick={() => setVariant(v => (v === 'me' ? 'friend' : 'me'))}>{variant === 'me' ? '나' : '친구'} 버전</button>
        <button className={tg(paused)} onClick={() => setPaused(p => !p)}>{paused ? '멈춤' : '움직임'}</button>
      </div>
      <div className="grid big" style={{ marginTop: 10 }}>
        {POSES.map(p => (
          <div className="cell" key={p}>
            <Character pose={p} variant={variant} size={150} paused={paused} />
            <b>{POSE_KO[p]}</b>
          </div>
        ))}
      </div>
      <div className="grid small" style={{ marginTop: 10 }}>
        {POSES.map(p => (
          <div className="cell sm" key={p}>
            <Character pose={p} variant={variant} size={62} paused={paused} />
            <b>{POSE_KO[p]}</b>
          </div>
        ))}
      </div>

      <h2>탈것 <small>Rider · 기본 크기 / 96px</small></h2>
      <div className="bar">
        <button className={tg(facing === 'left')} onClick={() => setFacing(f => (f === 'right' ? 'left' : 'right'))}>{facing === 'right' ? '→ 오른쪽' : '← 왼쪽'}</button>
        <button className={tg(!moving)} onClick={() => setMoving(m => !m)}>{moving ? '이동 중' : '멈춤'}</button>
        <button className={tg(friend)} onClick={() => setFriend(f => !f)}>친구 동승</button>
        <button className={tg(night)} onClick={() => setNight(n => !n)}>밤</button>
        <button className={tg(sleeping)} onClick={() => setSleeping(s => !s)}>기내 낮잠</button>
        <button className={tg(doors === 'open')} onClick={() => setDoors(d => (d === 'open' ? 'closed' : 'open'))}>문 열기</button>
        <button className="tg" onClick={board}>탑승 스쿼시</button>
        <label className="range">기울기 {tilt}°<input type="range" min={-35} max={35} value={tilt} onChange={e => setTilt(Number(e.target.value))} /></label>
        <label className="range">배속 x{timeScale.toFixed(1)}<input type="range" min={0.5} max={3} step={0.5} value={timeScale} onChange={e => setTimeScale(Number(e.target.value))} /></label>
      </div>
      <div className="row2" style={{ marginTop: 10, '--time-scale': timeScale } as CSSProperties}>
        {MODES.map(m => (
          <div className="ground" key={m}>
            <Rider mode={m} facing={facing} moving={moving} friend={friend} night={night} sleeping={sleeping} doors={doors} boarding={boarding} tilt={m === 'plane' ? tilt : undefined} />
            <b>{MODE_KO[m]}</b>
          </div>
        ))}
      </div>
      <div className="row3" style={{ marginTop: 10, '--time-scale': timeScale } as CSSProperties}>
        {MODES.map(m => (
          <div className="ground sm" key={m}>
            <Rider mode={m} size={96} facing={facing} moving={moving} friend={friend} night={night} sleeping={sleeping} doors={doors} boarding={boarding} tilt={m === 'plane' ? tilt : undefined} />
            <b>{MODE_KO[m]}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
