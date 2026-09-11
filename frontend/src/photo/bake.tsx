// ─── 굽기 (ADR-0024 스파이크): 컷 하나를 브라우저에서 픽셀로 ─────────────────────────────────
// 라이브 컷은 HTML+CSS 합성(CameraOverlay ShotStage: .cam-stage > .cam-shot > .cam-bg ×3 + 캐릭터 svg 넷)이라 그대로 캔버스에 못 그린다
// (foreignObject는 WebKit에서 캔버스를 더럽힌다). 그래서 같은 그림을 **독립 svg 하나**로 다시 쓴다: 무대 본체를 <symbol> 하나에 두고
// <use> 세 번(가운데 한 장, 양옆 거울), 캐릭터(나·동행·상대·배경 인물)는 겉모습을 명시해 nested <svg>, 크롭은 <g transform>, 심도는 feGaussianBlur,
// 조도는 feComponentTransfer. 그 svg를 Blob → <img> → canvas → WebP. 숫자는 전부 photo/geometry.ts(순수, node 검사).
import { renderToStaticMarkup } from 'react-dom/server';
import type { Look } from '../sim/types';
import type { ShotCrop } from '../sim/types';
import { Character, type Pose } from '../character';
import { HAIR, SKIN, TOP } from '../character/look';
import { SCENES, type SceneType } from '../scenes';
import {
  DEFAULT_LONG_EDGE, DEFAULT_QUALITY, MAX_BYTES, PRESENT_OPACITY, SCENE_CSS, SCENE_VB, STILL_CSS, TOKEN, TOKEN_VARS,
  bakeAttempts, bgParallax, bgTile, bgTransforms, blurFilterDefs, blurRadii, castLayout, cropTransform, frameSize, isIdentityLight,
  lightFilterDef, lightTransfer, pngAttempts,
  type Box, type Size,
} from './geometry';
import { characterMarkup, sceneMarkup } from './markup';

export { newShotId } from './geometry';

/** 무대 위 다른 사람 하나 — 색, 겉모습(있으면), 슬쩍 돌아봤나(AFFECTION_SPEC §4 — 배경 인물이 뒷모습 대신 3/4 얼굴로) */
export interface BakeFigure { color: string; look?: Look; glance?: boolean }

/** ShotStage의 props를 하나씩 그대로 — friendColor/metColor/present 의미 */
export interface BakeInput {
  type: SceneType;
  pose: Pose;
  crop: ShotCrop;
  /** 내 겉모습 — OwnerLookContext를 절대 안 본다 (굽는 쪽이 명시한다) */
  look: Look;
  /** 동행 (오른쪽 옆에서 손 흔든다) */
  friend?: BakeFigure;
  /** 말을 건 마주침 상대 (앞쪽) — encounter.at 뒤의 컷에만 */
  met?: BakeFigure;
  /** 같은 공간에 있던 사람들 (FRIENDS_SPEC §6): 뒤의 왼쪽·오른쪽에 뒷모습으로 작게, 최대 둘. glance면 돌아본 얼굴 */
  present?: BakeFigure[];
}

export interface BakeSvgOptions { longEdge?: number }
export interface BakeShotOptions extends BakeSvgOptions { quality?: number }
export interface BakedShot {
  blob: Blob;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  svgBytes: number;
  /** 상한(60 KB)에 걸려 품질·크기를 낮췄거나 WebP 대신 PNG로 떨어졌을 때 한 줄 */
  note?: string;
}

/** 시도를 다 해도 60 KB 안에 못 들어온 컷 — 올리면 서버가 413(CONTRACT §2.5)이라 부르는 쪽이 큐에 넣거나 건너뛴다. shot은 마지막 시도 */
export class BakeOversizeError extends Error {
  readonly shot: BakedShot;
  constructor(shot: BakedShot) {
    super(`bake: ${shot.blob.size} B > ${MAX_BYTES} B (${shot.mime}${shot.note ? ` · ${shot.note}` : ''})`);
    this.name = 'BakeOversizeError';
    this.shot = shot;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** 무대 본체 markup — 임시 <svg>로 감싸 렌더하고 markup.ts가 껍데기·글꼴·토큰 변수를 손질한다 */
function sceneBody(type: SceneType): string {
  const Body = SCENES[type];
  return sceneMarkup(renderToStaticMarkup(<svg><Body /></svg>), TOKEN_VARS);
}

/**
 * 캐릭터 한 명을 nested <svg>로. Character는 색을 CSS 변수(var(--ch-skin, …)·var(--friend, …))로 쓰는데 <img>-svg 안에서도
 * 대체로 되지만, 결정적이고 이식 가능하게 리터럴로 바꿔 넣는다(markup.ts) — 겉모습이 있으면 그 색, 없으면 var()의 기본값(모모).
 * OwnerLookContext는 renderToStaticMarkup 밖이라 비어 있다 — look은 여기서만 정해진다. 자세는 STILL_CSS가 0 % 키프레임에 세운다.
 */
function characterSvg(box: Box, pose: Pose, variant: 'me' | 'friend', look: Look | undefined, color?: string, view: { back?: boolean; glance?: boolean } = {}): string {
  const raw = renderToStaticMarkup(<Character pose={pose} size={200} variant={variant} look={look} color={color} back={view.back} glance={view.glance} paused />);
  const inner = characterMarkup(raw, { skin: look && SKIN[look.skin], hair: look && HAIR[look.hairColor], top: look && TOP[look.top], color });
  return `<svg x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" viewBox="0 0 200 200" overflow="visible">${inner}</svg>`;
}

/**
 * 순수·결정적: 같은 입력이면 같은 문자열. 프레임 비율 1/1.08, 긴 변(세로) 기본 300.
 * 구조: <defs>(무대 symbol · 필터) + <style>(scenes.css를 hex로 · 캐릭터 정지 자세) + [조도 필터 g] > 종이색 바탕 + [크롭 g] > 무대 ×3 · 배경 인물 · 동행 · 나 · 상대
 */
export function bakeSvg(input: BakeInput, opts: BakeSvgOptions = {}): string {
  const size: Size = frameSize(opts.longEdge ?? DEFAULT_LONG_EDGE);
  const { w, h } = size;
  const present = input.present ?? [];
  const cast = { friend: !!input.friend, met: !!input.met, present: present.length };
  const lay = castLayout(size, cast);
  const blur = blurRadii(input.crop, size);
  const light = lightTransfer(input.crop.light ?? 1);
  const tile = bgTile(size);

  // 필터는 전부 sRGB(geometry.ts FILTER_COLOR_SPACE) — CSS filter와 같은 색 공간. 실루엣 필터(ghost)는 이제 안 쓴다
  const defs: string[] = [
    `<symbol id="sc" viewBox="0 0 ${SCENE_VB.w} ${SCENE_VB.h}" preserveAspectRatio="xMidYMid slice">${sceneBody(input.type)}</symbol>`,
    ...blurFilterDefs(blur, false),
  ];
  const lightDef = lightFilterDef(light, size);
  if (lightDef) defs.push(lightDef);

  const useTile = `<use href="#sc" x="${num(tile.x)}" y="${num(tile.y)}" width="${num(tile.w)}" height="${num(tile.h)}"/>`;
  const bg = bgTransforms(size).map(t => (t ? `<g transform="${t}">${useTile}</g>` : useTile)).join('');
  const parallax = bgParallax(input.crop.pitch ?? 0, size);
  const bgAttrs = [parallax ? `transform="translate(0 ${num(parallax)})"` : '', blur.bg > 0 ? 'filter="url(#bgblur)"' : ''].filter(Boolean).join(' ');

  const fg = (s: string) => (blur.fg > 0 ? `<g filter="url(#fgblur)">${s}</g>` : s);
  const people: string[] = [];
  // 배경 인물은 무대와 같은 흐림(bgblur) — 뒤에 있다는 게 심도로 읽힌다 (camera.css .cam-present). 뒷모습, 돌아봤으면 3/4 얼굴
  lay.present.forEach((box, i) => {
    const p = present[i]!;
    const body = characterSvg(box, 'idle', 'friend', p.look, p.color, p.glance ? { glance: true } : { back: true });
    people.push(`<g opacity="${PRESENT_OPACITY}"${blur.bg > 0 ? ' filter="url(#bgblur)"' : ''}>${body}</g>`);
  });
  if (lay.friend && input.friend) people.push(fg(characterSvg(lay.friend, 'wave', 'friend', input.friend.look, input.friend.color, { glance: input.friend.glance })));
  people.push(fg(characterSvg(lay.me, input.pose, 'me', input.look)));
  if (lay.met && input.met) people.push(fg(characterSvg(lay.met, 'wave', 'friend', input.met.look, input.met.color, { glance: input.met.glance })));

  const shot = `<g transform="${cropTransform(input.crop, size)}"><g ${bgAttrs}>${bg}</g>${people.join('')}</g>`;
  const stage = `<rect width="${w}" height="${h}" fill="${TOKEN.paper2}"/>${shot}`;
  const body = isIdentityLight(light) ? stage : `<g filter="url(#light)">${stage}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc('구운 컷')}">`
    + `<defs>${defs.join('')}</defs><style>${SCENE_CSS}${STILL_CSS}</style>${body}</svg>`;
}

/** svg 문자열 → 그려진 <img> (Blob URL — data: 보다 크기 제한이 없다) */
function loadSvg(svg: string): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bake: svg image failed to load')); };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('bake: canvas.toBlob returned null'))), mime, quality));
}

/**
 * 컷을 굽는다: bakeSvg → Blob → <img> → canvas.drawImage → toBlob('image/webp'). WebP를 못 만드는 브라우저(Safari)는 PNG로 떨어지고
 * mime에 그대로 적힌다. 60 KB를 넘으면 품질을 한 번 낮추고, 그래도 넘으면 긴 변을 260으로 — 무엇을 했는지 note에.
 * PNG는 품질 눈금이 없으니 대신 긴 변을 260 → 220 → 180으로(pngAttempts). 그래도 넘으면 BakeOversizeError — 서버가 413을 줄 몸은 안 돌려준다.
 */
export async function bakeShot(input: BakeInput, opts: BakeShotOptions = {}): Promise<BakedShot> {
  if (typeof document === 'undefined') throw new Error('bake needs a browser');
  const notes: string[] = [];
  const queue = bakeAttempts(opts.longEdge ?? DEFAULT_LONG_EDGE, opts.quality ?? DEFAULT_QUALITY);
  let last: BakedShot | null = null;
  while (queue.length) {
    const step = queue.shift()!;
    const svg = bakeSvg(input, { longEdge: step.longEdge });
    const { w, h } = frameSize(step.longEdge);
    const { img, release } = await loadSvg(svg);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('bake: no 2d context');
      ctx.drawImage(img, 0, 0, w, h);
      let blob = await toBlob(canvas, 'image/webp', step.quality);
      let mime: BakedShot['mime'] = 'image/webp';
      if (blob.type !== 'image/webp') {
        blob = await toBlob(canvas, 'image/png', 1);
        mime = 'image/png';
        // 처음 PNG로 떨어진 순간 남은 시도를 PNG 사다리로 바꾼다 (품질 단계는 PNG에 아무 뜻이 없다)
        if (!notes.includes('png')) { notes.push('png'); queue.splice(0, queue.length, ...pngAttempts(step.longEdge)); }
      }
      last = { blob, mime, width: w, height: h, svgBytes: new TextEncoder().encode(svg).length };
    } finally { release(); }
    if (last.blob.size <= MAX_BYTES) break;
    notes.push(`${step.longEdge}px q${step.quality} → ${last.blob.size} B`);
  }
  if (!last) throw new Error('bake: no attempt ran');
  if (notes.length) last.note = notes.join(' · ');
  if (last.blob.size > MAX_BYTES) throw new BakeOversizeError(last);
  return last;
}
