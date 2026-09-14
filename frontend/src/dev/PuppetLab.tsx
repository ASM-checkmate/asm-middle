// ─── 퍼펫 랩 (dev page, `?lab=puppet`) ─────────────────────────────────────────
// 나노바나나 조각으로 조립한 캐릭터를 크게 보며 관절(조각 pivot·몸통 socket)을 다듬는다. 조각/소켓을 고르고 방향키(⇧=10px)로 옮긴 뒤
// "JSON 복사" 한 것을 src/dev/puppet/puppet.json 에 붙여 넣으면 앱에 반영된다. 대기·걷기·손 흔들기로 돌려 본다.
import { useEffect, useState } from 'react';
import { PUPPET, PuppetGirl, type PartName, type Puppet, type PuppetAnim, type SocketName } from './puppet/PuppetGirl';

const CSS = `
.plab{box-sizing:border-box;min-height:100%;background:#1B1715;color:#F4EDE6;padding:18px 14px 40px;font-family:var(--body);display:grid;justify-items:center;gap:14px}
.plab h1{font-family:var(--display);font-size:22px;margin:0}
.plab .sub{font-family:var(--mono);font-size:11px;color:#A69C93;letter-spacing:.08em;text-align:center}
.plab .stage{position:relative;background:#2E2825;border-radius:18px;padding:24px 40px;box-shadow:0 18px 40px rgba(0,0,0,.45)}
.plab .rows{width:520px;display:grid;gap:10px}
.plab .row{display:grid;grid-template-columns:52px 1fr;align-items:center;gap:8px}
.plab .row b{font-family:var(--display);font-weight:400;font-size:13px;color:#CFC4BA}
.plab .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.plab .chip{min-height:34px;padding:0 12px;border-radius:999px;border:1px solid #4A403A;background:#2A2422;color:#EDE4DC;font-size:13px;font-family:var(--display)}
.plab .chip.on{background:#F2B233;color:#1B1715;border-color:#F2B233}
.plab .chip.sock.on{background:#4DA3FF}
.plab .hint{font-family:var(--mono);font-size:11px;color:#8C817A;width:520px;line-height:1.5}
.plab textarea{width:520px;height:120px;background:#120F0E;color:#CFC4BA;border:1px solid #4A403A;border-radius:10px;font-family:var(--mono);font-size:10px;padding:8px}
`;

const PARTS: PartName[] = ['head', 'torso', 'arm-l', 'arm-r', 'leg-l', 'leg-r'];
const ANIM_KO: Record<PuppetAnim, string> = { idle: '대기', walk: '걷기', wave: '손 흔들기', none: '정지' };

const SOCKETS: SocketName[] = ['neck', 'shoulder-l', 'shoulder-r', 'hip-l', 'hip-r'];

export function PuppetLab() {
  const [puppet, setPuppet] = useState<Puppet>(() => structuredClone(PUPPET));
  const [anim, setAnim] = useState<PuppetAnim>('idle');
  const [sel, setSel] = useState<{ kind: 'part'; name: PartName } | { kind: 'socket'; name: SocketName } | null>(null);
  const [size, setSize] = useState(560);
  const [json, setJson] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel) return;
      const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const v = d[e.key]; if (!v) return;
      e.preventDefault();
      const m = e.shiftKey ? 10 : 1;
      setPuppet(p => {
        const n = structuredClone(p);
        if (sel.kind === 'part') { const pv = n.parts[sel.name].pivot; pv[0] += v[0] * m; pv[1] += v[1] * m; }
        else { const s = n.sockets[sel.name]; s[0] += v[0] * m; s[1] += v[1] * m; }
        return n;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const overlay = (k: number, box: { x: number; y: number }, pos: Record<PartName, [number, number]>) => (
    <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} width="100%" height="100%">
      {PARTS.map(n => { const p = puppet.parts[n]; const [x, y] = pos[n]; const on = sel?.kind === 'part' && sel.name === n; return (
        <g key={n}>
          <rect x={(x - box.x) * k} y={(y - box.y) * k} width={p.w * k} height={p.h * k} fill="none" stroke={on ? '#F2B233' : '#FF6E58'} strokeDasharray="4 3" opacity={on ? 1 : .35} />
          {n !== 'torso' && <circle cx={(x - box.x + p.pivot[0] - p.x) * k} cy={(y - box.y + p.pivot[1] - p.y) * k} r={on ? 7 : 5} fill="#F2B233" stroke="#1B1715" strokeWidth="1.5" />}
        </g>); })}
      {SOCKETS.map(n => { const s = puppet.sockets[n]; const on = sel?.kind === 'socket' && sel.name === n; return <circle key={n} cx={(s[0] - box.x) * k} cy={(s[1] - box.y) * k} r={on ? 7 : 4} fill="#4DA3FF" stroke="#1B1715" strokeWidth="1.5" />; })}
    </svg>
  );

  return (
    <div className="plab">
      <style>{CSS}</style>
      <h1>퍼펫 랩</h1>
      <div className="sub">PUPPET LAB · 나노바나나 조각 조립 · 관절 다듬기 · 대기/걷기/인사</div>
      <div className="stage"><PuppetGirl puppet={puppet} size={size} anim={anim} overlay={sel ? overlay : undefined} /></div>
      <div className="rows">
        <div className="row"><b>동작</b><div className="chips">{(['idle', 'walk', 'wave', 'none'] as PuppetAnim[]).map(a => <button key={a} className={`chip${anim === a ? ' on' : ''}`} onClick={() => setAnim(a)}>{ANIM_KO[a]}</button>)}</div></div>
        <div className="row"><b>조각</b><div className="chips">{PARTS.filter(n => n !== 'torso').map(n => <button key={n} className={`chip${sel?.kind === 'part' && sel.name === n ? ' on' : ''}`} onClick={() => setSel(s => (s?.kind === 'part' && s.name === n ? null : { kind: 'part', name: n }))}>{n} 축</button>)}</div></div>
        <div className="row"><b>소켓</b><div className="chips">{SOCKETS.map(n => <button key={n} className={`chip sock${sel?.kind === 'socket' && sel.name === n ? ' on' : ''}`} onClick={() => setSel(s => (s?.kind === 'socket' && s.name === n ? null : { kind: 'socket', name: n }))}>{n}</button>)}</div></div>
        <div className="row"><b>크기</b><div className="chips"><input type="range" min={200} max={800} value={size} onChange={e => setSize(Number(e.target.value))} /><button className="chip" onClick={() => setJson(JSON.stringify(puppet, null, 1))}>JSON 복사</button><button className="chip" onClick={() => { setPuppet(structuredClone(PUPPET)); setJson(''); }}>되돌리기</button></div></div>
      </div>
      {json && <textarea readOnly value={json} onFocus={e => e.currentTarget.select()} />}
      <div className="hint">조각(노랑 = 그 조각의 회전축)이나 소켓(파랑 = 몸통의 끼우는 자리)을 고르고 방향키로 옮긴다 (⇧ 10px). 맞으면 "JSON 복사" → src/dev/puppet/puppet.json 에 붙여 넣기. 조각 자체는 python3 scripts/puppet-parts.py 가 art/gen/char-parts.jpg 에서 뗀다.</div>
    </div>
  );
}
