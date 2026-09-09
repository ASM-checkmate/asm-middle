// ─── 활동 화면의 3D 무대 (ADR-0014 개정 4) ─────────────────────────────────
// 카메라와 같은 세트(뒷막·눕힌 바닥·3D 소품)를 무대 전체(390×844)로 본다 — 기본 각도에서는 2D 무대 그대로. 카메라가 천천히 숨 쉬듯
// 흔들려(yaw ±4° · pitch ±2°) 정지 화면에서도 입체가 보인다. 인물(.act-chara/.act-friend/.act-met/.act-ghost)은 DOM 그대로 살아 움직이고,
// 발 자리를 캐릭터 평면(z 0)의 월드 점으로 잡아 프레임마다 투영해 `translate`로 따라간다(그림·breathe 애니메이션의 transform과 따로 합쳐진다).
// 준비 전·WebGL 없음·움직임 줄이기에서는 2D Scene 그대로(흔들림 없음).
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Pose } from '../character';
import type { PlaceType } from '../sim/types';
import { STAGE_H, STAGE_W, frameOfCol, frameOfRow, hitVertical, rayFromFrame } from '../sim/stage';
import type { StageCrop, Vec3 } from '../sim/stage';
import { Scene } from '../scenes';
import { Stage3D } from './Stage3D';
import type { Projector } from './Stage3D';

/** 무대 전체를 보는 crop: zoom 0.5 = 세로 844행 */
const FULL: StageCrop = { scale: 0.5, x: 0, y: 0, rot: 0, pitch: 0, yaw: 0 };
const YAW_AMP = 4, PITCH_AMP = 2, YAW_PERIOD = 9000, PITCH_PERIOD = 13000;
const CAST = '.act-chara, .act-friend, .act-met, .act-ghost';

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

interface Anchor { el: HTMLElement; world: Vec3; rest: [number, number] }

export function ActivityStage({ type, pose, root }: { type: PlaceType; pose: Pose; root: RefObject<HTMLDivElement | null> }) {
  const [crop, setCrop] = useState<StageCrop>(FULL);
  const anchors = useRef<Anchor[] | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  // 숨 쉬는 카메라 — 24 fps, 움직임 줄이기면 정지
  useEffect(() => {
    if (reduced()) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / 24) return;
      last = now;
      const t = now - t0;
      const yaw = Math.round(YAW_AMP * Math.sin((t / YAW_PERIOD) * Math.PI * 2) * 10) / 10;
      const pitch = Math.round(PITCH_AMP * Math.sin((t / PITCH_PERIOD) * Math.PI * 2 + 1) * 10) / 10;
      setCrop(c => (c.yaw === yaw && c.pitch === pitch ? c : { ...c, yaw, pitch }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 인물의 발 자리를 잰다 (transform을 뺀 레이아웃 상자) → 무대 좌표 → 캐릭터 평면의 월드 점
  const measure = (w: number, h: number): Anchor[] => {
    const host = root.current;
    if (!host) return [];
    const k = h / STAGE_H;   // 세로 844행이 h px
    return Array.from(host.querySelectorAll<HTMLElement>(CAST)).map(el => {
      const fx = el.offsetLeft + el.offsetWidth / 2, fy = el.offsetTop + el.offsetHeight * 0.91;
      const col = STAGE_W / 2 + (fx - w / 2) / k, row = STAGE_H / 2 + (fy - h / 2) / k;
      return { el, world: hitVertical(rayFromFrame(frameOfCol(col), frameOfRow(row)), 0), rest: [fx, fy] };
    });
  };

  const onFrame = (project: Projector, size: { w: number; h: number }) => {
    if (!anchors.current || sizeRef.current.w !== size.w || sizeRef.current.h !== size.h) {
      sizeRef.current = size;
      anchors.current = measure(size.w, size.h);
    }
    for (const a of anchors.current) {
      if (!a.el.isConnected) { anchors.current = null; return; }
      const p = project(a.world);
      a.el.style.translate = p ? `${(p[0] - a.rest[0]).toFixed(1)}px ${(p[1] - a.rest[1]).toFixed(1)}px` : '';
    }
  };

  // 인물이 바뀌면(동행·마주침) 다시 잰다
  useEffect(() => { anchors.current = null; });

  return <Stage3D type={type} pose={pose} crop={crop} full fallback={<Scene type={type} />} onFrame={onFrame} />;
}
