import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorld } from '../sim/store';
import type { BlockId } from '../sim/types';
import { blockDef, categoryDef } from '../sim/blocks';
import { Character } from '../character';
import { Bubble, Button, Glyph } from '../ui';
import './sketch.css';

/** 한 점: 캔버스 한 변을 1로 본 좌표(0..1). 화면 크기가 바뀌어도 획이 따라오고, 저장 때 240px로 그대로 축소된다. */
type Pt = { x: number; y: number };
/** 한 획 = 점의 배열. undo는 마지막 획을 뺀다. */
type Stroke = Pt[];

/** 저장 크기 — CONTRACT: 240px 정사각 PNG dataURL (BlockPlan.sketch, 긴 변 ≤ 240px) */
const OUT = 240;
/** 붓 굵기(px, 화면 캔버스 기준) — 굵기 6~8, 둥근 끝 */
const BRUSH = 7;
/** 빨간 붓 = --coral (src/theme/tokens.css). 캔버스 API는 CSS 토큰을 못 읽어 값을 그대로 둔다 */
const BRUSH_COLOR = '#FF6A48';
/** 저장 PNG의 바탕 = --paper (시간표의 .done 카드 바탕과 같은 톤) */
const PAPER = '#FFF6E6';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 획들을 `size`px 정사각에 그린다. 점 사이는 중점 2차 곡선으로 이어 손그림처럼 둥글게. 점 하나짜리 획은 둥근 점. */
function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], size: number, width: number) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = BRUSH_COLOR; ctx.lineWidth = width;
  for (const s of strokes) {
    if (!s.length) continue;
    const [p0] = s;
    ctx.beginPath();
    ctx.moveTo(p0.x * size, p0.y * size);
    if (s.length === 1) { ctx.lineTo(p0.x * size + 0.01, p0.y * size); ctx.stroke(); continue; }
    for (let i = 1; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      ctx.quadraticCurveTo(a.x * size, a.y * size, ((a.x + b.x) / 2) * size, ((a.y + b.y) / 2) * size);
    }
    const last = s[s.length - 1];
    ctx.lineTo(last.x * size, last.y * size);
    ctx.stroke();
  }
}

/** 캐릭터가 옆에서 지켜보며 하는 말 — 획 수에 따라. (화면 안내문: TimetableScreen의 말풍선과 같은 성격이라 narrate()를 안 지난다) */
const watching = (n: number) =>
  n === 0 ? '뭘 하고 싶어? 그려서 알려줘' : n < 4 ? '오… 이게 뭐지?' : n < 10 ? '음, 감이 올 것 같기도…' : '알겠어! …아마도';

/**
 * 그려서 알려줘 (ADR-0004 오너 결정 5): 카드 대신 그림을 넘긴다. 모눈 정사각 캔버스에 빨간 붓으로 획을 그리고
 * "이걸로!"를 누르면 240px PNG dataURL로 `sketchBlock(blockId, url)` 후 닫힌다. 닫기(X)는 저장 없이.
 * 포인터 이벤트(pointerdown/move/up + setPointerCapture)로 그리고, devicePixelRatio만큼 픽셀을 준다.
 */
export function SketchOverlay({ blockId, onClose }: { blockId: BlockId; onClose: () => void }) {
  const plan = useWorld(s => s.plans[blockId]);
  const sketchBlock = useWorld(s => s.sketchBlock);
  const cat = plan.category ? categoryDef(plan.category) : null;

  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 끝난 획들 (undo 단위) */
  const strokes = useRef<Stroke[]>([]);
  /** 지금 그리는 중인 획 (pointerdown ~ up) */
  const live = useRef<Stroke | null>(null);
  /** 캔버스 CSS 한 변(px) — 좌표 변환·붓 굵기 환산의 기준 */
  const sizeRef = useRef(0);
  const raf = useRef(0);
  /** 획 수 — 버튼 활성과 말풍선만 이걸 본다 (그리기는 ref로 돌아 리렌더가 없다) */
  const [count, setCount] = useState(0);
  const [size, setSize] = useState(0);

  // 정사각 = 화면 너비 − 32px (.sk-body 좌우 16px). ResizeObserver로 실제 크기를 잰다
  useLayoutEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const ro = new ResizeObserver(() => setSize(pad.clientWidth));
    ro.observe(pad);
    setSize(pad.clientWidth);
    return () => ro.disconnect();
  }, []);

  const redraw = () => {
    const c = canvasRef.current, s = sizeRef.current;
    const ctx = c && s ? c.getContext('2d') : null;
    if (!c || !s || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    paint(ctx, live.current ? [...strokes.current, live.current] : strokes.current, s, BRUSH);
  };
  /** 한 프레임에 한 번만 다시 그린다 (pointermove는 초당 수십~수백 번 온다) */
  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; redraw(); });
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // 픽셀 크기 = CSS 크기 × dpr. width/height를 다시 잡으면 내용이 지워지므로 바로 다시 그린다
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !size) return;
    const dpr = window.devicePixelRatio || 1;
    sizeRef.current = size;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    redraw();
  }, [size]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Esc = 닫기 (저장 없이)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const at = (c: HTMLCanvasElement, ev: { clientX: number; clientY: number }): Pt => {
    const r = c.getBoundingClientRect();
    return { x: clamp01((ev.clientX - r.left) / r.width), y: clamp01((ev.clientY - r.top) / r.height) };
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;   // 두 번째 손가락·오른쪽 버튼은 무시
    const c = e.currentTarget;
    try { c.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터(합성 이벤트 등)면 캡처 없이 그린다 */ }
    live.current = [at(c, e)];
    schedule();
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (!s || !e.isPrimary) return;
    // 합쳐진 이벤트를 풀면 빠른 획도 매끈하다 (지원 안 하면 이 이벤트 하나)
    const list = e.nativeEvent.getCoalescedEvents?.();
    for (const ev of list && list.length ? list : [e.nativeEvent]) s.push(at(e.currentTarget, ev));
    schedule();
  };
  /** pointerup·pointercancel 공용 — 취소돼도 그린 만큼은 남긴다 */
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (!s || !e.isPrimary) return;
    live.current = null;
    strokes.current = [...strokes.current, s];
    setCount(strokes.current.length);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    schedule();
  };

  const undo = () => { strokes.current = strokes.current.slice(0, -1); setCount(strokes.current.length); schedule(); };
  const clear = () => { strokes.current = []; setCount(0); schedule(); };
  /** 240px 정사각 PNG로 축소해 저장 — 바탕은 --paper, 붓 굵기도 같은 비율로 */
  const save = () => {
    if (!strokes.current.length) return;
    const out = document.createElement('canvas');
    out.width = OUT; out.height = OUT;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, OUT, OUT);
    paint(ctx, strokes.current, OUT, BRUSH * OUT / Math.max(1, sizeRef.current));
    sketchBlock(blockId, out.toDataURL('image/png'));
    onClose();
  };

  return (
    <div className="sk" role="dialog" aria-label="그려서 알려줘">
      <div className="sk-hd">
        <h2>그려서 알려줘<small>{blockDef(blockId).label} 블록{cat ? ` · ${cat.emoji} ${cat.label}` : ''}</small></h2>
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      <p className="sk-sub">뭘 하고 싶은지 그려줘, 간단하게</p>
      <div className="sk-body">
        <div ref={padRef} className="sk-pad">
          <canvas ref={canvasRef} className="sk-canvas" aria-label="그림판"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          <span className="sk-tag" aria-hidden="true">🖍 빨간 붓</span>
        </div>
        <div className="sk-tools">
          <Button tone="paper" small disabled={!count} onClick={undo}>한 획 지우기</Button>
          <Button tone="paper" small disabled={!count} onClick={clear}>다 지우기</Button>
        </div>
        {/* 캐릭터가 옆에서 지켜본다 — 뭘 그리는지 궁금한 얼굴(think). 도구 줄과 CTA 사이 띠(≈260px)를 채우게 크게 (오너 우선순위 "캐릭터 크게");
            짧은 화면에선 sketch.css의 미디어 쿼리가 132px로 줄인다 */}
        <div className="sk-watch">
          <Character className="sk-chara" pose="think" size={220} />
          <Bubble className="sk-say">{watching(count)}</Bubble>
        </div>
      </div>
      <div className="sk-foot">
        <Button tone="coral" className="sk-cta" disabled={!count} onClick={save}>이걸로!</Button>
      </div>
    </div>
  );
}
