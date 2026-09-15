import type { ShotFigure } from './types';
import demo from './backdrops.demo.json' with { type: 'json' };

// ─── AI 배경 (ADR-0029) ────────────────────────────────────────────────────────
// 가게마다 "사진 찍을 만한 자리"(spot) 몇 장 — 실사에 가까운 애니 배경, 사람 없음, 캐릭터가 설/앉을 빈 자리가 있다.
// 지금은 손으로 만든 데모 묶음(`public/backdrops/manifest.json`, scripts/nano-banana.mjs + art/backdrops/manifest.json)이고,
// 나중엔 서버가 이동 중에 Google Places 사진 → 비전 선별 → 생성해 같은 모양으로 준다. 레지스트리는 메모리 하나 — 앱이 부팅할 때
// 데모 묶음(backdrops.demo.json = public/backdrops/manifest.json 사본)은 모듈이 뜰 때 등록되고, 서버 묶음은 loadBackdrops로 더한다.

export interface Backdrop {
  id: string;
  placeId: string;
  /** 자리 이름 — 앨범의 "어디서" ("창가 자리", "정원", "입구") */
  spot: string;
  /** 그림 URL (같은 origin) */
  url: string;
  /** 이 자리는 앉는 자리 — 카메라가 기본 자세를 'sit'으로 연다 */
  sit?: boolean;
  /** 내 캐릭터의 기본 자리·크기 (카메라가 여기서 시작한다) */
  me: ShotFigure;
  /** 동행의 기본 자리 (동행이 있을 때) */
  friend?: ShotFigure;
  /** 방의 어느 트리거 존에서 찍는가 (Room Zone.key, 개정 3). 없으면 어느 존에 서든 뜬다 — 그 장소의 방이 손 존을 안 잡았을 때 */
  zone?: string;
}

const registry = new Map<string, Backdrop>();
const byPlace = new Map<string, Backdrop[]>();

const isFigure = (v: unknown): v is ShotFigure => {
  const f = v as Partial<ShotFigure> | null;
  return !!f && Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.scale) && (f.pose === undefined || typeof f.pose === 'string');
};
const isBackdrop = (v: unknown): v is Backdrop => {
  const b = v as Partial<Backdrop> | null;
  return !!b && typeof b.id === 'string' && typeof b.placeId === 'string' && typeof b.spot === 'string' && typeof b.url === 'string'
    && isFigure(b.me) && (b.friend === undefined || isFigure(b.friend)) && (b.sit === undefined || typeof b.sit === 'boolean')
    && (b.zone === undefined || typeof b.zone === 'string');
};

/** 레지스트리에 넣는다 (같은 id는 덮는다). 모양이 틀린 항목은 버린다 */
export function registerBackdrops(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const b of list) {
    if (!isBackdrop(b)) continue;
    registry.set(b.id, b);
    const arr = byPlace.get(b.placeId) ?? [];
    const i = arr.findIndex(x => x.id === b.id);
    if (i >= 0) arr[i] = b; else arr.push(b);
    byPlace.set(b.placeId, arr);
    n++;
  }
  return n;
}

export const backdropById = (id: string | undefined | null): Backdrop | undefined => (id ? registry.get(id) : undefined);
export const backdropsFor = (placeId: string): Backdrop[] => byPlace.get(placeId) ?? [];
/** 하네스용 */
export function clearBackdrops() { registry.clear(); byPlace.clear(); }

// 데모 묶음은 모듈이 뜰 때 동기로 등록한다 — 스토어가 부팅하며 끝난 활동을 정산(settle → makeComic)할 때 이미 있어야 에이전트 컷이 배경을 얻는다.
// (fetch로 받으면 정산이 먼저 돌아 배경 없는 앨범이 굳는다.) 서버 배경은 이동 중에 받아 registerBackdrops로 더한다 — endAt 전이면 늦지 않다
registerBackdrops((demo as { backdrops: unknown }).backdrops);

/** 서버 배경 묶음을 더 받는다 (브라우저에서만). 실패해도 앱은 돈다 — 배경 없는 장소처럼 */
export function loadBackdrops(url: string): Promise<number> {
  if (typeof fetch !== 'function' || typeof window === 'undefined') return Promise.resolve(0);
  return fetch(url).then(r => (r.ok ? r.json() : null)).then(j => registerBackdrops(j?.backdrops ?? j)).catch(() => 0);
}

/** 배경 그림을 data URL로 — 굽기(photo/bake)가 svg 안의 <image>에 넣는다. 한 번 받으면 이 탭이 사는 동안 기억한다 */
const dataUrls = new Map<string, Promise<string>>();
export function backdropDataUrl(b: Backdrop): Promise<string> {
  let p = dataUrls.get(b.id);
  if (!p) {
    p = fetch(b.url).then(r => { if (!r.ok) throw new Error(`backdrop ${b.id}: ${r.status}`); return r.blob(); }).then(blob => new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('backdrop: read failed'));
      fr.readAsDataURL(blob);
    }));
    p.catch(() => dataUrls.delete(b.id));
    dataUrls.set(b.id, p);
  }
  return p;
}

/** 배경 없는 장소의 기본 자리 — camera.css `.cam-me`(가운데, 발이 78 % 높이, 폭 84 %)와 같다. 동행이 있으면 둘이 나눠 선다 */
export const DEFAULT_ME: ShotFigure = { x: 50, y: 78, scale: 0.84 };
export const DEFAULT_ME_WITH_FRIEND: ShotFigure = { x: 39, y: 78, scale: 0.84 };
export const DEFAULT_FRIEND: ShotFigure = { x: 87, y: 80, scale: 0.62 };
