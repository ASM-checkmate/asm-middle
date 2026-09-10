// ─── 굽기의 순수한 부분 (ADR-0020 스파이크): 색표·자리·크기·조도·심도·id ──────────────────────
// React·DOM 없이 돈다 — scripts/sim-bake.test.mjs가 node에서 그대로 읽는다. 여기 숫자는 전부 camera.css·scenes.css·tokens.css를
// 옮겨 적은 것이다: 라이브 무대(CameraOverlay ShotStage)가 %와 CSS 변수로 하는 일을 px와 SVG 속성으로 다시 쓴다.
// 라이브 쪽 규칙이 바뀌면 여기도 같이 바꿔야 한다 — 그래서 각 상수 옆에 원래 줄을 적어 뒀다.
import type { ShotCrop } from '../sim/types';

/** theme/tokens.css — 무대(scenes.css)의 fill/stroke 클래스가 읽는 토큰 */
export const TOKEN = {
  paper: '#FFF6E6', paper2: '#FFEBCB', card: '#FFFFFF',
  ink: '#2A2118', ink2: '#6B5B4B', ink3: '#A08C76', line: '#E8D6B6', skin: '#FFD9B8',
  coral: '#FF6A48', coral2: '#FFD2C4', coral3: '#FFF1EC',
  sun: '#FFC64D', sun2: '#FFE9B3', mint: '#5FC9A6', mint2: '#CDEFE3',
  sky: '#A9DCF5', sky2: '#E3F3FC', leaf: '#8FD37E', night: '#1E2440', night2: '#3A4270',
} as const;

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase();
export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
/** `color-mix(in srgb, a p%, b)` — sRGB 채널을 그대로 선형 보간한다 (감마 변환 없음, 브라우저와 ±1 안). */
export function mix(a: string, pct: number, b: string): string {
  const A = hexToRgb(a), B = hexToRgb(b), p = pct / 100;
  return '#' + A.map((v, i) => hex2(v * p + B[i]! * (1 - p))).join('');
}

/** scenes.css:5-15 의 --sc-* — color-mix를 미리 계산한 값. getComputedStyle로 재본 값이 아니라 식 그대로다 */
export const SCENE_PALETTE = {
  wood: mix(TOKEN.ink3, 52, TOKEN.sun),
  wood2: mix(TOKEN.ink2, 60, TOKEN.sun),
  grass: mix(TOKEN.leaf, 62, TOKEN.paper),
  grass2: mix(TOKEN.leaf, 80, TOKEN.mint),
  sand: mix(TOKEN.sun2, 60, TOKEN.paper),
  water: TOKEN.sky,
  water2: mix(TOKEN.sky, 72, TOKEN.mint),
  stone: mix(TOKEN.ink3, 30, TOKEN.paper),
  stone2: mix(TOKEN.ink3, 55, TOKEN.paper),
  cream: mix(TOKEN.sun2, 45, TOKEN.paper),
  rubber: mix(TOKEN.night2, 55, TOKEN.paper2),
} as const;

/** scenes.css:19-42 를 리터럴 hex로 푼 것 — 구운 svg의 <style>에 그대로 들어간다 (애니메이션·hush 규칙은 뺀다: 정지 무대) */
export const SCENE_CSS = [
  `.f-paper{fill:${TOKEN.paper}}.f-paper2{fill:${TOKEN.paper2}}.f-card{fill:${TOKEN.card}}`,
  `.f-ink{fill:${TOKEN.ink}}.f-ink2{fill:${TOKEN.ink2}}.f-ink3{fill:${TOKEN.ink3}}.f-line{fill:${TOKEN.line}}`,
  `.f-skin{fill:${TOKEN.skin}}.f-coral{fill:${TOKEN.coral}}.f-coral2{fill:${TOKEN.coral2}}.f-coral3{fill:${TOKEN.coral3}}`,
  `.f-sun{fill:${TOKEN.sun}}.f-sun2{fill:${TOKEN.sun2}}.f-mint{fill:${TOKEN.mint}}.f-mint2{fill:${TOKEN.mint2}}`,
  `.f-sky{fill:${TOKEN.sky}}.f-sky2{fill:${TOKEN.sky2}}.f-leaf{fill:${TOKEN.leaf}}.f-night{fill:${TOKEN.night}}.f-night2{fill:${TOKEN.night2}}`,
  `.f-wood{fill:${SCENE_PALETTE.wood}}.f-wood2{fill:${SCENE_PALETTE.wood2}}.f-grass{fill:${SCENE_PALETTE.grass}}.f-grass2{fill:${SCENE_PALETTE.grass2}}`,
  `.f-sand{fill:${SCENE_PALETTE.sand}}.f-water{fill:${SCENE_PALETTE.water}}.f-water2{fill:${SCENE_PALETTE.water2}}.f-stone{fill:${SCENE_PALETTE.stone}}.f-stone2{fill:${SCENE_PALETTE.stone2}}`,
  `.f-cream{fill:${SCENE_PALETTE.cream}}.f-rubber{fill:${SCENE_PALETTE.rubber}}.f-none{fill:none}`,
  `.st-sky{stop-color:${TOKEN.sky}}.st-sky2{stop-color:${TOKEN.sky2}}.st-paper{stop-color:${TOKEN.paper}}.st-paper2{stop-color:${TOKEN.paper2}}`,
  `.st-sun2{stop-color:${TOKEN.sun2}}.st-coral2{stop-color:${TOKEN.coral2}}.st-coral3{stop-color:${TOKEN.coral3}}.st-mint2{stop-color:${TOKEN.mint2}}`,
  `.st-cream{stop-color:${SCENE_PALETTE.cream}}.st-sun{stop-color:${TOKEN.sun}}`,
  `.s-ink{stroke:${TOKEN.ink};stroke-width:3;stroke-linejoin:round;stroke-linecap:round}`,
  `.s-ink2{stroke:${TOKEN.ink};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
  `.s-ink4{stroke:${TOKEN.ink};stroke-width:4;stroke-linejoin:round;stroke-linecap:round}`,
  `.s-paper{stroke:${TOKEN.paper};stroke-width:3;stroke-linecap:round}.s-card{stroke:${TOKEN.card};stroke-width:3;stroke-linecap:round}`,
  `.s-water{stroke:${SCENE_PALETTE.water2};stroke-width:4;stroke-linecap:round}.s-line{stroke:${TOKEN.line};stroke-width:2;stroke-linecap:round}`,
  `.s-wood2{stroke:${SCENE_PALETTE.wood2};stroke-width:2}.s-coral{stroke:${TOKEN.coral};stroke-width:3;stroke-linecap:round}`,
  `.s-mint{stroke:${TOKEN.mint};stroke-width:3;stroke-linecap:round}.s-none{stroke:none}`,
  // 캐릭터 svg: character.css .ch { overflow: visible } — 생각 풍선·반짝이가 200 상자 밖으로 조금 나간다
  '.ch{overflow:visible}',
].join('');

/** tokens.css 변수 이름(--ink-3·--paper-2 …)으로 찾는 같은 표 — 무대 소품의 인라인 `var(--ink-3)` 치환용 (markup.ts) */
export const TOKEN_VARS: Record<string, string> = Object.fromEntries(Object.entries(TOKEN).map(([k, v]) => [k.replace(/(\d)$/, '-$1'), v]));

/**
 * 정지 자세 — character.css를 통째로 넣지 않으니(루프는 굽는 데 필요 없다) 라이브 썸네일(`.ch.is-paused`: 모든 루프를 0 ms에서
 * 멈춤, 음수 animation-delay 포함)이 보여 주는 **0 % 키프레임 상태**만 정적 규칙으로 옮겨 적는다. 원래 줄은 character.css:22-97.
 * 항등인 것(scaleY(1)·translateY(0)·rotate(0))은 뺐다. 음수 delay로 중간에 멈춘 것은 그 시각의 보간값(ease-out·ease-in-out 베지어).
 */
export const STILL_CSS = [
  // character.css:7-17 — transform-box: fill-box + 관절 원점 (팔·발의 pivot 원이 fill-box 가운데를 관절에 맞춘다)
  '.ch-root,.ch-body,.ch-head,.ch-eyes,.ch-arm,.ch-foot,.ch-z,.ch-spark{transform-box:fill-box}',
  '.ch-root,.ch-body{transform-origin:50% 100%}.ch-head{transform-origin:50% 62%}',
  '.ch-eyes,.ch-arm,.ch-foot,.ch-z,.ch-spark{transform-origin:50% 50%}',
  '.ch[data-pose="idle"] .ch-arm{transform:rotate(-2deg)}',                                   // ch-sway 0%
  '.ch[data-pose="walk"] .ch-root{transform:rotate(-2deg)}',                                  // ch-bob 0%
  '.ch[data-pose="walk"] .ch-foot-r{transform:translateY(-9px)}',                             // ch-step, delay -280ms → 50%
  '.ch[data-pose="walk"] .ch-arm-l{transform:rotate(-16deg)}.ch[data-pose="walk"] .ch-arm-r{transform:rotate(16deg)}', // ch-swing 0% / 50%
  '.ch[data-pose="sit"] .ch-head{transform:rotate(-2deg)}',                                   // ch-sway 0%
  '.ch[data-pose="sleep"] .ch-z{opacity:0}',                                                  // ch-zz 0%
  '.ch[data-pose="sleep"] .ch-z:nth-child(2){transform:translate(5.86px,-14.65px) scale(.817);opacity:.822}',  // delay -800ms → 33 % (ease-out)
  '.ch[data-pose="sleep"] .ch-z:nth-child(3){transform:translate(10.13px,-25.32px) scale(1.048);opacity:.258}', // delay -1600ms → 67 %
  '.ch[data-pose="wave"] .ch-arm-r{transform:rotate(-16deg)}',                                // ch-wave 0%
  '.ch[data-pose="draw"] .ch-arm-r{transform:rotate(-5deg)}',                                 // ch-scribble 0%
  '.ch[data-pose="happy"] .ch-arm{transform:rotate(-10deg)}',                                 // ch-armsup 0%
  '.ch[data-pose="happy"] .ch-spark{opacity:0}',                                              // ch-spark 0%: scale(0) opacity 0
  '.ch[data-pose="happy"] g:nth-of-type(2) > .ch-spark{transform:scale(1) rotate(45deg);opacity:1}', // delay -700ms → 50%
  '.ch[data-pose="eat"] .ch-mouth-b{opacity:0}',                                              // ch-show-b 0%
  '.ch[data-pose="read"] .ch-eyes{transform:translateX(-2.5px)}',                             // ch-scan 0%
  '.ch[data-pose="think"] .ch-dot{opacity:.25}',                                              // ch-dots 0%
  '.ch[data-pose="think"] .ch-dot:nth-of-type(2),.ch[data-pose="think"] .ch-dot:nth-of-type(3){opacity:.826}', // delay -500/-1000ms → 33/67 % (ease-in-out)
].join('');

// ─── 프레임 ──────────────────────────────────────────────────────────────────
/** camera.css .cam-frame aspect-ratio 1 / 1.08 — 세로가 긴 변 */
export const FRAME_ASPECT = 1.08;
/** ADR-0020: 긴 변 300px */
export const DEFAULT_LONG_EDGE = 300;
/** 무대 svg viewBox (scenes/index.tsx) */
export const SCENE_VB = { w: 390, h: 844 } as const;

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }

/** 긴 변(세로) → 프레임 px. 가로는 정수로 반올림 (캔버스 크기) */
export function frameSize(longEdge = DEFAULT_LONG_EDGE): Size {
  const h = Math.round(longEdge);
  return { w: Math.round(h / FRAME_ASPECT), h };
}

/** camera.css:54 `.cam-bg .scene { top:-50%; bottom:-50%; height:200%; width:100% }` — 무대 한 장의 상자 (프레임 좌표) */
export const bgTile = ({ w, h }: Size): Box => ({ x: 0, y: -h / 2, w, h: 2 * h });

/**
 * camera.css:55-57 — 가운데 한 장, 양옆은 거울처럼 뒤집어 한 장씩. 각 항목은 `<use>`를 감쌀 transform.
 * scaleX(-1)은 자기 상자 가운데 기준이라 상자 자리는 그대로고 그림만 뒤집힌다 → translate로 상자를 옮기고 뒤집는다.
 */
export const bgTransforms = ({ w }: Size): string[] => [
  `scale(-1 1)`,                    // left: -100%  → [-w, 0]
  ``,                               // left: 0
  `translate(${2 * w} 0) scale(-1 1)`, // left: 100% → [w, 2w]
];

/** camera.css:53 `.cam-bg { transform: translateY(calc(var(--pitchn) * -0.55%)) }` — 각도에 따른 무대 패럴랙스 (px) */
export const bgParallax = (pitch: number, { h }: Size): number => -0.0055 * pitch * h;

// ─── 인물 자리 (camera.css:66-73) ─────────────────────────────────────────────
export interface Cast { friend?: boolean; met?: boolean; ghost?: boolean }
export interface CastLayout { me: Box; friend?: Box; met?: Box; ghost?: Box }

/**
 * 캐릭터 svg는 정사각(viewBox 200)이고 CSS width %는 `.cam-shot`(=프레임) 너비, bottom %는 높이 기준.
 * translate(-50%, 9%)는 자기 크기 기준. 그래서 x = left·w − 0.5·size, bottom = h − bottom·h + 0.09·size.
 *   .cam-me     left 50% (has-friend·has-met 39%, 둘 다 44%) bottom 22% width 84% translate(-50%, 9%)
 *   .cam-friend left 56% bottom 20% width 62% translateY(9%)
 *   .cam-met    left 60% bottom 18% width 53% translateY(9%)  (has-friend: right -6% bottom 16%)
 *   .cam-ghost  right -2% bottom 30% width 53%
 */
export function castLayout({ w, h }: Size, cast: Cast): CastLayout {
  const box = (size: number, x: number, bottom: number): Box => ({ x, y: bottom - size, w: size, h: size });
  const me = 0.84 * w;
  const meLeft = cast.friend && cast.met ? 0.44 : cast.friend || cast.met ? 0.39 : 0.5;
  const out: CastLayout = { me: box(me, meLeft * w - 0.5 * me, h - 0.22 * h + 0.09 * me) };
  if (cast.friend) { const s = 0.62 * w; out.friend = box(s, 0.56 * w, h - 0.20 * h + 0.09 * s); }
  if (cast.met) {
    const s = 0.53 * w;
    out.met = cast.friend ? box(s, w + 0.06 * w - s, h - 0.16 * h + 0.09 * s) : box(s, 0.60 * w, h - 0.18 * h + 0.09 * s);
  }
  if (cast.ghost) { const s = 0.53 * w; out.ghost = box(s, w + 0.02 * w - s, h - 0.30 * h); }
  return out;
}
/** camera.css:73 `.cam-ghost { opacity: .35 }` */
export const GHOST_OPACITY = 0.35;

// ─── 크롭 (camera.css:44-47) ──────────────────────────────────────────────────
/** `.cam-shot { transform-origin: 50% 78% }` */
export const CROP_ORIGIN = { x: 0.5, y: 0.78 } as const;

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * `.cam-shot`의 transform을 SVG transform 목록으로. CSS도 SVG도 오른쪽부터 점에 적용되니 순서는 같다:
 *   perspective(560px) rotateX(pitch) rotate(rot) scale(cs) translate(cx%, cy%)  (origin 50% 78%)
 * 각도(rotateX + perspective)는 SVG에 없다 — 평균 효과인 scaleY(cos pitch)만 남기고 사다리꼴(위아래 크기 차)은 버린다.
 * translate %는 자기 크기(프레임) 기준 → px.
 */
export function cropTransform(crop: ShotCrop, { w, h }: Size): string {
  const ox = CROP_ORIGIN.x * w, oy = CROP_ORIGIN.y * h;
  const pitch = crop.pitch ?? 0;
  const sy = Math.cos((pitch * Math.PI) / 180);
  const parts = [
    `translate(${num(ox)} ${num(oy)})`,
    pitch ? `scale(1 ${num(sy)})` : '',
    crop.rot ? `rotate(${num(crop.rot)})` : '',
    crop.scale !== 1 ? `scale(${num(crop.scale)})` : '',
    crop.x || crop.y ? `translate(${num((crop.x / 100) * w)} ${num((crop.y / 100) * h)})` : '',
    `translate(${num(-ox)} ${num(-oy)})`,
  ];
  return parts.filter(Boolean).join(' ');
}

// ─── 심도 (camera.css:53·58) ──────────────────────────────────────────────────
/**
 * 뷰파인더(390×86% = 335×362px)에서 배경 blur 6px·인물 5px. 긴 변 300px 기준으로 옮기면 ≈5·4px — 필름 썸네일의 2.4·2px
 * (camera.css:59-61, ~75px 칸)이 아니라 찍을 때 본 그림을 따른다. 세로가 300이 아니면 비례한다.
 */
export const BLUR_AT_300 = { bg: 5, fg: 4, ghost: 0.5 } as const;
export interface BlurRadii { bg: number; fg: number; ghost: number }
/** feGaussianBlur stdDeviation (CSS blur(σ)와 같은 단위). 초점이 캐릭터(near)면 배경만, 배경(far)이면 인물만 흐리다 */
export function blurRadii(crop: ShotCrop, { h }: Size): BlurRadii {
  const k = h / DEFAULT_LONG_EDGE;
  const dof = crop.dof ?? 0;
  const far = (crop.focus ?? 'near') === 'far';
  const r = (v: number) => Math.round(v * 100) / 100;
  return { bg: r(dof * (far ? 0 : 1) * BLUR_AT_300.bg * k), fg: r(dof * (far ? 1 : 0) * BLUR_AT_300.fg * k), ghost: r(BLUR_AT_300.ghost * k) };
}

/**
 * svg 필터의 색 공간은 기본이 linearRGB — CSS `filter: blur()`는 sRGB에서 섞는다. 필터마다 이걸 안 붙이면 흐린 자리가
 * 라이브보다 눈에 띄게 밝고 흐릿해진다 (헤드리스 Chrome: sRGB면 채널 평균 차 0, linearRGB면 10, 최대 46).
 */
export const FILTER_COLOR_SPACE = 'color-interpolation-filters="sRGB"';
/** <defs>에 들어갈 심도 필터들 — 반지름이 0이면 안 만든다 (bake.tsx가 filter="url(#…)"도 같이 뺀다) */
export function blurFilterDefs(blur: BlurRadii, ghost: boolean): string[] {
  const defs: string[] = [];
  if (blur.bg > 0) defs.push(`<filter id="bgblur" x="-10%" y="-10%" width="120%" height="120%" ${FILTER_COLOR_SPACE}><feGaussianBlur stdDeviation="${num(blur.bg)}"/></filter>`);
  if (blur.fg > 0) defs.push(`<filter id="fgblur" x="-20%" y="-20%" width="140%" height="140%" ${FILTER_COLOR_SPACE}><feGaussianBlur stdDeviation="${num(blur.fg)}"/></filter>`);
  if (ghost) defs.push(`<filter id="ghost" x="-20%" y="-20%" width="140%" height="140%" ${FILTER_COLOR_SPACE}><feColorMatrix type="saturate" values="0"/><feGaussianBlur stdDeviation="${num(blur.ghost)}"/></filter>`);
  return defs;
}

// ─── 조도 (camera.css:43·62-64) ───────────────────────────────────────────────
/** `::before { background: rgb(38 32 84 / (1-light)·.42) }` — 어두우면 푸른 저녁 (보통 합성) */
export const TINT_DARK = { rgb: [38, 32, 84] as const, k: 0.42 };
/** `::after { background: rgb(255 214 120 / (light-1)·.34); mix-blend-mode: multiply }` — 밝으면 노란 햇빛 */
export const TINT_WARM = { rgb: [255, 214, 120] as const, k: 0.34 };
export interface LightTransfer { slope: [number, number, number]; intercept: [number, number, number] }
/**
 * 세 겹(어두운 덮개 → 노란 곱하기 덮개 → brightness)을 채널별 1차식 하나로 접는다:
 *   보통 합성 d1 = (1−a1)·d + a1·c1 ;  곱하기 합성 d2 = d1·(1 − a2·(1−c2)) ;  brightness d3 = light·d2
 * 값은 0..1 (feComponentTransfer type=linear). a1·a2는 light 한쪽에서만 0보다 크다.
 */
export function lightTransfer(light = 1): LightTransfer {
  const a1 = Math.max(0, (1 - light) * TINT_DARK.k);
  const a2 = Math.max(0, (light - 1) * TINT_WARM.k);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  const slope = [0, 1, 2].map(i => r(light * (1 - a2 * (1 - TINT_WARM.rgb[i]! / 255)) * (1 - a1))) as [number, number, number];
  const intercept = [0, 1, 2].map(i => r(light * (1 - a2 * (1 - TINT_WARM.rgb[i]! / 255)) * a1 * (TINT_DARK.rgb[i]! / 255))) as [number, number, number];
  return { slope, intercept };
}
/** 조도가 1이면 필터가 항등이다 — 그때는 filter 속성을 아예 안 붙인다 */
export const isIdentityLight = (t: LightTransfer) => t.slope.every(v => v === 1) && t.intercept.every(v => v === 0);
/** 조도 필터 <defs> 항목 — 프레임 전체(userSpaceOnUse)에, sRGB로. 항등이면 null */
export function lightFilterDef(light: LightTransfer, { w, h }: Size): string | null {
  if (isIdentityLight(light)) return null;
  const fn = (ch: 'R' | 'G' | 'B', i: number) => `<feFunc${ch} type="linear" slope="${light.slope[i]}" intercept="${light.intercept[i]}"/>`;
  return `<filter id="light" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" ${FILTER_COLOR_SPACE}><feComponentTransfer>${fn('R', 0)}${fn('G', 1)}${fn('B', 2)}</feComponentTransfer></filter>`;
}

// ─── id ──────────────────────────────────────────────────────────────────────
/** 미디어 id — 32자 hex (CONTRACT §2.5 `^[0-9a-f]{32}$`). 찍는 순간 폰이 정한다 */
export function newShotId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export const isShotId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

// ─── 파일 크기 정책 (ADR-0020: WebP ≤ 60 KB) ─────────────────────────────────
export const MAX_BYTES = 60 * 1024;
export const DEFAULT_QUALITY = 0.82;
/** 넘치면 한 번 품질을 낮추고, 그래도 넘치면 긴 변을 260으로 */
export const FALLBACK_QUALITY = 0.62;
export const FALLBACK_LONG_EDGE = 260;
export interface BakeAttempt { longEdge: number; quality: number }
/** 시도 순서 — 첫 시도가 상한 안이면 거기서 멈춘다 */
export function bakeAttempts(longEdge = DEFAULT_LONG_EDGE, quality = DEFAULT_QUALITY): BakeAttempt[] {
  const q2 = Math.min(quality, FALLBACK_QUALITY);
  return [{ longEdge, quality }, { longEdge, quality: q2 }, { longEdge: Math.min(longEdge, FALLBACK_LONG_EDGE), quality: q2 }];
}
/**
 * PNG(WebP를 못 만드는 브라우저)는 품질 눈금이 없어 긴 변만 줄일 수 있다. 흐린 인물 컷(dof .7·focus far)이 300px에서 ≈100 KB,
 * 260에서 ≈80 KB라 220(≈57 KB)·180(≈38 KB)까지 내려간다. 첫 시도에서 PNG로 떨어진 걸 안 뒤의 남은 시도 순서
 */
export const PNG_LONG_EDGES = [260, 220, 180] as const;
export function pngAttempts(longEdge: number): BakeAttempt[] {
  return PNG_LONG_EDGES.filter(e => e < longEdge).map(e => ({ longEdge: e, quality: 1 }));
}
