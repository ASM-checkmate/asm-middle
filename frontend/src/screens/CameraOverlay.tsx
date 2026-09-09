import { memo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect } from 'react';
import { gyroAvailable, useGyro, type GyroState } from './useGyro';
import { Stage3D } from './Stage3D';
import { useWorld } from '../sim/store';
import { rng } from '../sim/rng';
import type { Friend, PhaseEncounter, PlaceType, ScheduledActivity, ShotWin, UserShot } from '../sim/types';
import { WIN_LABEL, shotsFor, winAt, winState } from '../sim/shots';
import { hhmmIn } from '../sim/tz';
import { Character, type Pose } from '../character';
import { Scene } from '../scenes';
import { Button } from '../ui';
import { GHOST, poseFor } from './util';
import './camera.css';

type Crop = UserShot['crop'];
const CROP0: Crop = { scale: 1, x: 0, y: 0, rot: 0, pitch: 0, light: 1, dof: 0, focus: 'near', yaw: 0 };
/**
 * 카메라를 열면 구도가 일부러 흐트러져 있다 — 자리·확대·기울임·각도·조도·심도·초점·방향이 조금씩 어긋난 채 시작한다
 * (오너 결정 2026-09-08: 맞추는 게 촬영이다). 활동·창마다 같은 값(시드)이라 닫았다 열어도 같은 자리에서 다시 시작한다.
 * 방향(ADR-0014)은 기존 난수 순서 **뒤**에 뽑는다 — 앞의 값들은 그대로다.
 */
export function messyStart(actKey: string, win: ShotWin): Crop {
  const r = rng(`cam:${actKey}:${win}`);
  const sp = (a: number, b: number) => a + r.next() * (b - a);
  const step = (v: number, q: number) => Math.round(v / q) * q;
  return {
    x: step(sp(-18, 18), 0.1), y: step(sp(-14, 14), 0.1), scale: step(sp(1.0, 1.7), 0.05), rot: step(sp(-10, 10), 0.5),
    pitch: step(sp(-10, 10), 1), light: step(sp(0.7, 1.25), 0.05), dof: step(sp(0.15, 0.8), 0.05), focus: r.next() < 0.5 ? 'near' : 'far',
    yaw: step(sp(-8, 8), 0.5),
  };
}
/** QA: `?preview=active:…&camera=1&crop=scale:1.4,yaw:12,pitch:-6,dof:0` — 흐트러진 시작 대신 정해진 구도로 연다 (스크린샷용). 빠진 키는 CROP0 */
export function cropParam(search: string = typeof location !== 'undefined' ? location.search : ''): Crop | null {
  const v = new URLSearchParams(search).get('crop');
  if (!v) return null;
  const c: Crop = { ...CROP0 };
  for (const kv of v.split(',')) {
    const [k, raw] = kv.split(':');
    if (k === 'focus') { if (raw === 'near' || raw === 'far') c.focus = raw; continue; }
    const n = Number(raw);
    if (Number.isFinite(n) && k && k in CROP0) (c as unknown as Record<string, number>)[k] = n;
  }
  return c;
}
/** 프레이밍 범위 — types.ts ShotCrop 주석 그대로: x/y ±35 %(뷰포트 자기 크기 대비), 확대 1.0~2.2, 기울임 ±15°, 각도 ±18°, 방향 ±12°, 조도 0.55~1.45, 심도 0~1 */
const PAN_MAX = 35;
const YAW_MAX = 12;
const SCALE_MIN = 1;
const SCALE_MAX = 2.2;
const ROT_MAX = 15;
const PITCH_MAX = 18;
const LIGHT_MIN = 0.55;
const LIGHT_MAX = 1.45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
/** `.cam-shot`의 CSS 변수 — 만화 `.cm-shot`과 같은 이름(--rot/--cs/--cx/--cy), 단위만 %(unit 'pct').
 *  각도(--pitch/--pitchn)·방향(--yaw/--yawn, ADR-0014)·조도(--light)는 카메라에서만 쓰는 변수 — 옛 샷(필드 없음)은 0°·1배로 그린다.
 *  --yawn은 무대의 깊이 층(camera.css .sc-*)과 캐릭터의 얼굴(character.css)이 같이 읽는다 */
const cropVars = (c: Crop): CSSProperties => ({
  ['--rot' as string]: `${c.rot}deg`, ['--cs' as string]: String(c.scale), ['--cx' as string]: `${c.x}%`, ['--cy' as string]: `${c.y}%`,
  ['--pitch' as string]: `${c.pitch ?? 0}deg`, ['--pitchn' as string]: String(c.pitch ?? 0), ['--light' as string]: String(c.light ?? 1), ['--dof' as string]: String(c.dof ?? 0),
  ['--yaw' as string]: `${c.yaw ?? 0}deg`, ['--yawn' as string]: String(c.yaw ?? 0),
  // 초점: near면 배경이 흐리고(bg 1) far면 캐릭터가 흐리다(fg 1) — camera.css의 blur 계수
  ['--bgblur' as string]: (c.focus ?? 'near') === 'far' ? '0' : '1', ['--fgblur' as string]: (c.focus ?? 'near') === 'far' ? '1' : '0',
});
/** range의 채운 비율(--pct) */
const pctVar = (v: number, min: number, max: number): CSSProperties => ({ ['--pct' as string]: `${((v - min) / (max - min)) * 100}%` });

/* 드래그 중엔 매 pointermove마다 렌더된다 — 무대 SVG(수백 노드)와 캐릭터는 memo로 diff에서 뺀다 */
const Still = memo(function Still({ type }: { type: PlaceType }) { return <Scene type={type} className="scene--still" />; });
const Chara = memo(Character);
/** 자이로 버튼 글자 — 상태별 (useGyro) */
const GYRO_LABEL: Record<GyroState, string> = { off: '📱 폰 돌리기', asking: '허락 기다리는 중…', on: '📱 돌리는 중', denied: '자이로 허락 안 됨', none: '자이로 없음' };

export interface ShotStageProps {
  type: PlaceType;
  pose: Pose;
  crop: Crop;
  /** 동행 색 (있으면 오른쪽 옆에 손 흔드는 친구) */
  friendColor?: string;
  /** 말을 건 마주침 상대의 색 */
  metColor?: string;
  /** 못 걸어본 사람의 실루엣 색 */
  seenColor?: string;
  /** 썸네일: 캐릭터 루프도 멈춘다 (무대는 항상 scene--still) */
  still?: boolean;
  className?: string;
}

/**
 * 무대 한 장: 정지 Scene + 캐릭터(프레임 너비 84 %, 발이 78 % 높이) + 동행/마주침, 그 위에 사용자 크롭(% 단위).
 * 뷰파인더·필름 썸네일이 같은 컴포넌트를 쓰니 "찍은 그대로"가 보장된다 — 만화의 사용자 컷도 이걸 쓰면 같은 그림이 나온다.
 * 그림은 3D 무대(Stage3D, ADR-0014 개정)가 그린다: 같은 crop을 카메라 자세로 옮겨 층 4장과 인물 빌보드를 원근으로. three.js와 텍스처가
 * 준비되기 전이나 WebGL이 없으면 아래의 CSS 무대(.cam-shot)를 그대로 보여 준다 — 같은 값에서 같은 구도라 바뀌는 순간 튀지 않는다.
 */
export function ShotStage({ type, pose, crop, friendColor, metColor, seenColor, still, className = '' }: ShotStageProps) {
  const cssShot = (
    <div className="cam-shot">
      {/* 배경은 프레임보다 넓게(세로 2배, 무대 바탕은 ±390 더 그려져 있다 — scenes/index.tsx) — 밀고 돌려도 끝이 안 보인다 */}
      <div className="cam-bg"><Still type={type} /></div>
      {seenColor && <Chara className="cam-ghost" pose="idle" size={190} variant="friend" color={seenColor} paused={still} />}
      {friendColor && <Chara className="cam-friend" pose="wave" size={224} variant="friend" color={friendColor} paused={still} />}
      <Chara className="cam-me" pose={pose} size={300} paused={still} />
      {metColor && <Chara className="cam-met" pose="wave" size={190} variant="friend" color={metColor} paused={still} />}
    </div>
  );
  return (
    // 변수는 무대(.cam-stage)에 둔다: 밝기·톤은 무대가, 3D 캔버스 둘(배경·인물)과 CSS 무대가 blur를 물려받아 읽는다
    <div className={`cam-stage ${friendColor ? 'has-friend' : ''} ${metColor ? 'has-met' : ''} ${className}`} style={cropVars(crop)}>
      <Stage3D type={type} pose={pose} crop={crop} friendColor={friendColor} metColor={metColor} seenColor={seenColor} fallback={cssShot} />
    </div>
  );
}

export interface CameraOverlayProps {
  act: ScheduledActivity;
  /** 활동 진행률 0..1 — 지금 창(winAt)을 정한다 */
  progress: number;
  /** 촬영 시각(sim ms) — ActivityScreen과 같은 식으로 progress에서 되짚은 값 */
  nowMs: number;
  companions: Friend[];
  encounter?: PhaseEncounter;
  /** `?preview=active:…&camera=1` — 스토어를 건드리지 않는다 (dev/preview.ts 계약): 샷은 로컬 state에만 */
  preview?: boolean;
  onClose: () => void;
}

/**
 * 카메라 — 에이전트가 혼자라 못 찍는 사진을 사용자가 찍어 준다 (ADR-0004). 오버레이라 밑의 활동 화면을 파괴하지 않는다.
 * 지금 창만 셔터가 듣고(재촬영은 같은 창을 덮어쓴다: store.addShot), 지난 창은 잠겨 에이전트가 채우고(열화 컷), 미래 창은 비활성.
 * 마운트는 Home이 한다(active phase에서만) — 만화는 endAt에 한 번 만들어져 굳으니 그 뒤의 샷은 갈 곳이 없다.
 */
export function CameraOverlay({ act, progress, nowMs, companions, encounter, preview, onClose }: CameraOverlayProps) {
  const addShot = useWorld(s => s.addShot);
  const stored = useWorld(s => s.shots);
  const name = useWorld(s => s.memory.name);
  const [local, setLocal] = useState<UserShot[]>([]);
  const taken = shotsFor(preview ? local : stored, act.key);
  const now = winAt(progress);
  const count = Object.keys(taken).length;
  // 열 때 지금 창에 이미 찍은 게 있으면 그 프레이밍에서, 아니면 일부러 흐트러진 구도(messyStart)에서 시작한다
  const [crop, setCrop] = useState<Crop>(() => taken[now]?.crop ?? ((preview && cropParam()) || messyStart(act.key, now)));
  // 창이 넘어가면(활동이 진행돼 다음 장면) 그 창의 사진이나 새 흐트러진 구도에서 다시 시작한다
  const [seenWin, setSeenWin] = useState(now);
  if (seenWin !== now) { setSeenWin(now); setCrop(taken[now]?.crop ?? messyStart(act.key, now)); }
  const [flash, setFlash] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 톡 누른 자리의 초점 표시 — 잠깐 떴다 사라진다 */
  const [ring, setRing] = useState<{ x: number; y: number; n: number } | null>(null);
  useEffect(() => { if (!ring) return; const id = window.setTimeout(() => setRing(null), 800); return () => window.clearTimeout(id); }, [ring]);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; sx: number; sy: number; x0: number; y0: number; w: number; h: number; moved: boolean } | null>(null);
  // 자이로(ADR-0014): 폰을 돌린 만큼 방향·각도에 쓴다 — 슬라이더와 같은 crop이라 셔터·썸네일·만화는 아무것도 모른다
  const [canGyro] = useState(gyroAvailable);
  const gyro = useGyro(a => setCrop(c => (c.yaw === a.yaw && c.pitch === a.pitch ? c : { ...c, yaw: a.yaw, pitch: a.pitch })));
  const reset = () => { setCrop(taken[now]?.crop ?? messyStart(act.key, now)); gyro.rezero(); };

  const pose = poseFor(act.option);
  const friend = companions[0];
  const met = encounter?.talked ? encounter.agent : null;
  const seen = encounter && !encounter.talked;
  const stage = { type: act.place.type, pose, friendColor: friend?.color, metColor: met?.color, seenColor: seen ? GHOST : undefined };

  // ── 드래그 (pointer capture): 프레임 밖으로 나가도 놓을 때까지 따라온다 ──
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: crop.x, y0: crop.y, w: Math.max(1, r.width), h: Math.max(1, r.height), moved: false };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    // transform이 rotate → scale → translate 순(.cm-shot과 동일)이라 translate는 회전·확대 전 좌표다:
    // 화면 이동량을 기울기만큼 되돌리고 시야각으로 나눠야 손가락을 따라온다
    const a = (-crop.rot * Math.PI) / 180;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (!d.moved) return;   // 아직 톡 누르기일 수 있다 — 손가락이 흔들린 만큼은 무시
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / crop.scale;
    const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / crop.scale;
    const x = round1(clamp(d.x0 + (lx / d.w) * 100, -PAN_MAX, PAN_MAX));
    const y = round1(clamp(d.y0 + (ly / d.h) * 100, -PAN_MAX, PAN_MAX));
    setCrop(c => (c.x === x && c.y === y ? c : { ...c, x, y }));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    // 톡 누르기(안 끌었다) = 초점: 캐릭터를 눌렀으면 캐릭터가 선명하고 배경이 흐려지고, 배경을 눌렀으면 반대 —
    // 어디가 잘 나올지는 사용자가 정한다. 얼마나 흐릴지는 심도 슬라이더
    if (!d.moved) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const near = !!hit?.closest('.cam-me, .cam-friend, .cam-met');
      setCrop(c => ({ ...c, focus: near ? 'near' : 'far' }));
      const r = frameRef.current?.getBoundingClientRect();
      if (r) setRing({ x: e.clientX - r.left, y: e.clientY - r.top, n: (ring?.n ?? 0) + 1 });
    }
  };

  // ── 셔터: 지금 창에만. 같은 창을 다시 찍으면 뒤가 이긴다 ──
  const shoot = () => {
    const shot: UserShot = { actKey: act.key, win: now, at: nowMs, crop: { ...crop } };
    if (preview) setLocal(ss => [...ss.filter(s => s.win !== now), shot]);
    else addShot(shot);
    setFlash(n => n + 1);
    try { navigator.vibrate?.(24); } catch { /* 진동 없는 브라우저 */ }
  };
  const retake = !!taken[now];

  return (
    <div className="cam" role="dialog" aria-label="카메라">
      <header className="cam-hd">
        <div>
          <h3>📷 {act.place.name}</h3>
          <small>{hhmmIn(nowMs, act.tz)} · 지금은 '{WIN_LABEL[now]}' 장면</small>
        </div>
        <span className={`cam-count ${count >= 4 ? 'is-full' : ''}`} aria-label={`찍은 사진 ${count}장`}>{count}/4</span>
        <button type="button" className="cam-x" onClick={onClose} aria-label="닫기">✕</button>
      </header>

      <div ref={frameRef} className={`cam-frame ${dragging ? 'is-dragging' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="img" aria-label="뷰파인더 — 끌어서 자리를 잡는다">
        <ShotStage {...stage} crop={crop} />
        <span className="cam-osd num">{hhmmIn(nowMs, act.tz)}</span>
        <div className="cam-vf" aria-hidden="true"><i /><i /><i /><i /></div>
        <span className="cam-fchip" aria-live="polite">초점 · {(crop.focus ?? 'near') === 'far' ? '배경' : '캐릭터'}</span>
        {ring && <i key={ring.n} className="cam-focus" style={{ left: ring.x, top: ring.y }} aria-hidden="true" />}
        {flash > 0 && <div key={flash} className="cam-flash" aria-hidden="true" />}
        {flash > 0 && <b key={`s${flash}`} className="cam-snap" aria-hidden="true">찰칵!</b>}
      </div>
      <p className="cam-hint">
        <span>{gyro.state === 'on' ? '폰을 돌려서 각도 잡고, 톡 눌러 초점' : '끌어서 자리 잡고, 톡 눌러 초점 맞추고'}</span>
        <span className="cam-hint-btns">
          {canGyro && <Button tone="text" className={`cam-gyro is-${gyro.state}`} onClick={gyro.toggle} ariaLabel={gyro.state === 'on' ? '폰 돌리기 끄기' : '폰을 돌려서 각도 잡기'}>{GYRO_LABEL[gyro.state]}</Button>}
          <Button tone="text" onClick={reset}>처음으로</Button>
        </span>
      </p>

      <div className="cam-ctl">
        {/* 확대 · 각도(위/아래 앵글) · 방향(왼쪽/오른쪽에서, ADR-0014) · 기울임(더치 앵글) · 조도 · 심도(배경 흐림) — 여섯 개 다 컷에 그대로 실린다 (ShotStage가 같은 변수를 읽는다) */}
        <div className="cam-sliders">
          <label className="cam-sl">
            <span>확대</span>
            <input className="cam-range" type="range" min={SCALE_MIN} max={SCALE_MAX} step={0.05} value={crop.scale} style={pctVar(crop.scale, SCALE_MIN, SCALE_MAX)} onChange={e => setCrop(c => ({ ...c, scale: Number(e.target.value) }))} aria-label="확대" />
            <output className="num">{crop.scale.toFixed(2)}×</output>
          </label>
          <label className="cam-sl">
            <span>각도</span>
            <input className="cam-range" type="range" min={-PITCH_MAX} max={PITCH_MAX} step={1} value={crop.pitch ?? 0} style={pctVar(crop.pitch ?? 0, -PITCH_MAX, PITCH_MAX)} onChange={e => setCrop(c => ({ ...c, pitch: Number(e.target.value) }))} aria-label="각도 (위에서 · 아래에서)" />
            <output className="num">{(crop.pitch ?? 0) > 0 ? '위 ' : (crop.pitch ?? 0) < 0 ? '아래 ' : ''}{Math.abs(crop.pitch ?? 0)}°</output>
          </label>
          <label className="cam-sl">
            <span>방향</span>
            <input className="cam-range" type="range" min={-YAW_MAX} max={YAW_MAX} step={0.5} value={crop.yaw ?? 0} style={pctVar(crop.yaw ?? 0, -YAW_MAX, YAW_MAX)} onChange={e => setCrop(c => ({ ...c, yaw: Number(e.target.value) }))} aria-label="방향 (왼쪽에서 · 오른쪽에서)" />
            <output className="num">{(crop.yaw ?? 0) > 0 ? '→ ' : (crop.yaw ?? 0) < 0 ? '← ' : ''}{Math.abs(crop.yaw ?? 0)}°</output>
          </label>
          <label className="cam-sl">
            <span>기울임</span>
            <input className="cam-range" type="range" min={-ROT_MAX} max={ROT_MAX} step={0.5} value={crop.rot} style={pctVar(crop.rot, -ROT_MAX, ROT_MAX)} onChange={e => setCrop(c => ({ ...c, rot: Number(e.target.value) }))} aria-label="기울임" />
            <output className="num">{crop.rot > 0 ? '+' : ''}{crop.rot}°</output>
          </label>
          <label className="cam-sl">
            <span>조도</span>
            <input className="cam-range cam-range--light" type="range" min={LIGHT_MIN} max={LIGHT_MAX} step={0.05} value={crop.light ?? 1} style={pctVar(crop.light ?? 1, LIGHT_MIN, LIGHT_MAX)} onChange={e => setCrop(c => ({ ...c, light: Number(e.target.value) }))} aria-label="조도" />
            <output className="num">{Math.round((crop.light ?? 1) * 100)}%</output>
          </label>
          <label className="cam-sl">
            <span>심도</span>
            <input className="cam-range" type="range" min={0} max={1} step={0.05} value={crop.dof ?? 0} style={pctVar(crop.dof ?? 0, 0, 1)} onChange={e => setCrop(c => ({ ...c, dof: Number(e.target.value) }))} aria-label="심도 (배경 흐림)" />
            <output className="num">{(crop.dof ?? 0) === 0 ? '다 선명' : `흐림 ${Math.round((crop.dof ?? 0) * 100)}%`}</output>
          </label>
        </div>
        <div className="cam-shutter-wrap">
          <button type="button" className={`cam-shutter ${retake ? 'is-retake' : ''}`} onClick={shoot} aria-label={retake ? '다시 찍기' : '찍기'} />
          <span className="cam-shutter-lbl">{retake ? '다시 찍기' : '찍기'}</span>
        </div>
      </div>

      {/* 필름 칸 4개: 활동 시간 4등분 = 만화 4컷. 지난 창은 잠겨 {name}가 채우고, 미래 창은 아직 */}
      <ol className="cam-film" aria-label="장면 4개">
        {WIN_LABEL.map((label, i) => {
          const w = i as ShotWin;
          const st = winState(w, now);
          const shot = taken[w];
          // 지금 창에 아직 안 찍었으면 뷰파인더의 프레이밍이 그대로 미리 보인다. 지난 창은 "{name}가 찍음"이니 빈 상자 대신
          // 기본 프레이밍의 정지 무대를 잠긴 사진처럼 (camera.css .is-past가 회색으로 죽인다) — 실제 열화 컷은 만화에서 나온다
          const c = shot?.crop ?? (st === 'now' ? crop : st === 'past' ? CROP0 : null);
          const by = st === 'future' ? '아직' : shot ? '내가 찍음' : st === 'past' ? `${name}가 찍음` : '찍을 차례';
          return (
            <li key={w} className={`cam-cell is-${st} ${shot ? 'has-shot' : ''}`} aria-label={`${label} — ${by}`}>
              <div className="cam-thumb">
                {c ? <ShotStage {...stage} crop={c} still /> : <span className="cam-empty" aria-hidden="true">{st === 'future' ? '···' : '?'}</span>}
                {st === 'past' && <span className="cam-lock" aria-hidden="true">🔒</span>}
                {st === 'now' && (shot ? <span className="cam-ok" aria-hidden="true">✓</span> : <span className="cam-here" aria-hidden="true">지금!</span>)}
              </div>
              <span className="cam-lbl">{label}</span>
              <small className="cam-by">{by}</small>
            </li>
          );
        })}
      </ol>

      <Button tone="coral" className="cam-done" onClick={onClose}>다 찍었어</Button>
    </div>
  );
}
