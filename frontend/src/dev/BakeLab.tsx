// ─── 굽기 실험실 (ADR-0024, ?lab=bake) ────────────────────────────────────────────
// 프리셋마다 왼쪽은 라이브 무대(ShotStage still — 카메라·필름·만화가 쓰는 바로 그 컴포넌트), 오른쪽은 구운 픽셀(<img>)을 같은 크기로.
// 둘이 같아 보여야 "찍은 그대로"다. QA: window.__bake = { bakeSvg, bakeShot, presets }.
import { useEffect, useState } from 'react';
import { OwnerLookContext } from '../character';
import { DEFAULT_LOOK, type Look, type PlaceType } from '../sim/types';
import { ShotStage } from '../screens/CameraOverlay';
import { BakeOversizeError, bakeShot, bakeSvg, type BakeInput, type BakedShot } from '../photo/bake';
import { presentLook } from '../screens/util';

const CSS = `
.blab{box-sizing:border-box;width:100%;height:100%;overflow:auto;background:var(--paper);color:var(--ink);padding:16px 14px 40px;font-family:var(--body)}
.blab h1{font-family:var(--display);font-size:24px;margin:0 0 2px}
.blab .sub{font-family:var(--mono);font-size:11px;color:var(--ink-2);letter-spacing:.06em;margin-bottom:10px}
.blab .bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.blab .tg{min-height:40px;padding:0 14px;border:2px solid var(--ink);border-radius:999px;background:var(--card);font-family:var(--display);font-size:14px;box-shadow:3px 3px 0 var(--ink)}
.blab .tg.on{background:var(--sun)}
.blab .tg:disabled{opacity:.5}
.blab .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;background:var(--card);border:2px solid var(--ink);border-radius:16px;box-shadow:3px 3px 0 var(--ink);padding:8px}
.blab .row h3{grid-column:1/-1;font-family:var(--display);font-weight:400;font-size:15px;margin:0;display:flex;justify-content:space-between;align-items:center;gap:8px}
.blab .row h3 small{font-family:var(--mono);font-size:10px;color:var(--ink-2);font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blab .pane{position:relative;aspect-ratio:1/1.08;border:2px solid var(--ink);border-radius:10px;overflow:hidden;background:var(--paper-2)}
.blab .pane img{display:block;width:100%;height:100%}
.blab .pane .tag{position:absolute;top:4px;left:4px;z-index:9;font-family:var(--mono);font-size:9px;background:var(--ink);color:var(--paper);border-radius:4px;padding:1px 5px}
.blab .stat{grid-column:1/-1;font-family:var(--mono);font-size:10px;color:var(--ink-2);white-space:pre-wrap;word-break:break-all}
`;

export interface BakePreset { id: string; label: string; input: BakeInput }

const LOOK_B: Look = { skin: 'tan', hairColor: 'blond', hairStyle: 'long', glasses: 'round', beard: 'none', top: 'sky' };
const LOOK_C: Look = { skin: 'brown', hairColor: 'black', hairStyle: 'curly', glasses: 'none', beard: 'full', top: 'night' };

/** window.__bake.presets 로도 나간다 (CDP QA) */
const presets: BakePreset[] = [
  { id: 'cafe-plain', label: '카페 · 기본 구도', input: { type: 'cafe', pose: 'idle', look: DEFAULT_LOOK, crop: { scale: 1, x: 0, y: 0, rot: 0 } } },
  { id: 'cafe-read', label: '카페 · 읽기 · 확대·기울임', input: { type: 'cafe', pose: 'read', look: DEFAULT_LOOK, crop: { scale: 1.4, x: -12, y: 8, rot: -6, pitch: 0, light: 1, dof: 0, focus: 'near' } } },
  { id: 'park-happy', label: '공원 · 기쁨 · 심도(배경 흐림)', input: { type: 'park', pose: 'happy', look: LOOK_B, crop: { scale: 1.2, x: 6, y: -4, rot: 4, pitch: 0, light: 1, dof: 0.8, focus: 'near' } } },
  { id: 'river-sit', label: '강변 · 앉기 · 어둡게 · 각도 위', input: { type: 'river', pose: 'sit', look: LOOK_C, crop: { scale: 1.1, x: 0, y: 10, rot: 0, pitch: 12, light: 0.65, dof: 0.3, focus: 'near' } } },
  { id: 'home-eat', label: '집 · 먹기 · 밝게 · 각도 아래', input: { type: 'home', pose: 'eat', look: DEFAULT_LOOK, crop: { scale: 1.6, x: 18, y: -14, rot: 8, pitch: -14, light: 1.35, dof: 0, focus: 'near' } } },
  { id: 'rest-far', label: '식당 · 초점 배경(인물 흐림)', input: { type: 'restaurant', pose: 'eat', look: LOOK_B, crop: { scale: 1.3, x: -20, y: 0, rot: -12, pitch: 6, light: 0.9, dof: 0.7, focus: 'far' } } },
  { id: 'park-friend', label: '공원 · 동행', input: { type: 'park', pose: 'idle', look: DEFAULT_LOOK, friend: { color: '#5FC9A6' }, crop: { scale: 1.15, x: 4, y: 2, rot: 2, pitch: 0, light: 1.1, dof: 0.4, focus: 'near' } } },
  { id: 'cafe-met', label: '카페 · 말 튼 상대', input: { type: 'cafe', pose: 'happy', look: LOOK_C, met: { color: '#FF6A48' }, crop: { scale: 1.05, x: -6, y: 4, rot: -3, pitch: 4, light: 0.8, dof: 0.5, focus: 'near' } } },
  // 같은 공간에 있던 사람들 (FRIENDS_SPEC §6): 뒤의 왼쪽·오른쪽에 뒷모습으로 작게 — 얼굴 없음, 머리 모양만 상대의 것
  { id: 'river-present', label: '강변 · 같은 공간 둘(뒷모습) · 심도', input: { type: 'river', pose: 'idle', look: DEFAULT_LOOK, present: [{ color: '#F6C445', look: presentLook('curly') }, { color: '#6B7BB5', look: presentLook('long') }], crop: { scale: 1, x: 8, y: -6, rot: 5, pitch: -8, light: 1.2, dof: 0.6, focus: 'near' } } },
  // 말을 튼 뒤: 상대는 앞에 정면, 나머지 한 사람은 그대로 뒤에
  { id: 'cafe-present-met', label: '카페 · 뒷모습 하나 + 말 튼 상대', input: { type: 'cafe', pose: 'read', look: LOOK_C, met: { color: '#FF9A8B', look: presentLook('bob') }, present: [{ color: '#8FD694', look: presentLook('short') }], crop: { scale: 1.1, x: -4, y: 2, rot: -2, pitch: 3, light: 0.95, dof: 0.3, focus: 'near' } } },
  // 슬쩍 돌아본 얼굴 (AFFECTION_SPEC §4 — M5가 설렘에 쓴다): 배경 인물이 뒷모습 대신 3/4 얼굴
  { id: 'park-glance', label: '공원 · 돌아본 배경 인물(glance)', input: { type: 'park', pose: 'walk', look: DEFAULT_LOOK, present: [{ color: '#A9DCF5', look: presentLook('bob'), glance: true }, { color: '#5FC9A6', look: presentLook('short') }], crop: { scale: 1.2, x: 0, y: 4, rot: 0, pitch: 0, light: 1.05, dof: 0, focus: 'near' } } },
  { id: 'home-friend-met', label: '집 · 동행 + 상대 · 최대치', input: { type: 'home', pose: 'sit', look: LOOK_B, friend: { color: '#A9DCF5' }, met: { color: '#FFC64D' }, crop: { scale: 2.2, x: 35, y: 35, rot: 15, pitch: 18, light: 0.55, dof: 1, focus: 'near' } } },
];

/** ShotStage는 PlaceType을 받는다 — 프리셋의 SceneType은 전부 PlaceType이기도 하다. 라이브 무대는 glance를 모른다 (굽기 전용, M5) */
const stageProps = (p: BakeInput) => ({
  type: p.type as PlaceType, pose: p.pose, crop: p.crop,
  friendColor: p.friend?.color, metColor: p.met?.color, present: p.present?.map(f => ({ color: f.color, hairStyle: f.look?.hairStyle })),
});

interface Result { url: string; shot: BakedShot; ms: number; error?: string }

export function BakeLab() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const bake = async (p: BakePreset) => {
    setBusy(p.id);
    const t0 = performance.now();
    try {
      const shot = await bakeShot(p.input);
      const ms = Math.round(performance.now() - t0);
      setResults(r => { if (r[p.id]) URL.revokeObjectURL(r[p.id]!.url); return { ...r, [p.id]: { url: URL.createObjectURL(shot.blob), shot, ms } }; });
    } catch (e) {
      // 60 KB를 못 맞춘 컷은 마지막 시도를 그대로 보여 준다 (실패 표시와 함께) — 무엇이 커지는지 눈으로 보려고
      const over = e instanceof BakeOversizeError ? e.shot : undefined;
      setResults(r => ({ ...r, [p.id]: { url: over ? URL.createObjectURL(over.blob) : '', shot: over ?? { blob: new Blob(), mime: 'image/png', width: 0, height: 0, svgBytes: 0 }, ms: 0, error: String(e) } }));
    } finally { setBusy(null); }
  };
  const bakeAll = async () => { for (const p of presets) await bake(p); };

  useEffect(() => {
    (window as unknown as { __bake?: unknown }).__bake = { bakeSvg, bakeShot, presets, bakeAll };
  }, []);

  return (
    <div className="blab">
      <style>{CSS}</style>
      <h1>굽기 랩</h1>
      <div className="sub">BAKE LAB · 왼쪽 라이브 ShotStage / 오른쪽 구운 픽셀 · ADR-0024</div>
      <div className="bar">
        <button type="button" className="tg on" disabled={!!busy} onClick={bakeAll} data-bake-all>{busy ? `굽는 중… ${busy}` : '전부 굽기'}</button>
      </div>
      {presets.map(p => {
        const r = results[p.id];
        return (
          <section className="row" key={p.id} data-preset={p.id}>
            <h3>
              <span>{p.label}</span>
              <button type="button" className="tg" style={{ minHeight: 32, fontSize: 12, padding: '0 10px' }} disabled={!!busy} onClick={() => bake(p)}>굽기</button>
            </h3>
            <div className="pane">
              <span className="tag">live</span>
              <OwnerLookContext.Provider value={p.input.look}>
                <ShotStage {...stageProps(p.input)} still />
              </OwnerLookContext.Provider>
            </div>
            <div className="pane">
              <span className="tag">baked</span>
              {r?.url && <img src={r.url} alt="" width={r.shot.width} height={r.shot.height} />}
            </div>
            <div className="stat">
              {r ? (r.error ? `실패 · ${r.error}` : `${r.shot.mime} · ${r.shot.blob.size} B · ${r.shot.width}×${r.shot.height} · svg ${r.shot.svgBytes} B · ${r.ms} ms${r.shot.note ? ` · ${r.shot.note}` : ''}`) : '아직 안 구움'}
              {'\n'}{JSON.stringify(p.input.crop)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
