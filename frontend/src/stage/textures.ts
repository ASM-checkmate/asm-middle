// ─── 무대·캐릭터 그림을 텍스처(캔버스)로 굽기 (ADR-0014 개정) ─────────────────
// SVG 무대(scenes)와 캐릭터(character)를 떼어 둔 React 루트에 그려 문자열로 뽑고 <img>로 읽어 2D 캔버스에 그린다. <img> 안의 SVG는 바깥 스타일시트를 못 보니
// 토큰·무대 CSS를 <style>로 박아 넣고, 층은 같은 마크업에서 다른 층을 display:none으로 지워 4번 굽는다. 장소 유형·인물별로 한 번만.
// 글꼴(Jua)은 <img> 안에서 못 내려받아 간판 글자는 기본 글꼴로 찍힌다.
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Scene, sceneTypeFor } from '../scenes';
import { Character } from '../character';
import type { Pose } from '../character/Character';
import type { Variant } from '../character/shapes';
import type { PlaceType } from '../sim/types';
import { LAYERS } from '../sim/stage';
import type { LayerName } from '../sim/stage';
import scenesCss from '../scenes/scenes.css?raw';
import tokensCss from '../theme/tokens.css?raw';

/** 무대 텍스처는 무대보다 넓다: viewBox x -195..585 (±1 W) — 카메라가 돌거나 끌어도 끝이 안 보인다. 그 밖은 거울 반복(render.ts) */
export const SCENE_TEX_LEFT = -195;
export const SCENE_TEX_VW = 780;
/** 층별 해상도 배율 — 넓은 벽·바닥은 1.5×, 소품이 있는 mid·front는 2× (장소당 ≈ 24 MB) */
const LAYER_SCALE: Record<LayerName, number> = { far: 1.5, mid: 2, floor: 1.5, front: 2 };
/** 무대 캐시 상한 — 넘으면 오래된 장소를 버린다 (GPU 텍스처는 onEvict로 render.ts가 지운다) */
const SCENE_CACHE_MAX = 3;
const evictListeners: ((canvases: HTMLCanvasElement[]) => void)[] = [];
export const onSceneEvict = (fn: (canvases: HTMLCanvasElement[]) => void): void => { evictListeners.push(fn); };
/** 캐릭터 텍스처 한 변 (뷰파인더의 캐릭터 ≈ 300 CSS px × DPR 2) */
export const CAST_TEX = 640;

const XMLNS = 'http://www.w3.org/2000/svg';

/** 컴포넌트를 떼어 둔 루트에 그려 SVG 문자열로 (react-dom/server 없이 — 그 번들은 크다). XMLSerializer가 xmlns를 붙인다 */
function markupOf(el: ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(el));
  const svg = host.querySelector('svg');
  const out = svg ? new XMLSerializer().serializeToString(svg) : '';
  root.unmount();
  return out;
}

function withStyle(svg: string, css: string, width: number, height: number): string {
  const end = svg.indexOf('>');
  const open = svg.slice(0, end).replace(/\s(width|height)="[^"]*"/g, '');
  const ns = open.includes('xmlns=') ? '' : ` xmlns="${XMLNS}"`;
  return `${open}${ns} width="${width}" height="${height}"><style><![CDATA[${css}]]></style>${svg.slice(end + 1)}`;
}

function rasterize(svg: string, w: number, h: number, before?: (ctx: CanvasRenderingContext2D) => void): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('2d context')); return; }
      before?.(ctx);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg raster')); };
    img.src = url;
  });
}

const sceneCache = new Map<string, Promise<HTMLCanvasElement[]>>();
/** 장소 유형의 층 4장 (LAYERS 순서) */
export function sceneLayers(type: PlaceType): Promise<HTMLCanvasElement[]> {
  const t = sceneTypeFor(type);
  let p = sceneCache.get(t);
  if (!p) {
    const markup = markupOf(createElement(Scene, { type: t, className: 'scene--still' })).replace('viewBox="0 0 390 844"', `viewBox="${SCENE_TEX_LEFT} 0 ${SCENE_TEX_VW} 844"`);
    p = Promise.all(LAYERS.map((layer: LayerName) => {
      const css = `${tokensCss}\n${scenesCss}\n.sc-l{display:none}.sc-${layer}{display:inline}`;
      const k = LAYER_SCALE[layer], w = Math.round(SCENE_TEX_VW * k), h = Math.round(844 * k);
      return rasterize(withStyle(markup, css, w, h), w, h);
    }));
    sceneCache.set(t, p);
    p.catch(() => sceneCache.delete(t));
    if (sceneCache.size > SCENE_CACHE_MAX) {
      const oldest = sceneCache.keys().next().value as string;
      const gone = sceneCache.get(oldest);
      sceneCache.delete(oldest);
      gone?.then(cs => evictListeners.forEach(fn => fn(cs))).catch(() => {});
    }
  }
  return p;
}

export interface CastSpec { pose: Pose; variant: Variant; color?: string; ghost?: boolean }
const castCache = new Map<string, Promise<HTMLCanvasElement>>();
/** 인물 한 장 (정지). ghost는 회색·반투명 실루엣 (camera.css .cam-ghost) */
export function castSprite(spec: CastSpec): Promise<HTMLCanvasElement> {
  const key = `${spec.pose}|${spec.variant}|${spec.color ?? ''}|${spec.ghost ? 'g' : ''}`;
  let p = castCache.get(key);
  if (!p) {
    const markup = markupOf(createElement(Character, { pose: spec.pose, size: CAST_TEX, variant: spec.variant, color: spec.color, paused: true }));
    p = rasterize(withStyle(markup, tokensCss, CAST_TEX, CAST_TEX), CAST_TEX, CAST_TEX, spec.ghost ? ctx => {
      ctx.globalAlpha = 0.35;
      try { ctx.filter = 'grayscale(1)'; } catch { /* filter 없는 브라우저 — 반투명만 */ }
    } : undefined);
    castCache.set(key, p);
    p.catch(() => castCache.delete(key));
  }
  return p;
}
