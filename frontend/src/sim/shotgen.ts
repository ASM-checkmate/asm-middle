// ─── 컷 화풍 생성 (ADR-0029 결정 6, CONTRACT §2.6) ────────────────────────────────
// 셔터 뒤: 단순 합성본(크게) + 캐릭터 투명 PNG를 서버에 보내고, 배경 화풍으로 캐릭터를 다시 그린 새 media id를 받아 샷·앨범의 참조를
// 바꾼다(store.replaceShotId). 그동안 샷은 gen 'pending'(폴라로이드 현상 중), 실패하면 'plain' — 단순 합성본이 그대로 사진이다.
// 서버가 없거나 사용자가 없으면(오프라인) 그냥 plain. 폰 캐시에 없는 새 id는 PhotoImg가 GET /api/media/{id}로 받는다.
import { ApiError, api, currentUser } from './api';
import { useWorld } from './store';
import type { Look, ShotPose } from './types';
import { bakeComposite, bakeFigure, type BakeInput } from '../photo/bake';

/** Gemini가 수십 초 걸린다 — 서버 timeout 90s + 여유 */
export const SHOTGEN_TIMEOUT_MS = 120_000;

export interface ShotGenMeta {
  place: string;
  spot?: string;
  sit?: boolean;
  mePose?: ShotPose;
  friendPose?: ShotPose;
  friendLook?: Look;
  friendColor?: string;
  backdrop: boolean;
}
interface Pic { mime: string; data: string }
interface Response { shotId: string; mime: string; bytes: number; ms: number }

/** data URL → Pic (배경 원본은 이미 data URL로 들고 있다 — sim/backdrops backdropDataUrl) */
const dataUrlPic = (url: string): Pic => { const i = url.indexOf(','); const m = /^data:([^;,]+)/.exec(url); return { mime: m?.[1] ?? 'image/webp', data: url.slice(i + 1) }; };
const b64 = (blob: Blob): Promise<Pic> => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => { const s = String(fr.result); res({ mime: blob.type, data: s.slice(s.indexOf(',') + 1) }); };
  fr.onerror = () => rej(new Error('shotgen: read failed'));
  fr.readAsDataURL(blob);
});

/**
 * 한 컷의 생성을 요청한다. 끝나면 스토어를 직접 고친다 — 부르는 쪽(카메라)은 닫혀도 된다.
 * @returns 새 shotId, 실패면 null
 */
export async function requestShotGen(shotId: string, input: BakeInput, meta: ShotGenMeta): Promise<string | null> {
  const st = useWorld.getState();
  // 서버 사용자가 없으면(오프라인으로 시작) 생성이 없다 — 바로 plain, 콘솔에 이유
  if (!currentUser()) { console.info(`shotgen: 로그인한 사용자가 없어 생성을 건너뛴다 (${shotId})`); st.setShotGen(shotId, 'plain'); return null; }
  st.setShotGen(shotId, 'pending');
  try {
    // AI 배경이 있으면 배경 원본 + 캐릭터 + 자리(%)만 (합성본 없이 — A/B에서 더 자연스러웠다). SVG 무대면 합성본이 앵커
    const byText = !!input.backdrop && !!input.me;
    const [anchor, me, friend] = await Promise.all([
      byText ? Promise.resolve(dataUrlPic(input.backdrop!)) : bakeComposite(input).then(b64),
      bakeFigure(input.look, 'me').then(b64),
      meta.friendColor ? bakeFigure(meta.friendLook ?? input.look, 'friend', meta.friendColor).then(b64) : Promise.resolve(undefined),
    ]);
    const pos = (f: { x: number; y: number; scale: number } | undefined) => (f ? { x: f.x, y: f.y, scale: f.scale } : undefined);
    const body = {
      ...(byText ? { background: anchor, mePos: pos(input.me), friendPos: pos(input.friendPos) } : { composite: anchor }),
      me, ...(friend ? { friend } : {}), place: meta.place, spot: meta.spot, sit: !!meta.sit, mePose: meta.mePose, friendPose: meta.friendPose, backdrop: meta.backdrop,
    };
    // 서버가 502(모델 속도 제한 등)면 한 번 더 — Gemini 429는 잠깐이면 풀린다
    let r: Response;
    try {
      r = await api<Response>(`/api/shots/${shotId}/generate`, { method: 'POST', body, timeoutMs: SHOTGEN_TIMEOUT_MS });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 502) throw e;
      console.info(`shotgen: 서버가 502 — 20초 뒤 한 번 더 (${shotId})`);
      await new Promise(res => setTimeout(res, 20_000));
      r = await api<Response>(`/api/shots/${shotId}/generate`, { method: 'POST', body, timeoutMs: SHOTGEN_TIMEOUT_MS });
    }
    if (!r || typeof r.shotId !== 'string') throw new Error('shotgen: bad response');
    useWorld.getState().replaceShotId(shotId, r.shotId);
    return r.shotId;
  } catch (e) {
    console.warn(`shotgen: 생성 실패 — 단순 합성본 그대로 (${shotId})`, e);
    useWorld.getState().setShotGen(shotId, 'plain');
    return null;
  }
}
