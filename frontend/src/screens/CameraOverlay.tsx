import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorld } from '../sim/store';
import type { Look, PlaceType, ScheduledActivity, ShotCrop, ShotFigure, ShotPose, UserShot } from '../sim/types';
import { DEFAULT_LOOK } from '../sim/types';
import { agentById, castAt, hairStyleOf, type Agent, type CastMet } from '../sim/agents';
import { MAX_SHOTS, shotsFor } from '../sim/shots';
import { DEFAULT_FRIEND, DEFAULT_ME, DEFAULT_ME_WITH_FRIEND, backdropById, backdropDataUrl, type Backdrop } from '../sim/backdrops';
import { hhmmIn } from '../sim/tz';
import { Character, type Pose } from '../character';
import { Scene, sceneTypeFor } from '../scenes';
import { Button } from '../ui';
import { poseFor, presentLook, type PresentFigure } from './util';
import { bakeShot, newShotId, type BakeInput } from '../photo/bake';
import { BD_PAN_MAX } from '../photo/geometry';
import { putLocal } from '../sim/media';
import { requestShotGen } from '../sim/shotgen';
import { demoShotFor } from '../dev/scenario';
import { PhotoImg } from '../photo/PhotoImg';
import './camera.css';

type Crop = ShotCrop;
const CROP0: Crop = { scale: 1, x: 0, y: 0, rot: 0 };
/** 배경 이동·확대 범위: x/y ±35 %(뷰포트 자기 크기 대비), 확대 1.0~2.2 — types.ts ShotCrop 주석 그대로 */
const PAN_MAX = 35;
const SCALE_MIN = 1;
const SCALE_MAX = 2.2;
/** 인물 크기(프레임 너비 대비 상자 폭) */
const FIG_MIN = 0.25;
const FIG_MAX = 1.2;
/** 카메라가 고르는 자세 (ShotPose) — 칩 순서 */
const POSES: { pose: ShotPose; label: string }[] = [
  { pose: 'idle', label: '서기' }, { pose: 'sit', label: '앉기' }, { pose: 'wave', label: '인사' }, { pose: 'happy', label: '만세' },
  { pose: 'eat', label: '먹기' }, { pose: 'think', label: '생각' }, { pose: 'read', label: '읽기' }, { pose: 'draw', label: '그리기' }, { pose: 'walk', label: '걷기' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
/** `.cam-shot`의 CSS 변수 — 만화 `.cm-shot`과 같은 이름(--rot/--cs/--cx/--cy), 단위는 %. 옛 컷의 각도·조도·심도 변수도 그대로 읽힌다 */
const cropVars = (c: Crop): CSSProperties => ({
  ['--rot' as string]: `${c.rot}deg`, ['--cs' as string]: String(c.scale), ['--cx' as string]: `${c.x}%`, ['--cy' as string]: `${c.y}%`,
  ['--pitch' as string]: `${c.pitch ?? 0}deg`, ['--pitchn' as string]: String(c.pitch ?? 0), ['--light' as string]: String(c.light ?? 1), ['--dof' as string]: String(c.dof ?? 0),
  ['--bgblur' as string]: (c.focus ?? 'near') === 'far' ? '0' : '1', ['--fgblur' as string]: (c.focus ?? 'near') === 'far' ? '1' : '0',
});
/** 인물 자리(ShotFigure) → 인라인 자리: 발(상자의 91 %)이 (x %, y %)에 닿고 폭은 scale × 프레임 — photo/geometry.ts figureBox와 같은 식 */
const figStyle = (f: ShotFigure, z: number): CSSProperties => ({ left: `${f.x}%`, top: `${f.y}%`, bottom: 'auto', width: `${f.scale * 100}%`, transform: 'translate(-50%, -91%)', zIndex: z });
/** range의 채운 비율(--pct) */
const pctVar = (v: number, min: number, max: number): CSSProperties => ({ ['--pct' as string]: `${((v - min) / (max - min)) * 100}%` });

/* 드래그 중엔 매 pointermove마다 렌더된다 — 무대 SVG(수백 노드)와 캐릭터는 memo로 diff에서 뺀다 */
const Still = memo(function Still({ type }: { type: PlaceType }) { return <Scene type={type} className="scene--still" />; });
const Chara = memo(Character);

export interface ShotStageProps {
  type: PlaceType;
  pose: Pose;
  crop: Crop;
  /** AI 배경 (ADR-0029) — 있으면 SVG 무대 대신 이 그림 */
  backdrop?: Backdrop | null;
  /** 내 자리·크기·자세 — 없으면 camera.css의 기본 자리(가운데)와 `pose` */
  me?: ShotFigure;
  /** 동행 색 (있으면 동행이 같이 선다) */
  friendColor?: string;
  /** 동행의 자리·자세 — 없으면 오른쪽 옆에서 손 흔들기 */
  friendPos?: ShotFigure;
  /** 말을 건 마주침 상대의 색 (옛 컷 — `mets`가 없을 때만) */
  metColor?: string;
  /** 말 튼 사람들 (castAt의 met·metAlso, ADR-0031): 첫째는 오른쪽 앞, 둘째는 왼쪽 뒤. 최대 둘. 카메라도 같이 찍는다 */
  mets?: MetFigure[];
  /** 같은 공간에 있던 사람들 (옛 컷, FRIENDS_SPEC §6): 뒷모습·작게 */
  present?: PresentFigure[];
  /** 썸네일: 캐릭터 루프도 멈춘다 (무대는 항상 scene--still) */
  still?: boolean;
  className?: string;
}

/**
 * 무대 한 장: 배경(AI 그림 또는 정지 Scene) + 나 + 동행(+ 옛 컷의 마주침·배경 인물), 그 위에 배경 이동·확대(% 단위).
 * 뷰파인더·필름 썸네일·앨범 컷이 같은 컴포넌트를 쓰니 "찍은 그대로"가 보장된다. 굽기(photo/bake)는 같은 숫자를 svg로 옮겨 적는다.
 */
export function ShotStage({ type, pose, crop, backdrop, me, friendColor, friendPos, metColor, mets, present, still, className = '' }: ShotStageProps) {
  // 동행이 나보다 앞(발이 아래)이면 위에 그린다
  const friendFront = !!friendPos && !!me && friendPos.y > me.y;
  const metList = (mets ?? (metColor ? [{ color: metColor }] : [])).slice(0, METS_MAX);
  return (
    // 변수는 무대(.cam-stage)에 둔다: transform은 그 안의 .cam-shot이, blur·조도는 옛 컷 변수로 물려받는다
    <div className={`cam-stage ${friendColor ? 'has-friend' : ''} ${metList.length ? 'has-met' : ''} ${metList.length > 1 ? 'has-met2' : ''} ${backdrop ? 'has-bd' : ''} ${className}`} style={cropVars(crop)}>
      <div className="cam-shot">
        {/* 배경: AI 그림은 프레임보다 사방 12 % 큰 상자에 cover(camera.css .cam-bg img, geometry BD_OVER) — ±12 % 밀어도 끝이 안 보인다. SVG 무대는 옛 방식(가로 3장·세로 2배, 양옆 거울) */}
        <div className="cam-bg">{backdrop ? <img src={backdrop.url} alt="" draggable={false} /> : <><Still type={type} /><Still type={type} /><Still type={type} /></>}</div>
        {present?.slice(0, 2).map((p, i) => <Chara key={i} className={`cam-present cam-present-${i}`} pose="idle" size={120} variant="friend" color={p.color} look={presentLook(p.hairStyle)} back glance={p.glance} paused={still} />)}
        {/* 둘째 말 튼 사람은 왼쪽 뒤(나보다 뒤) — camera.css .cam-met-1, 굽기는 geometry castLayout.met2 */}
        {metList[1] && <Chara className="cam-met cam-met-1" pose="wave" size={170} variant="friend" color={metList[1].color} look={metList[1].look} paused={still} />}
        {friendColor && <Chara className="cam-friend" style={friendPos ? figStyle(friendPos, friendFront ? 4 : 2) : undefined} pose={friendPos?.pose ?? 'wave'} size={224} variant="friend" color={friendColor} paused={still} />}
        <Chara className="cam-me" style={me ? figStyle(me, 3) : undefined} pose={me?.pose ?? pose} size={300} paused={still} />
        {metList[0] && <Chara className="cam-met cam-met-0" pose="wave" size={190} variant="friend" color={metList[0].color} look={metList[0].look} paused={still} />}
      </div>
    </div>
  );
}

/** 샷 하나를 무대로 (필름 썸네일·앨범 컷이 같은 식으로 되살린다). 말 튼 사람들은 샷의 `mets`(agent id)에서 되찾는다 */
export function stageOfShot(shot: Pick<UserShot, 'crop' | 'backdrop' | 'me' | 'friend' | 'mets'>, type: PlaceType, pose: Pose, friendColor?: string): Omit<ShotStageProps, 'still' | 'className'> {
  return { type, pose, crop: shot.crop, backdrop: backdropById(shot.backdrop), me: shot.me, friendColor, friendPos: shot.friend, mets: metsOfIds(shot.mets) };
}

/** 말 튼 사람 하나 — 무대에 그릴 색·겉모습 */
export interface MetFigure { color: string; look?: Look }
/** 무대에 서는 말 튼 사람은 둘까지 (루이·클로에) — geometry castLayout의 met·met2 */
export const METS_MAX = 2;
/** castAt의 met·metAlso → 무대 인물 (겉모습은 방과 같은 식: 머리 모양 + 피부·머리색) */
export const metsOfCast = (c: { met?: CastMet; metAlso?: CastMet[] }): MetFigure[] =>
  [c.met, ...(c.metAlso ?? [])].filter((m): m is CastMet => !!m).slice(0, METS_MAX).map(m => ({ color: m.color, look: presentLook(m.hairStyle, m.look) }));
/** 샷에 저장한 agent id들 → 무대 인물 (에이전트 풀에서 되찾는다 — 없어진 사람은 뺀다) */
export const metsOfIds = (ids?: string[]): MetFigure[] | undefined => {
  if (!ids?.length) return undefined;
  const out = ids.map(id => agentById(id)).filter((a): a is Agent => !!a).slice(0, METS_MAX).map(a => ({ color: a.color, look: presentLook(hairStyleOf(a), a.look) }));
  return out.length ? out : undefined;
};

export interface CameraOverlayProps {
  act: ScheduledActivity;
  /** 촬영 시각(sim ms) — ActivityScreen과 같은 식으로 progress에서 되짚은 값 */
  nowMs: number;
  /** 어느 배경으로 열렸나 (트리거 존 버튼이 정한다, ADR-0029). null이면 SVG 무대 */
  backdropId?: string | null;
  /** `?preview=active:…&camera=1` — 스토어를 건드리지 않는다 (dev/preview.ts 계약): 샷은 로컬 state에만, 굽지도 올리지도 않는다 */
  preview?: boolean;
  onClose: () => void;
}

type Sel = 'me' | 'friend';

/**
 * 카메라 (ADR-0029) — 트리거 존 버튼이 배경을 정해 열고, 여기서는 **자리·크기·자세**만 만진다. 활동당 아무 때나 최대 3장(MAX_SHOTS);
 * 꽉 차면 셔터가 잠기고 한 장을 지워야 다시 찍는다. 동행(`act.companions`)은 항상 같이 찍힌다. 찍은 컷은 단순 합성본으로 바로 굽고,
 * 서버 화풍 생성(`gen`)이 오면 앨범이 그 픽셀로 바꾼다. 오버레이라 밑의 활동 화면을 파괴하지 않는다. 마운트는 Home이 한다(active phase에서만).
 */
export function CameraOverlay({ act, nowMs, backdropId, preview, onClose }: CameraOverlayProps) {
  const addShot = useWorld(s => s.addShot);
  const removeShot = useWorld(s => s.removeShot);
  const dropShotId = useWorld(s => s.dropShotId);
  const stored = useWorld(s => s.shots);
  const memory = useWorld(s => s.memory);
  const look = memory.look;
  const [local, setLocal] = useState<UserShot[]>([]);
  const taken = shotsFor(preview ? local : stored, act.key);
  const count = taken.length;
  const full = count >= MAX_SHOTS;
  const backdrop = backdropById(backdropId) ?? null;
  const friend = memory.friends.find(f => act.companions.includes(f.id));
  // 말 튼 사람들(루이·클로에)도 같이 찍힌다 (ADR-0031) — 방(RoomStage)과 같은 castAt, 이 시각 기준. 자리는 고정(끌지 않는다)
  const cast = castAt(act, nowMs, memory);
  const mets = metsOfCast(cast);
  const metIds = [cast.met, ...(cast.metAlso ?? [])].filter((m): m is CastMet => !!m).slice(0, METS_MAX).map(m => m.agent.id);
  const basePose = poseFor(act.option);

  // 시작 자리: 배경이 정한 자리(앉는 자리면 앉아서), 없으면 무대의 기본 자리 — 동행이 있으면 둘이 나눠 선다
  const [me, setMe] = useState<ShotFigure>(() => backdrop ? { ...backdrop.me, pose: backdrop.sit ? 'sit' : (basePose as ShotPose) } : { ...(friend ? DEFAULT_ME_WITH_FRIEND : DEFAULT_ME), pose: basePose as ShotPose });
  const [fr, setFr] = useState<ShotFigure | null>(() => friend ? { ...(backdrop?.friend ?? DEFAULT_FRIEND), pose: backdrop?.sit ? 'sit' : 'wave' } : null);
  const [crop, setCrop] = useState<Crop>(CROP0);
  const [sel, setSel] = useState<Sel>('me');
  const [flash, setFlash] = useState(0);
  const [dragging, setDragging] = useState<Sel | 'bg' | null>(null);
  /** 방금 찍은 컷 — 필름 칸에서 폴라로이드처럼 현상된다 */
  const [fresh, setFresh] = useState<{ id: string; n: number } | null>(null);
  const [shake, setShake] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; what: Sel | 'bg'; sx: number; sy: number; x0: number; y0: number; w: number; h: number } | null>(null);
  const shakeRef = useRef<{ id: number; x: number; n: number } | null>(null);

  const figOf = (s: Sel) => (s === 'me' ? me : fr);
  const setFig = (s: Sel, patch: Partial<ShotFigure>) => (s === 'me' ? setMe(f => ({ ...f, ...patch })) : setFr(f => (f ? { ...f, ...patch } : f)));

  // ── 드래그 (pointer capture): 캐릭터를 잡으면 캐릭터가, 배경을 잡으면 배경이 움직인다 ──
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hit = (e.target as HTMLElement).closest?.('.cam-me, .cam-friend');
    const what: Sel | 'bg' = hit?.classList.contains('cam-me') ? 'me' : hit?.classList.contains('cam-friend') && fr ? 'friend' : 'bg';
    const fig = what === 'bg' ? null : figOf(what);
    dragRef.current = { id: e.pointerId, what, sx: e.clientX, sy: e.clientY, x0: fig ? fig.x : crop.x, y0: fig ? fig.y : crop.y, w: Math.max(1, r.width), h: Math.max(1, r.height) };
    el.setPointerCapture(e.pointerId);
    setDragging(what);
    if (what !== 'bg') setSel(what);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.what === 'bg') {
      // transform이 scale → translate 순이라 translate는 확대 전 좌표다: 화면 이동량을 시야각으로 나눠야 손가락을 따라온다
      // AI 배경은 상자 여유(BD_OVER)만큼만 — SVG 무대는 옛 한도
      const lim = backdrop ? BD_PAN_MAX : PAN_MAX;
      const x = round1(clamp(d.x0 + (dx / crop.scale / d.w) * 100, -lim, lim));
      const y = round1(clamp(d.y0 + (dy / crop.scale / d.h) * 100, -lim, lim));
      setCrop(c => (c.x === x && c.y === y ? c : { ...c, x, y }));
    } else {
      // 인물은 프레임 % 로 — 확대된 배경 위에서도 손가락 아래에 있어야 하니 crop.scale로 나누지 않는다 (인물은 .cam-shot 안이라 같이 확대되지만 자리는 %)
      const x = round1(clamp(d.x0 + (dx / d.w) * 100, 4, 96));
      const y = round1(clamp(d.y0 + (dy / d.h) * 100, 20, 100));
      setFig(d.what, { x, y });
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(null);
  };

  // ── 셔터: 최대 3장. 찍는 순간 id를 정하고 샷을 저장, 굽기는 뒤에서 (ADR-0024 결정 1) ──
  const shoot = () => {
    if (full) return;
    const shot: UserShot = { actKey: act.key, at: nowMs, crop: { ...crop }, me: { ...me }, ...(fr ? { friend: { ...fr } } : {}), ...(metIds.length ? { mets: metIds } : {}), ...(backdrop ? { backdrop: backdrop.id } : {}), gen: 'plain' };
    setFlash(n => n + 1);
    try { navigator.vibrate?.(24); } catch { /* 진동 없는 브라우저 */ }
    if (preview) {
      const id = newShotId();
      setLocal(ss => [...ss, { ...shot, shotId: id }]);
      setFresh({ id, n: (fresh?.n ?? 0) + 1 });
      return;
    }
    const id = newShotId();
    addShot({ ...shot, shotId: id });
    setFresh({ id, n: (fresh?.n ?? 0) + 1 });
    // 뷰파인더(ShotStage)에 보이던 그대로: 배경·자리·자세·내 겉모습·동행·말 튼 사람들. 60 KB를 넘거나(BakeOversizeError) 못 구우면 id를 떼어 옛 경로(다시 그리기)로
    const input: BakeInput = {
      type: sceneTypeFor(act.place.type), pose: basePose, crop: { ...crop }, look: look ?? DEFAULT_LOOK, me: { ...me },
      ...(friend && fr ? { friend: { color: friend.color }, friendPos: { ...fr } } : {}),
      ...(mets[0] ? { met: { color: mets[0].color, look: mets[0].look } } : {}),
      ...(mets[1] ? { met2: { color: mets[1].color, look: mets[1].look } } : {}),
    };
    const withBackdrop = backdrop ? backdropDataUrl(backdrop).then(url => ({ ...input, backdrop: url })) : Promise.resolve(input);
    void withBackdrop.then(async i => {
      const meta = { place: act.place.name, spot: backdrop?.spot, sit: backdrop?.sit, mePose: me.pose, friendPose: fr?.pose, friendColor: friend?.color, backdrop: !!backdrop, backdropId: backdrop?.id };
      try {
        const b = await bakeShot(i);
        await putLocal(id, b.blob, 'shot');
      } catch (e) {
        // 시연 브랜치: 미리 만든 컷이 있으면 굽기가 실패해도(Safari는 WebP가 없어 그림 배경 PNG가 60 KB를 넘는다) 그 컷으로 간다
        if (!demoShotFor(backdrop?.id)) throw e;
        console.warn(`camera: 굽기 실패 — 시연 컷으로 (${id})`, e);
      }
      // 서버 화풍 생성 (ADR-0029 결정 6): 그동안 필름 칸은 현상 중, 오면 그 픽셀로 바뀐다. 실패·오프라인이면 단순 합성본 그대로
      void requestShotGen(id, i, meta);
    }).catch((e: unknown) => {
      console.warn(`camera: 굽기 실패 — 옛 경로로 (${id})`, e);
      dropShotId(id);
    });
  };
  const remove = (shotId: string) => {
    if (preview) setLocal(ss => ss.filter(s => s.shotId !== shotId));
    else removeShot(shotId);
    if (fresh?.id === shotId) setFresh(null);
  };

  // ── 폴라로이드 흔들기: 현상 중인 칸을 문지르면 흔들리고(진동) 현상이 조금 빨라진다 — 서버 시간과 무관한 손맛 ──
  const onShakeDown = (e: ReactPointerEvent<HTMLLIElement>) => { shakeRef.current = { id: e.pointerId, x: e.clientX, n: 0 }; };
  const onShakeMove = (e: ReactPointerEvent<HTMLLIElement>) => {
    const s = shakeRef.current;
    if (!s || s.id !== e.pointerId) return;
    if (Math.abs(e.clientX - s.x) > 14) { s.x = e.clientX; s.n++; setShake(n => n + 1); try { navigator.vibrate?.(8); } catch { /* */ } }
  };
  const onShakeUp = () => { shakeRef.current = null; };
  useEffect(() => { if (!fresh) return; const id = window.setTimeout(() => setShake(0), 400); return () => window.clearTimeout(id); }, [shake, fresh]);

  const selFig = figOf(sel) ?? me;
  const stage: ShotStageProps = { type: act.place.type, pose: basePose, crop, backdrop, me, friendColor: friend?.color, friendPos: fr ?? undefined, ...(mets.length ? { mets } : {}) };
  const where = backdrop ? `${backdrop.spot}에서` : act.place.area;

  return (
    <div className="cam" role="dialog" aria-label="카메라">
      <header className="cam-hd">
        <div>
          <h3>📷 {act.place.name}</h3>
          <small>{where} · {hhmmIn(nowMs, act.tz)}</small>
        </div>
        <span className={`cam-count ${full ? 'is-full' : ''}`} aria-label={`찍은 사진 ${count}장`}>{count}/{MAX_SHOTS}</span>
        <button type="button" className="cam-x" onClick={onClose} aria-label="닫기">✕</button>
      </header>

      <div ref={frameRef} className={`cam-frame ${dragging ? `is-dragging is-drag-${dragging}` : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="img" aria-label="뷰파인더 — 캐릭터를 끌어 자리를 잡는다">
        <ShotStage {...stage} />
        <span className="cam-osd num">{hhmmIn(nowMs, act.tz)}</span>
        <div className="cam-vf" aria-hidden="true"><i /><i /><i /><i /></div>
        {fr && <span className="cam-fchip" aria-live="polite">{sel === 'me' ? '나' : '친구'}</span>}
        {flash > 0 && <div key={flash} className="cam-flash" aria-hidden="true" />}
        {flash > 0 && <b key={`s${flash}`} className="cam-snap" aria-hidden="true">찰칵!</b>}
      </div>
      <p className="cam-hint">
        <span>캐릭터를 끌어 자리 잡고, 배경을 끌어 옮기고</span>
        <Button tone="text" onClick={() => { setCrop(CROP0); setMe(backdrop ? { ...backdrop.me, pose: backdrop.sit ? 'sit' : (basePose as ShotPose) } : { ...(friend ? DEFAULT_ME_WITH_FRIEND : DEFAULT_ME), pose: basePose as ShotPose }); if (friend) setFr({ ...(backdrop?.friend ?? DEFAULT_FRIEND), pose: backdrop?.sit ? 'sit' : 'wave' }); }}>처음으로</Button>
      </p>

      <div className="cam-ctl">
        <div className="cam-sliders">
          {/* 자세 칩: 고른 인물(나 / 친구)의 자세 */}
          <div className="cam-poses" role="group" aria-label="자세">
            {POSES.map(p => (
              <button key={p.pose} type="button" className={`cam-pose ${selFig.pose === p.pose ? 'is-on' : ''}`} aria-pressed={selFig.pose === p.pose} onClick={() => setFig(sel, { pose: p.pose })}>{p.label}</button>
            ))}
          </div>
          <label className="cam-sl">
            <span>크기</span>
            <input className="cam-range" type="range" min={FIG_MIN} max={FIG_MAX} step={0.01} value={selFig.scale} style={pctVar(selFig.scale, FIG_MIN, FIG_MAX)} onChange={e => setFig(sel, { scale: Number(e.target.value) })} aria-label="캐릭터 크기" />
            <output className="num">{Math.round(selFig.scale * 100)}%</output>
          </label>
          <label className="cam-sl">
            <span>배경</span>
            <input className="cam-range" type="range" min={SCALE_MIN} max={SCALE_MAX} step={0.05} value={crop.scale} style={pctVar(crop.scale, SCALE_MIN, SCALE_MAX)} onChange={e => setCrop(c => ({ ...c, scale: Number(e.target.value) }))} aria-label="배경 확대" />
            <output className="num">{crop.scale.toFixed(2)}×</output>
          </label>
        </div>
        <div className="cam-shutter-wrap">
          <button type="button" className="cam-shutter" onClick={shoot} disabled={full} aria-label={full ? '다 찍었다 — 한 장 지우면 다시' : '찍기'} />
          <span className="cam-shutter-lbl">{full ? '꽉 찼어' : '찍기'}</span>
        </div>
      </div>

      {/* 필름 칸 3개: 찍은 순서대로. 방금 찍은 칸은 폴라로이드처럼 현상되고(문지르면 빨라진다), 칸마다 ✕로 지운다 */}
      <ol className="cam-film" aria-label={`사진 ${MAX_SHOTS}장`}>
        {Array.from({ length: MAX_SHOTS }, (_, i) => {
          const shot = taken[i];
          const isFresh = !!shot?.shotId && fresh?.id === shot.shotId;
          // 서버 생성(gen): pending이면 현상이 안 끝나고 계속 흔들리는 뿌연 상태, done이면 생성된 픽셀(PhotoImg)이 떠오른다
          const gen = shot?.gen;
          return (
            <li key={shot?.shotId ?? `empty-${i}`} className={`cam-cell ${shot ? 'has-shot' : 'is-empty'} ${gen === 'pending' ? 'is-pending' : gen === 'done' ? 'is-done' : gen === 'plain' && isFresh ? 'is-plain' : ''} ${(isFresh || gen === 'pending') && shake ? 'is-shake' : ''}`}
              onPointerDown={isFresh || gen === 'pending' ? onShakeDown : undefined} onPointerMove={isFresh || gen === 'pending' ? onShakeMove : undefined} onPointerUp={onShakeUp} onPointerCancel={onShakeUp}
              aria-label={shot ? `${i + 1}번째 사진` : '빈 칸'}>
              <div className="cam-thumb">
                {shot
                  ? (gen === 'done' && shot.shotId
                    ? <PhotoImg key={shot.shotId} shotId={shot.shotId} className="cam-photo" alt=""><ShotStage {...stageOfShot(shot, act.place.type, basePose, friend?.color)} still /></PhotoImg>
                    : <ShotStage {...stageOfShot(shot, act.place.type, basePose, friend?.color)} still />)
                  : <span className="cam-empty" aria-hidden="true">{i + 1}</span>}
                {shot?.shotId && <button type="button" className="cam-del" aria-label="이 사진 지우기" onClick={() => remove(shot.shotId!)}>✕</button>}
              </div>
              {/* plain = 서버 생성이 없었다(오프라인·로그인 안 함·실패) — 단순 합성본이 그대로 사진 */}
              <small className="cam-by">{shot ? `${hhmmIn(shot.at, act.tz)}${gen === 'pending' ? ' · 현상 중' : gen === 'plain' ? ' · 합성만' : gen === 'done' ? ' · 생성됨' : ''}` : '아직'}</small>
            </li>
          );
        })}
      </ol>

      <Button tone="coral" className="cam-done" onClick={onClose}>다 찍었어</Button>
    </div>
  );
}
