// ─── 겉모습 실험실 (ADR-0019, ?lab=character 안) ─────────────────────────────────
// 사진 → POST /api/character/look → Look 여섯 칸 → 캐릭터. 칸마다 손으로도 바꿔 본다. "내 캐릭터로" 저장하면 앱 전체(얼굴 심볼·탈것 포함)가 이 겉모습이다.
// QA: `?lab=character&look=<base64 JSON>`으로 처음 값을 넣는다.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Character, Rider } from '../character';
import { useWorld } from '../sim/store';
import { fetchLook } from '../sim/llm';
import { DEFAULT_LOOK, LOOK_BEARDS, LOOK_GLASSES, LOOK_HAIR_COLORS, LOOK_HAIR_STYLES, LOOK_SKINS, LOOK_TOPS, isLook, type Look } from '../sim/types';

const FIELDS: { key: keyof Look; label: string; values: readonly string[] }[] = [
  { key: 'skin', label: '피부', values: LOOK_SKINS },
  { key: 'hairColor', label: '머리색', values: LOOK_HAIR_COLORS },
  { key: 'hairStyle', label: '머리 모양', values: LOOK_HAIR_STYLES },
  { key: 'glasses', label: '안경', values: LOOK_GLASSES },
  { key: 'beard', label: '수염', values: LOOK_BEARDS },
  { key: 'top', label: '상의', values: LOOK_TOPS },
];
const MAX_PX = 512;

/** 사진을 긴 변 512px JPEG dataURL로 줄인다 — 본문 상한(1.5 MB) 안쪽, 모델은 이 크기면 충분하다 */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, MAX_PX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

function initialLook(saved: Look | undefined): Look {
  try {
    const q = new URLSearchParams(location.search).get('look');
    if (q) { const j = JSON.parse(atob(q)); if (isLook(j)) return j; }
  } catch { /* 잘못된 파라미터는 무시 */ }
  return saved ?? DEFAULT_LOOK;
}

export function LookLab() {
  const saved = useWorld(s => s.memory.look);
  const setLook = useWorld(s => s.setLook);
  const [look, setLocal] = useState<Look>(() => initialLook(saved));
  const [photo, setPhoto] = useState<string | null>(null);
  const [seen, setSeen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<'small' | 'good'>('good');
  const b64 = useMemo(() => btoa(JSON.stringify(look)), [look]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setNote(''); setSeen('');
    try {
      const data = await shrink(f);
      setPhoto(data);
      const t0 = performance.now();
      const r = await fetchLook(data, tier);
      if (!r) { setNote('못 읽었어요 — 백엔드·Ollama를 확인하세요'); return; }
      setLocal(r.look); setSeen(r.seen);
      setNote(`${r.model} · ${Math.round(performance.now() - t0)}ms`);
    } finally { setBusy(false); }
  };
  const tg = (on: boolean) => `tg${on ? ' on' : ''}`;

  return (
    <>
      <h2>겉모습 <small>Look · 사진 → 여섯 칸 (ADR-0019)</small></h2>
      <div className="bar">
        <label className="tg" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          {busy ? '읽는 중…' : '사진 고르기'}
          <input type="file" accept="image/*" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
        </label>
        <button className={tg(tier === 'good')} onClick={() => setTier(t => (t === 'good' ? 'small' : 'good'))}>모델 {tier}</button>
        <button className={tg(saved !== undefined && JSON.stringify(saved) === JSON.stringify(look))} onClick={() => setLook(look)}>내 캐릭터로 저장</button>
        <button className="tg" onClick={() => { setLook(undefined); setLocal(DEFAULT_LOOK); }}>기본(모모)으로</button>
      </div>
      {(seen || note) && <div className="sub" style={{ marginTop: 8 }}>{seen && <>“{seen}” · </>}{note}</div>}
      <div className="row2" style={{ marginTop: 10 }}>
        <div className="cell" style={{ minHeight: 200 }}>
          {photo ? <img src={photo} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 12, border: '2px solid var(--ink)' }} /> : <span className="sub">사진 없음</span>}
        </div>
        <div className="cell">
          <Character pose="idle" size={150} look={look} />
          <b>지금 겉모습</b>
        </div>
      </div>
      <div className="grid small" style={{ marginTop: 10 }}>
        {(['happy', 'walk', 'sit', 'think', 'sleep'] as const).map(p => (
          <div className="cell sm" key={p}><Character pose={p} size={62} look={look} /><b>{p}</b></div>
        ))}
        <div className="cell sm"><Character pose="walk" size={62} look={look} back /><b>뒷모습</b></div>
      </div>
      <div className="ground sm" style={{ marginTop: 10 }}>
        {/* 탈것은 OwnerLookContext(저장된 겉모습)를 본다 — 저장 뒤에 바뀐다 */}
        <Rider mode="walk" size={96} />
        <b>탈것 (저장된 겉모습)</b>
      </div>
      {FIELDS.map(f => (
        <div key={f.key} style={{ marginTop: 10 }}>
          <div className="sub">{f.label}</div>
          <div className="bar">
            {f.values.map(v => (
              <button key={v} className={tg(look[f.key] === v)} onClick={() => setLocal({ ...look, [f.key]: v })}>{v}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="sub" style={{ marginTop: 10, wordBreak: 'break-all' }}>?lab=character&look={b64}</div>
    </>
  );
}
