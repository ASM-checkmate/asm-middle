// ─── 퍼펫 캐릭터: 나노바나나가 그린 조각(머리·몸통·팔 2·다리 2)을 소켓에 끼워 조립하고 CSS 로 움직인다 ────────────
// 조각·관절은 puppet.json (scripts/puppet-parts.py 가 시트 좌표로 뽑고, 퍼펫 랩에서 다듬는다).
// 조립: 몸통이 뿌리. 조각의 pivot(구슬 가운데)이 몸통의 socket(목·어깨·엉덩이)에 오도록 놓고, 그 pivot 을 transform-origin 으로 돌린다.
// 그리는 순서: 팔 → 몸통 → 다리 → 머리. 팔은 구슬이 소매 뒤에 숨은 채 돌고, 다리는 구슬을 지운 채 바지 윗단이 반바지 밑단을 덮는다 (틈이 안 보인다).
// 걷기: 정면이라 다리·팔을 화면에서 좌우로 젓지 않고(가위처럼 보인다) rotateX 로 카메라 쪽으로 내밀었다 들인다 — 앞으로 나온 다리는 짧아 보인다.
import type { CSSProperties, ReactNode } from 'react';
import DATA from './puppet.json';

export type PuppetAnim = 'idle' | 'walk' | 'wave' | 'none';
export type PartName = 'head' | 'torso' | 'arm-l' | 'arm-r' | 'leg-l' | 'leg-r';
export type SocketName = 'neck' | 'shoulder-l' | 'shoulder-r' | 'hip-l' | 'hip-r';
export interface PuppetPart { src: string; x: number; y: number; w: number; h: number; pivot: [number, number] }
export interface Puppet { sheet: [number, number]; parts: Record<PartName, PuppetPart>; sockets: Record<SocketName, [number, number]> }

export const PUPPET = DATA as unknown as Puppet;
const SOCKET_OF: Record<Exclude<PartName, 'torso'>, SocketName> = { head: 'neck', 'arm-l': 'shoulder-l', 'arm-r': 'shoulder-r', 'leg-l': 'hip-l', 'leg-r': 'hip-r' };
const ORDER: PartName[] = ['arm-l', 'arm-r', 'torso', 'leg-l', 'leg-r', 'head'];   // 다리는 반바지 위에 (구슬은 지워져 있다), 팔은 소매 뒤에

/** 조각의 조립 위치(시트 px, 왼쪽 위) 와 전체 상자 */
export function layout(p: Puppet) {
  const pos = {} as Record<PartName, [number, number]>;
  for (const name of ORDER) {
    const part = p.parts[name];
    if (name === 'torso') { pos[name] = [part.x, part.y]; continue; }
    const s = p.sockets[SOCKET_OF[name]];
    pos[name] = [s[0] - (part.pivot[0] - part.x), s[1] - (part.pivot[1] - part.y)];
  }
  const xs = ORDER.flatMap(n => [pos[n][0], pos[n][0] + p.parts[n].w]);
  const ys = ORDER.flatMap(n => [pos[n][1], pos[n][1] + p.parts[n].h]);
  return { pos, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
}

const CSS = `
.pp{position:relative}
.pp .pp-root{position:absolute;inset:0}
.pp img{position:absolute;pointer-events:none;user-select:none}
.pp.idle .pp-root{animation:pp-breathe 3.2s ease-in-out infinite}
.pp.idle .pp-head{animation:pp-nod 3.2s ease-in-out infinite}
.pp.idle .pp-arm-l{animation:pp-sway 3.2s ease-in-out infinite}
.pp.idle .pp-arm-r{animation:pp-sway 3.2s ease-in-out infinite reverse}
@keyframes pp-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-.7%)}}
@keyframes pp-nod{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes pp-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.pp.walk .pp-root{animation:pp-bob .36s ease-in-out infinite}
.pp.walk .pp-leg-l{animation:pp-step .72s ease-in-out infinite}
.pp.walk .pp-leg-r{animation:pp-step .72s ease-in-out infinite reverse}
.pp.walk .pp-arm-l{animation:pp-step-arm .72s ease-in-out infinite reverse}
.pp.walk .pp-arm-r{animation:pp-step-arm .72s ease-in-out infinite}
.pp.walk .pp-head{animation:pp-nod .72s ease-in-out infinite}
@keyframes pp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2%)}}
@keyframes pp-step{0%,100%{transform:perspective(900px) rotateX(38deg)}50%{transform:perspective(900px) rotateX(-30deg)}}
@keyframes pp-step-arm{0%,100%{transform:perspective(900px) rotateX(-28deg) rotate(2deg)}50%{transform:perspective(900px) rotateX(28deg) rotate(-2deg)}}
.pp.wave .pp-arm-r{animation:pp-wave .9s ease-in-out infinite}
.pp.wave .pp-head{animation:pp-nod 1.8s ease-in-out infinite}
@keyframes pp-wave{0%,100%{transform:rotate(-118deg)}50%{transform:rotate(-142deg)}}
`;

interface Props { size?: number; anim?: PuppetAnim; puppet?: Puppet; className?: string; style?: CSSProperties; /** 편집용: 조각 위에 표시 */ overlay?: (k: number, box: { x: number; y: number }, pos: Record<PartName, [number, number]>) => ReactNode }

export function PuppetGirl({ size = 400, anim = 'idle', puppet = PUPPET, className, style, overlay }: Props) {
  const { pos, box } = layout(puppet);
  const k = size / box.h;
  return (
    <div className={`pp ${anim} ${className ?? ''}`} style={{ width: box.w * k, height: size, ...style }} role="img" aria-label="캐릭터">
      <style>{CSS}</style>
      <div className="pp-root">
        {ORDER.map(name => {
          const p = puppet.parts[name];
          const [x, y] = pos[name];
          const ox = ((p.pivot[0] - p.x) / p.w) * 100, oy = ((p.pivot[1] - p.y) / p.h) * 100;
          return <img key={name} className={`pp-${name}`} src={p.src} alt="" draggable={false} style={{ left: (x - box.x) * k, top: (y - box.y) * k, width: p.w * k, height: p.h * k, transformOrigin: `${ox.toFixed(2)}% ${oy.toFixed(2)}%` }} />;
        })}
      </div>
      {overlay?.(k, box, pos)}
    </div>
  );
}
