// ─── 얼굴 축 시트 (실험, ?lab=character&sheet=faces) ───────────────────────────
// 축별 변형을 줄로, 손으로 고른 "사람" 여섯을 머리·방 크기(96px)로 나란히. 스크린샷용이라 한 화면에 다 들어가게 넓게 그린다.
import type { CSSProperties } from 'react';
import { Character } from '../character';
import { Head } from '../character/shapes';
import { lookVars } from '../character/look';
import { DEFAULT_LOOK, LOOK_BROWS, LOOK_BUILDS, LOOK_EARS, LOOK_EYES, LOOK_FACES, LOOK_HAIR_STYLES, LOOK_MOUTHS, LOOK_NOSES, type Look } from '../sim/types';

const CSS = `
.fs{background:#FFF6E6;color:#2A2118;padding:16px 20px 30px;font-family:var(--body,system-ui);width:1180px;box-sizing:border-box}
.fs h2{font-family:var(--display,system-ui);font-size:17px;margin:14px 0 4px}
.fs .row{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end}
.fs .c{display:grid;justify-items:center;gap:0;background:#fff;border:2px solid #2A2118;border-radius:14px;padding:4px 4px 2px;box-shadow:3px 3px 0 #2A2118}
.fs .c b{font-family:var(--mono,monospace);font-weight:400;font-size:10px;color:#6b5f55}
.fs .c.grn{background:#DDF3EA}
`;

function HeadCard({ look, label, size = 96, back = false }: { look: Look; label: string; size?: number; back?: boolean }) {
  return (
    <div className="c">
      <svg viewBox="-90 -90 180 180" width={size} height={size} style={lookVars(look) as CSSProperties}><Head look={look} back={back} /></svg>
      <b>{label}</b>
    </div>
  );
}

const M = DEFAULT_LOOK;
const withHair = (l: Look): Look => ({ ...l, hairStyle: 'short' });
/** 손으로 고른 사람 여섯 — 공개 초상 사진 실험(assets-src/look-experiment)의 그 다섯 + 모모 */
const PEOPLE: { name: string; look: Look }[] = [
  { name: '모모', look: M },
  { name: '오바마', look: { skin: 'dark', hairColor: 'black', hairStyle: 'buzz', glasses: 'none', beard: 'none', top: 'night', face: 'long', eyes: 'dot', brows: 'thick', nose: 'small', mouth: 'wide', ears: 'out', build: 'slim' } },
  { name: '샌더스', look: { skin: 'light', hairColor: 'white', hairStyle: 'curly', glasses: 'round', beard: 'none', top: 'night', face: 'square', eyes: 'narrow', brows: 'angled', nose: 'big', mouth: 'flat', ears: 'hidden', build: 'wide' } },
  { name: 'RBG', look: { skin: 'light', hairColor: 'gray', hairStyle: 'bun', glasses: 'square', beard: 'none', top: 'night', face: 'square', eyes: 'narrow', brows: 'thin', nose: 'small', mouth: 'flat', ears: 'hidden', build: 'slim' } },
  { name: '더크워스', look: { skin: 'tan', hairColor: 'black', hairStyle: 'wavy', glasses: 'none', beard: 'none', top: 'night', face: 'heart', eyes: 'big', brows: 'thin', nose: 'small', mouth: 'smile', ears: 'hidden', build: 'normal' } },
  { name: '배럿', look: { skin: 'light', hairColor: 'brown', hairStyle: 'long', glasses: 'none', beard: 'none', top: 'sky', face: 'long', eyes: 'sharp', brows: 'thin', nose: 'small', mouth: 'wide', ears: 'hidden', build: 'normal' } },
];
/** 무작위 12명 — 축을 섞었을 때 서로 다른 사람으로 보이는지 */
const SKINS = ['light', 'fair', 'tan', 'brown', 'dark'] as const;
const HC = ['black', 'dark-brown', 'brown', 'blond', 'red', 'gray', 'white'] as const;
const HS = LOOK_HAIR_STYLES;
const pick = <T,>(a: readonly T[], i: number) => a[i % a.length];
const MIX: Look[] = Array.from({ length: 12 }, (_, i) => ({
  skin: pick(SKINS, i * 3 + 1), hairColor: pick(HC, i * 5 + 2), hairStyle: pick(HS, i * 2 + 1), glasses: i % 4 === 1 ? 'round' : i % 4 === 3 ? 'square' : 'none',
  beard: i % 5 === 2 ? 'stubble' : i % 5 === 4 ? 'full' : 'none', top: pick(['coral', 'sun', 'mint', 'sky', 'night', 'paper', 'leaf'] as const, i),
  face: pick(LOOK_FACES, i), eyes: pick(LOOK_EYES, i * 3 + 1), brows: pick(LOOK_BROWS, i * 2 + 1), nose: pick(LOOK_NOSES, i), mouth: pick(LOOK_MOUTHS, i * 2), ears: i % 3 === 0 ? 'out' : 'hidden', build: pick(LOOK_BUILDS, i * 2 + 1),
}));

/** QA: `&people=<base64 JSON [{name, look}]>`가 있으면 손으로 고른 여섯 대신 그것을 그린다 (비전 모델이 고른 값 확인용) */
function peopleFromUrl(): { name: string; look: Look }[] {
  try {
    const q = new URLSearchParams(location.search).get('people');
    if (q) { const j = JSON.parse(decodeURIComponent(escape(atob(q)))) as { name: string; look: Look }[]; if (Array.isArray(j) && j.length) return j; }
  } catch { /* 잘못된 파라미터는 무시 */ }
  return PEOPLE;
}

export function FaceSheet() {
  const people = peopleFromUrl();
  return (
    <div className="fs">
      <style>{CSS}</style>
      <h2>얼굴형 · 눈 (머리 short)</h2>
      <div className="row">
        {LOOK_FACES.map(f => <HeadCard key={f} look={withHair({ ...M, face: f })} label={f} />)}
        <span style={{ width: 14 }} />
        {LOOK_EYES.map(e => <HeadCard key={e} look={withHair({ ...M, eyes: e })} label={e} />)}
      </div>
      <h2>눈썹 · 코 · 입 · 귀</h2>
      <div className="row">
        {LOOK_BROWS.map(b => <HeadCard key={b} look={withHair({ ...M, brows: b })} label={b} />)}
        <span style={{ width: 14 }} />
        {LOOK_NOSES.map(n => <HeadCard key={n} look={withHair({ ...M, nose: n })} label={n} />)}
        <span style={{ width: 14 }} />
        {LOOK_MOUTHS.map(m => <HeadCard key={m} look={withHair({ ...M, mouth: m })} label={m} />)}
        <span style={{ width: 14 }} />
        {LOOK_EARS.map(e => <HeadCard key={e} look={withHair({ ...M, ears: e })} label={e} />)}
      </div>
      <h2>머리 모양 15 — 앞 / 뒤</h2>
      <div className="row">{LOOK_HAIR_STYLES.map(h => <HeadCard key={h} look={{ ...M, hairStyle: h }} label={h} size={72} />)}</div>
      <div className="row" style={{ marginTop: 6 }}>{LOOK_HAIR_STYLES.map(h => <HeadCard key={h} look={{ ...M, hairStyle: h }} label={h} size={72} back />)}</div>
      <h2>체형 3 × 가만히·걷기·앉기·생각 · 탈것용 몸통</h2>
      <div className="row">
        {LOOK_BUILDS.map(b => (['idle', 'walk', 'sit', 'think'] as const).map(p => <div className="c grn" key={b + p}><Character pose={p} size={84} look={{ ...M, build: b }} paused /><b>{b}·{p}</b></div>))}
      </div>
      <h2>표정이 축을 이기는가 — 샌더스·더크워스 × 기쁨·잠·생각·읽기·먹기·인사</h2>
      <div className="row">
        {[PEOPLE[2], PEOPLE[4]].map(p => (['happy', 'sleep', 'think', 'read', 'eat', 'wave'] as const).map(pose => <div className="c grn" key={p.name + pose}><Character pose={pose} size={84} look={p.look} paused /><b>{p.name}·{pose}</b></div>))}
      </div>
      <h2>얼굴형 × 눈 (같은 머리·색)</h2>
      {LOOK_FACES.map(f => (
        <div className="row" key={f} style={{ marginBottom: 6 }}>
          {LOOK_EYES.map(e => LOOK_BROWS.map(b => <HeadCard key={e + b} size={64} look={withHair({ ...M, face: f, eyes: e, brows: b })} label={`${f}·${e}·${b}`} />))}
        </div>
      ))}
      <h2>사람 여섯 — 머리 120 / 방 96 / 방 62</h2>
      <div className="row">{people.map(p => <HeadCard key={p.name} look={p.look} label={p.name} size={120} />)}</div>
      <div className="row" style={{ marginTop: 6 }}>{people.map(p => <div className="c grn" key={p.name}><Character pose="idle" size={96} look={p.look} paused /><b>{p.name}</b></div>)}</div>
      <div className="row" style={{ marginTop: 6 }}>{people.map(p => <div className="c grn" key={p.name}><Character pose="walk" size={62} look={p.look} paused /><b>{p.name}</b></div>)}</div>
      <div className="row" style={{ marginTop: 6 }}>{people.map(p => <div className="c grn" key={p.name}><Character pose="idle" size={62} back look={p.look} paused /><b>{p.name} 뒤</b></div>)}</div>
      <h2>무작위 12</h2>
      <div className="row">{MIX.map((l, i) => <HeadCard key={i} look={l} label={`${l.face}·${l.eyes}·${l.brows}`} />)}</div>
      <div className="row" style={{ marginTop: 6 }}>{MIX.map((l, i) => <div className="c grn" key={i}><Character pose="idle" size={72} look={l} paused /><b>{i + 1}</b></div>)}</div>
    </div>
  );
}
