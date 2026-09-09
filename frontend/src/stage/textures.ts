// ─── 무대·캐릭터 그림을 텍스처(캔버스)로 굽기 (ADR-0014 개정 2) ─────────────
// SVG 무대(scenes)를 문서 밖의 React 루트에 그려 소품(.sc-p)의 상자를 재고, 문자열로 뽑아 <img>로 읽어 캔버스에 그린다.
// <img> 안의 SVG는 바깥 스타일시트를 못 보니 토큰·무대 CSS를 <style>로 박고, 보일 것만 남기고 나머지는 display:none으로 지운다.
//   backdrop — 소품을 뺀 무대 전체(벽·하늘·바닥)  · ground — 바닥 층만  · props — 소품 하나씩, 자기 상자 크기로 (작다)
// 장소 유형·인물별로 한 번만 굽고, 장소는 3개까지만 들고 있는다. 글꼴(Jua)은 <img> 안에서 못 내려받아 간판 글자는 기본 글꼴이다.
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SCENE_FLOOR_Y, Scene, sceneTypeFor } from '../scenes';
import type { SceneType } from '../scenes';
import { Character } from '../character';
import type { Pose } from '../character/Character';
import type { Variant } from '../character/shapes';
import type { PlaceType } from '../sim/types';
import { STAGE_H, TEX_LEFT, TEX_W } from '../sim/stage';
import scenesCss from '../scenes/scenes.css?raw';
import tokensCss from '../theme/tokens.css?raw';

/** 뒷막·바닥 해상도 배율 (넓은 텍스처 780×844 기준) — 바닥은 카메라 가까이서 크게 보이니 2× */
const BACKDROP_SCALE = 1.5;
const GROUND_SCALE = 2;
/** 소품 해상도 배율 (자기 상자 기준) */
const PROP_SCALE = 2;
/** 소품 상자 여백 (선 굵기·그림자) */
const PROP_PAD = 8;
/** 캐릭터 텍스처 한 변 (뷰파인더의 캐릭터 ≈ 300 CSS px × DPR 2) */
export const CAST_TEX = 640;
/** 무대 캐시 상한 — 넘으면 오래된 장소를 버린다 (GPU 텍스처는 onEvict로 render.ts가 지운다) */
const SCENE_CACHE_MAX = 3;

const XMLNS = 'http://www.w3.org/2000/svg';

export interface PropSprite {
  /** 상자 (그림 좌표, 여백 포함) */
  x0: number; y0: number; x1: number; y1: number;
  /** 바닥 접점 행 — 소품 카드가 서는 깊이 */
  base: number;
  /** 바닥에 눕는 것(러그·돗자리) */
  lie: boolean;
  /** 시간표 말풍선 아래 소품(.sc-top) — hush면 뺀다 */
  top: boolean;
  canvas: HTMLCanvasElement;
}
export interface SceneSet {
  /** 그림의 바닥 경계선 행 (SCENE_FLOOR_Y) */
  floorY: number;
  backdrop: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  props: PropSprite[];
  /** 지울 때 한꺼번에 */
  all: HTMLCanvasElement[];
}

interface Mounted { svg: string; props: { x0: number; y0: number; x1: number; y1: number; base: number; lie: boolean; top: boolean }[] }

/** 컴포넌트를 문서 밖(보이지 않는) 루트에 그려 SVG 문자열과 소품 상자를 얻는다. getBBox는 문서에 붙어 있어야 잰다 */
function mount(el: ReactElement, measureProps: boolean): Mounted {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:844px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(el));
    const svg = host.querySelector('svg');
    const props: Mounted['props'] = [];
    if (svg && measureProps) {
      svg.querySelectorAll<SVGGElement>('.sc-p').forEach((g, i) => {
        g.setAttribute('data-p', String(i));
        const b = g.getBBox();
        props.push({ x0: b.x - PROP_PAD, y0: b.y - PROP_PAD, x1: b.x + b.width + PROP_PAD, y1: b.y + b.height + PROP_PAD, base: Number(g.dataset.base ?? b.y + b.height), lie: g.dataset.lie === '1', top: g.classList.contains('sc-top') || !!g.querySelector('.sc-top') });
      });
    }
    return { svg: svg ? new XMLSerializer().serializeToString(svg) : '', props };
  } finally {
    root.unmount();
    host.remove();
  }
}

function withStyle(svg: string, css: string, width: number, height: number, viewBox?: string): string {
  const end = svg.indexOf('>');
  let open = svg.slice(0, end).replace(/\s(width|height)="[^"]*"/g, '');
  if (viewBox) open = open.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
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

const BASE_CSS = `${tokensCss}\n${scenesCss}\n`;
const sceneCache = new Map<string, Promise<SceneSet>>();
const evictListeners: ((canvases: HTMLCanvasElement[]) => void)[] = [];
export const onSceneEvict = (fn: (canvases: HTMLCanvasElement[]) => void): void => { evictListeners.push(fn); };

/** 장소 유형의 세트: 뒷막 · 바닥 · 소품들. hush = 시간표 말풍선 아래 소품(.sc-top)을 뺀 판 (따로 캐시) */
export function sceneSet(type: PlaceType | SceneType, hush = false): Promise<SceneSet> {
  const t = sceneTypeFor(type);
  const key = hush ? `${t}|hush` : t;
  let p = sceneCache.get(key);
  if (!p) {
    p = (async () => {
      const m = mount(createElement(Scene, { type: t, className: `scene--still${hush ? ' scene--hush' : ''}` }), true);
      const wideBox = `${TEX_LEFT} 0 ${TEX_W} ${STAGE_H}`;
      const bw = Math.round(TEX_W * BACKDROP_SCALE), bh = Math.round(STAGE_H * BACKDROP_SCALE);
      const gw = Math.round(TEX_W * GROUND_SCALE), gh = Math.round(STAGE_H * GROUND_SCALE);
      const [backdrop, ground, ...props] = await Promise.all([
        rasterize(withStyle(m.svg, `${BASE_CSS}.sc-p{display:none}${hush ? '.sc-top{display:none}' : ''}`, bw, bh, wideBox), bw, bh),
        rasterize(withStyle(m.svg, `${BASE_CSS}.sc-far,.sc-p{display:none}`, gw, gh, wideBox), gw, gh),
        ...m.props.map((b, i) => {
          const w = Math.round((b.x1 - b.x0) * PROP_SCALE), h = Math.round((b.y1 - b.y0) * PROP_SCALE);
          const css = `${BASE_CSS}.sc-far,.sc-floor,.sc-p{display:none}.sc-p[data-p="${i}"]{display:inline}`;
          return rasterize(withStyle(m.svg, css, w, h, `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`), w, h);
        }),
      ]);
      const sprites: PropSprite[] = m.props.map((b, i) => ({ ...b, canvas: props[i]! }));
      return { floorY: SCENE_FLOOR_Y[t], backdrop, ground, props: sprites, all: [backdrop, ground, ...props] };
    })();
    sceneCache.set(key, p);
    p.catch(() => sceneCache.delete(key));
    if (sceneCache.size > SCENE_CACHE_MAX) {
      const oldest = sceneCache.keys().next().value as string;
      const gone = sceneCache.get(oldest);
      sceneCache.delete(oldest);
      gone?.then(s => evictListeners.forEach(fn => fn(s.all))).catch(() => {});
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
    const m = mount(createElement(Character, { pose: spec.pose, size: CAST_TEX, variant: spec.variant, color: spec.color, paused: true }), false);
    p = rasterize(withStyle(m.svg, tokensCss, CAST_TEX, CAST_TEX), CAST_TEX, CAST_TEX, spec.ghost ? ctx => {
      ctx.globalAlpha = 0.35;
      try { ctx.filter = 'grayscale(1)'; } catch { /* filter 없는 브라우저 — 반투명만 */ }
    } : undefined);
    castCache.set(key, p);
    p.catch(() => castCache.delete(key));
  }
  return p;
}

/** 바닥 그림자 (부드러운 타원) — 세운 소품·인물 발밑 */
let shadowCanvas: HTMLCanvasElement | null = null;
export function shadowSprite(): HTMLCanvasElement {
  if (!shadowCanvas) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(42,33,24,0.9)');
      g.addColorStop(0.55, 'rgba(42,33,24,0.45)');
      g.addColorStop(1, 'rgba(42,33,24,0)');
      ctx.scale(1, 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    shadowCanvas = c;
  }
  return shadowCanvas;
}
