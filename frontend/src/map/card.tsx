// ─── Bottom card (MOVEMENT_SPEC §5): one card, fixed 132 px, the remaining time is the biggest number.
// Static rows re-render on leg change (React, ≤ 1 Hz); the hero number, progress bar and detail line
// are written imperatively from the rAF through the handle.
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import type { Category, Friend, Journey, Onboard, PlaceType, ScheduledActivity, TransportMode } from '../sim/types';
import { FriendHead } from '../character/FriendHead';
import { hhmmIn } from '../sim/tz';
import { cityNameKo } from '../sim/places';
import { isRail, prefersReducedMotion } from './camera';

export interface CardHandle {
  /** 0..1 over the whole journey; call at ≤ 4 Hz. */
  setProgress(p: number): void;
  /** Whole minutes left; `soon` when under 60 s; `arrived` shows 도착!. Only re-renders on a change. */
  setRemaining(min: number, soon: boolean, arrived: boolean): void;
  /** Row 3 left (distance left / station count / 대략적인 경로). */
  setDetail(text: string, approx: boolean): void;
  /** What the character does on board right now (TIMEZONE_SPEC): Row 2 becomes 기내에서 자는 중 / 기내식 먹는 중 …; null restores the mode phrase. */
  setOnboard(onboard: Onboard): void;
  /** Slide the card up (departure) — wall-clock 400 ms. */
  show(): void;
}

export interface MoveCardProps {
  act: ScheduledActivity;
  journey: Journey;
  legIndex: number;
  /** Station fractions of the active rail leg, for track ticks. */
  ticks?: number[];
  /** Friends going along (FRIENDS_SPEC 동행 표시 규칙) — a 20 px head + "민수와 함께" after the destination. */
  companions?: Friend[];
  ref?: Ref<CardHandle>;
}

const MODE_PHRASE: Record<TransportMode, string> = { walk: '걸어서 가는 중', car: '차 타고 가는 중', plane: '비행기 타고 가는 중', boat: '배 타고 가는 중', train: '기차 타고 가는 중', subway: '지하철 타고 가는 중' };
/** Shorter mode phrase used only when the full Row 2 would not fit next to a wide hero (e.g. `1시간 12분`). */
const MODE_SHORT: Record<TransportMode, string> = { walk: '걸어서', car: '차 타고', plane: '비행기로', boat: '배 타고', train: '기차로', subway: '지하철로' };
const MODE_ARIA: Record<TransportMode, string> = { walk: '걷기', car: '자동차', plane: '비행기', boat: '배', train: '기차', subway: '지하철' };
/** Onboard sub-line per vehicle (TIMEZONE_SPEC 이동 중 카드): sleeping / eating in the origin zone's blocks. Walk/car/subway say nothing. */
const ONBOARD_PHRASE: Partial<Record<TransportMode, Record<NonNullable<Onboard>, string>>> = {
  plane: { sleep: '😴 기내에서 자는 중', meal: '🍱 기내식 먹는 중' },
  train: { sleep: '😴 열차에서 자는 중', meal: '🍱 도시락 먹는 중' },
  boat: { sleep: '😴 선실에서 자는 중', meal: '🍜 배 위에서 우동' },
};
export const onboardPhrase = (mode: TransportMode, onboard: Onboard): string | null => (onboard && ONBOARD_PHRASE[mode]?.[onboard]) ?? null;
/** "도착 08:10" in the destination's zone; the city is named when the journey changes zones ("도착 뉴욕 08:10"). */
export const etaText = (act: ScheduledActivity) => `도착 ${act.tz !== act.originTz ? cityNameKo(act.place.city) + ' ' : ''}${hhmmIn(act.arriveAt, act.tz)}`;
const FILL_COLOR: Record<TransportMode, string> = { walk: 'var(--coral)', car: 'var(--coral)', plane: 'var(--sky)', boat: '#7CC4EA', train: 'var(--sun)', subway: 'var(--coral)' };

/** 와 / 과 after a Korean name (jongseong → 과). */
export function withParticle(name: string): string {
  const code = name.trim().slice(-1).charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '와';
  return code % 28 === 0 ? '와' : '과';
}
/** "민수와 함께" / "민수와 하나 외 1명과 함께" — companionship is data, never copy. */
export function companionText(companions: Friend[]): string {
  const [first, ...rest] = companions;
  if (!first) return '';
  const base = rest.length ? `${first.name} 외 ${rest.length}명` : first.name;
  return `${base}${withParticle(base)} 함께`;
}

/** 로 / 으로 after a Korean noun. */
export function toParticle(name: string): string {
  const ch = name.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}
/** "카페 레이어드 연남에서 그림 그리기" → "그림 그리기" (same rule as sim/comic.ts). */
export function activityPhrase(title: string): string {
  const t = title.replace(/^.*?(에서|에|까지)\s?/, '').trim();
  return t || title;
}
/** Fallbacks when the title is only a place + a trip word ("협재해수욕장 당일치기"): a short verb by place type, then category. */
const TYPE_VERB: Partial<Record<PlaceType, string>> = {
  beach: '바다 산책', river: '강바람 쐬기', park: '산책하기', mountain: '산 오르기', island: '섬 구경', museum: '구경하기', mall: '구경하기',
  market: '장 보기', cafe: '커피 한 잔', restaurant: '밥 먹기', gym: '운동하기', library: '책 읽기', cinema: '영화 보기', stadium: '경기 보기',
  temple: '둘러보기', hotel: '쉬기', arcade: '게임하기', bar: '한잔하기', friend_home: '친구랑 놀기', school: '수업 듣기', office: '일하기',
  station: '구경하기', airport: '구경하기', port: '바다 구경', home: '짐 풀기',
};
const CATEGORY_VERB: Record<Category, string> = { sleep: '잠자기', meal: '밥 먹기', play: '놀기', exercise: '운동하기', study: '공부하기', work: '일하기', rest: '쉬기', travel: '구경하기' };
const TRIP_WORDS = /^(당일치기|다녀오기|가보기|가기|놀러 가기|여행|방문)$/;
/** A trip title names the way there, not what happens on arrival ("뉴욕으로 훌쩍, 센트럴파크 (3박)", "KTX 타고 부산 해운대",
 *  "집으로 돌아가기") — Row 2 then says what the character will do at the place (TYPE_VERB) instead. */
const TRIP_TITLE = /(훌쩍|날아가기|뱃길로|당일치기|까지 가서|돌아가기|보러 가기|가보기|행 비행기|타고 )/;
const STAY_SUFFIX = /\s*\(\d+박\)\s*$/;
const MAX_ACTIVITY = 10;
/** Row 1 already names the place, so the activity phrase drops every leading word that belongs to the place name or area
 *  ("해운대 해수욕장 당일치기" → trip word only → "바다 산책"); capped at ~10 chars so Row 2 never ellipsizes the activity. */
export function activityPhraseFor(act: ScheduledActivity): string {
  const title = act.option.title.replace(STAY_SUFFIX, '');
  const { area, name, type } = act.place;
  const fallback = TYPE_VERB[type] ?? CATEGORY_VERB[act.option.category] ?? '놀기';
  if (act.option.category === 'travel' && TRIP_TITLE.test(title)) return fallback;
  const base = activityPhrase(title);
  const placeKey = `${area} ${name}`.replace(/\s+/g, '');
  const words = base.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && words[i].length >= 2 && placeKey.includes(words[i])) i++;
  let t = words.slice(i).join(' ').replace(/구경하고 오기$/, '구경하기').replace(/^(에서|에|까지)\s?/, '').trim();
  if (t.length < 2 || TRIP_WORDS.test(t)) t = '';
  if (!t) return fallback;
  if (t.length > MAX_ACTIVITY) {
    // Keep whole words while they fit; if even the first word is too long, use the fallback verb
    const kept: string[] = [];
    for (const w of t.split(' ')) { if ([...kept, w].join(' ').length > MAX_ACTIVITY) break; kept.push(w); }
    t = kept.join(' ');
    if (t.length < 2) return fallback;
  }
  return t;
}
export const arrivalPhrase = (mode: TransportMode, act: ScheduledActivity) => `${mode === 'walk' || mode === 'car' ? '도착하면' : '내리면'} ${activityPhraseFor(act)}`;
/** Row 2 candidates, longest first; the first that fits the column wins (never an ellipsis in the activity).
 *  On board (sleep / meal block of the origin zone) the vehicle phrase gives way to what the character is doing. */
const subCandidates = (mode: TransportMode, act: ScheduledActivity, onboard: Onboard = null) => {
  const a = arrivalPhrase(mode, act);
  const ob = onboardPhrase(mode, onboard);
  if (ob) return [`${ob} · ${a}`, ob];
  return [`${MODE_PHRASE[mode]} · ${a}`, `${MODE_SHORT[mode]} · ${a}`, a];
};

/** 22 px mode glyph: ink outline, sun fill (walk is the character's silhouette). */
export function ModeGlyph({ mode, size = 22 }: { mode: TransportMode; size?: number }) {
  const s = { stroke: '#2A2118', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  let body: ReactNode;
  switch (mode) {
    case 'walk': body = <><circle cx="12" cy="7" r="4.5" fill="#FFD9B8" {...s} /><path d="M8 20l2.5-8h3L16 20" fill="#FFC64D" {...s} /></>; break;
    case 'car': body = <><path d="M3 15v-3l3-5h12l3 5v3z" fill="#FFC64D" {...s} /><circle cx="7.5" cy="16.5" r="2.5" fill="#FFF6E6" {...s} /><circle cx="16.5" cy="16.5" r="2.5" fill="#FFF6E6" {...s} /></>; break;
    case 'plane': body = <path d="M3 13l8-2 4-7h3l-2 7 6 2v2l-6 1-1 5h-2l-2-5-8 1z" fill="#FFC64D" {...s} />; break;
    case 'boat': body = <><path d="M3 14h18l-3 5H6z" fill="#FFC64D" {...s} /><path d="M12 4v10M12 5l6 6h-6" fill="#FFF6E6" {...s} /></>; break;
    case 'train': body = <><rect x="5" y="4" width="14" height="13" rx="3" fill="#FFC64D" {...s} /><rect x="8" y="7" width="8" height="4" rx="1" fill="#FFF6E6" {...s} /><path d="M8 21l1-3M16 21l-1-3" {...s} /></>; break;
    case 'subway': body = <><rect x="4" y="5" width="16" height="12" rx="3" fill="#FFC64D" {...s} /><rect x="7" y="8" width="4" height="4" fill="#FFF6E6" {...s} /><rect x="13" y="8" width="4" height="4" fill="#FFF6E6" {...s} /><path d="M7 21l2-3M17 21l-2-3" {...s} /></>; break;
  }
  return <svg className="mc-glyph" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={MODE_ARIA[mode]}>{body}</svg>;
}

export function MoveCard({ act, journey, legIndex, ticks = [], companions = [], ref }: MoveCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const lastRemaining = useRef<string>('');
  const swapTimer = useRef<number>(0);
  const trackW = useRef(0);

  const leg = journey.legs[Math.min(legIndex, journey.legs.length - 1)];
  const mode: TransportMode = leg?.mode ?? 'walk';
  // Row 2 is `{mode phrase} · {arrival phrase}` only (§5.2); a custom leg label (KTX 서울 → 부산) goes to the station pill.
  const onboardRef = useRef<Onboard>(null);
  const subTexts = useMemo(() => subCandidates(mode, act, onboardRef.current), [mode, act]);
  const subTextsRef = useRef(subTexts); subTextsRef.current = subTexts;   // the handle below outlives a leg change
  const modeRef = useRef(mode); modeRef.current = mode;
  const arrivedRef = useRef(false);
  /** Write the longest Row 2 variant that fits next to the hero (one layout read per call; called ≤ 1 Hz). */
  const fitSub = () => {
    const el = sub.current; if (!el || arrivedRef.current) return;
    for (const t of subTextsRef.current) { el.textContent = t; if (el.scrollWidth <= el.clientWidth + 1) return; }
  };
  useLayoutEffect(fitSub, [subTexts]);

  useEffect(() => { trackW.current = track.current?.clientWidth ?? 0; }, []);

  const render = (html: string, animate: boolean) => {
    const h = hero.current; if (!h) return;
    if (!animate || prefersReducedMotion()) { h.innerHTML = html; return; }
    h.classList.add('is-out');
    clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => {
      h.innerHTML = html; h.classList.remove('is-out'); h.classList.add('is-in');
      swapTimer.current = window.setTimeout(() => h.classList.remove('is-in'), 220);
    }, 200);
  };
  const heroHtml = (min: number) => {
    if (min >= 60) { const hrs = Math.floor(min / 60), m = min % 60; return `<b class="mc-num">${hrs}</b><i class="mc-unit">시간</i>${m ? `<b class="mc-num mc-num--sm">${m}</b><i class="mc-unit">분</i>` : ''}`; }
    return `<b class="mc-num">${Math.max(1, min)}</b><i class="mc-unit">분</i>`;
  };

  useImperativeHandle(ref, () => ({
    setProgress(p) {
      const f = fill.current, k = knob.current; if (!f || !k) return;
      const x = Math.max(0, Math.min(1, p));
      f.style.transform = `scaleX(${x})`;
      const w = trackW.current || track.current?.clientWidth || 0;
      k.style.transform = `translateX(${Math.round(x * Math.max(0, w - 16))}px)`;
    },
    setRemaining(min, soon, arrived) {
      const key = arrived ? 'arrived' : soon ? 'soon' : `m${min}`;
      if (key === lastRemaining.current) return;
      const first = lastRemaining.current === '';
      lastRemaining.current = key;
      if (arrived) {
        render('<b class="mc-soon">도착!</b>', !first);
        arrivedRef.current = true;
        if (sub.current) sub.current.textContent = `이제 ${activityPhraseFor(act)}`;
        return;
      }
      // The hero's width changes at hour boundaries / 곧 도착 → re-fit Row 2 after the swap has rendered
      if (soon) { render('<b class="mc-soon">곧 도착</b>', !first); window.setTimeout(fitSub, 230); return; }
      if (first && !prefersReducedMotion()) {
        // Departure count-up: 0 → value over 500 ms (tabular figures, so width never shifts)
        const t0 = performance.now();
        const tick = () => {
          const t = Math.min(1, (performance.now() - t0) / 500);
          const v = Math.round(min * (1 - Math.pow(1 - t, 3)));
          if (hero.current) hero.current.innerHTML = heroHtml(v);
          if (t < 1 && lastRemaining.current === key) requestAnimationFrame(tick);
        };
        tick();
        window.setTimeout(fitSub, 520);
        return;
      }
      render(heroHtml(min), !first);
      window.setTimeout(fitSub, first ? 0 : 230);
    },
    setDetail(text, approx) {
      const d = detail.current; if (!d) return;
      d.textContent = text;
      d.classList.toggle('is-approx', approx);
    },
    setOnboard(onboard) {
      if (onboard === onboardRef.current) return;
      onboardRef.current = onboard;
      subTextsRef.current = subCandidates(modeRef.current, act, onboard);
      fitSub();
    },
    show() { root.current?.classList.add('is-in'); },
  }), [act]);

  // Leg strip (multi-leg journeys only): at most three 12 px glyphs — previous › current › next — the current one in sun,
  // the others faded; never the whole chain (five 10 px glyphs were unreadable).
  const n = journey.legs.length;
  const cur = Math.min(legIndex, n - 1);
  const from = Math.max(0, Math.min(cur - 1, n - 3));
  const strip = n > 1 ? (
    <span className="mc-strip" aria-label={`이동 구간 ${cur + 1} / ${n}`}>
      {journey.legs.slice(from, from + 3).map((l, j) => {
        const i = from + j;
        return (
          <span key={i} className={'mc-strip-leg' + (i === cur ? ' on' : i < cur ? ' is-done' : '')}>
            {j > 0 && <i className="mc-arrow" aria-hidden="true" />}<ModeGlyph mode={l.mode} size={12} />
          </span>
        );
      })}
    </span>
  ) : null;

  return (
    <div className="mc" ref={root} role="status" aria-live="polite">
      <div className="mc-row1">
        <ModeGlyph mode={mode} />
        <div className="mc-to">{act.place.name}{toParticle(act.place.name)}</div>
        {companions.length > 0 && (
          <span className="mc-with">
            <FriendHead size={20} color={companions[0].color} title={companions[0].name} />
            <b>{companionText(companions)}</b>
          </span>
        )}
      </div>
      <div className="mc-hero" ref={hero} />
      <div className="mc-sub" ref={sub}>{subTexts[0]}</div>
      <div className="mc-row3">
        {strip}
        <span className="mc-detail num" ref={detail} />
      </div>
      <div className="mc-eta num">{etaText(act)}</div>
      <div className="mc-track" ref={track}>
        <div className="mc-fill" ref={fill} style={{ background: FILL_COLOR[mode] }} data-mode={mode} />
        {isRail(mode) && ticks.map((f, i) => <i key={i} className="mc-tick" style={{ left: `${(f * 100).toFixed(1)}%` }} />)}
        <div className="mc-knob" ref={knob}><ModeGlyph mode={mode} size={10} /></div>
      </div>
    </div>
  );
}
