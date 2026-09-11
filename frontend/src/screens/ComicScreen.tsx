import { useEffect, useRef } from 'react';
import { useWorld } from '../sim/store';
import type { ActivityOption, BlockId, Comic, ComicPanel, Phase, PlaceType, ShotCrop } from '../sim/types';
import { DEFAULT_LOOK } from '../sim/types';
import { blockDef, categoryDef, nextBlockId } from '../sim/blocks';
import { cityNameKo, placeById } from '../sim/places';
import { castOfComic } from '../sim/agents';
import { Character } from '../character';
import { sceneTypeFor } from '../scenes';
import { Bubble, Button, CompanionChip, JetlagChip, type ChipFriend } from '../ui';
import { beatPose, bookIntent, castOf, panelCast, poseFor, presentLook, shotCastOf, shotCount, type ShotCast } from './util';
import { ShotStage } from './CameraOverlay';
import { hhmmIn } from '../sim/tz';
import { PhotoImg } from '../photo/PhotoImg';
import { bakeShot, newShotId } from '../photo/bake';
import { putLocal } from '../sim/media';

type ComicPhase = Extract<Phase, { kind: 'comic' }>;

/** `?preview=` QA 화면 — 스토어를 건드리지 않는다 (dev/preview.ts 계약): 옛 컷을 굽지도 책에 적지도 않는다 */
const PREVIEW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('preview');
/** 이 세션에서 굽기를 시작한 컷 (`${comicId}:${index}`) — 같은 컷을 두 번 굽지 않는다 (실패해도 이 세션엔 다시 안 한다) */
const baking = new Set<string>();
/** 에이전트 컷의 px 크롭을 굽기의 % 단위로 옮길 때 컷 크기를 못 쟀을 때의 기본값 (폰 폭 390의 2열 격자 ≈ 170px) */
const PANEL_W = 170;

/** State 4 — 2x2 panels on paper-2, then two buttons: open in book (secondary; the comic is already saved) / next block (coral primary). */
export function ComicScreen({ phase, onNext }: { phase: ComicPhase; onNext: (block: BlockId | null) => void }) {
  const plans = useWorld(s => s.plans);
  const memory = useWorld(s => s.memory);
  const book = useWorld(s => s.book);
  const setBookOpen = useWorld(s => s.setBookOpen);
  const { act, comic } = phase;
  const last = act.blockIds[act.blockIds.length - 1];
  const nb = nextBlockId(last);
  const nextDecided = !!nb && nb !== 'sleep' && !!plans[nb].chosenId;
  const friend = phase.companions[0] ?? memory.friends.find(f => f.id === act.option.friendId) ?? memory.friends[0];
  const enc = phase.encounter;
  const metChip: ChipFriend[] = enc?.talked ? [{ id: enc.agent.id, name: enc.agent.name, color: enc.agent.color }] : [];
  const cat = categoryDef(act.option.category);
  const no = Math.max(1, book.findIndex(c => c.id === comic.id) + 1 || book.length + 1);
  const where = act.place.country === 'KR' ? act.place.area : `${act.place.area} · ${cityNameKo(act.place.city)}`;

  const hasWith = !!phase.companions.length || !!metChip.length;
  // 계획-실제 차이 (ADR-0001): 어긋난 날은 두 칩으로, 계획대로 간 날도 반드시 보여준다.
  // 일치를 안 보여주면 불일치가 의미를 잃는다.
  const fx = act.outcome;
  const planned = (() => { try { return fx ? placeById(fx.plannedPlaceId) : null; } catch { return null; } })();
  const diverted = !!planned && planned.id !== act.place.id;
  // 누가 찍었나 (ADR-0004): 헤더 한 줄은 만화 엔진이 아니라 여기서 조립한다 (CONTRACT — comic.ts의 28자 스캔을 피한다). 옛 만화는 전부 에이전트
  const shots = shotCount(comic);
  const sketch = comic.sketch ?? act.sketch;

  return (
    <div className={`cm ${hasWith ? 'has-with' : ''} has-diff ${fx ? 'has-say' : ''} ${sketch ? 'has-sketch' : ''}`}>
      {/* 머리·차이·누가 찍었나·격자를 한 열로 흘린다 — 줄이 붙고 빠져도 격자가 알아서 자리를 잡는다 */}
      <div className="cm-top">
        <div className="cm-head">
          {/* 아침에 그린 그림 (ADR-0004) — 머리 오른쪽에 폴라로이드처럼 */}
          {sketch && <SketchNote src={sketch} />}
          <h3>{comic.title}</h3>
          <p>{blockDef(act.blockIds[0]).label} 블록 · {cat.label} · {where}{phase.jetlag && <JetlagChip inline />}</p>
          {/* 동행과 마주침은 부제에 얼굴로 (제목·캡션엔 이름을 넣지 않는다) */}
          {(!!phase.companions.length || !!metChip.length) && (
            <div className="cm-with">
              {!!phase.companions.length && <CompanionChip friends={phase.companions} small />}
              {!!metChip.length && <CompanionChip friends={metChip} small happy prefix={enc?.again ? '또 만났네' : '새 친구'} />}
            </div>
          )}
        </div>
        {/* 계획-실제 차이 (ADR-0001) — 어긋난 날은 두 칩, 계획대로 간 날도 반드시 한 칩 */}
        <div className="cm-diff">
          {diverted ? (
            <>
              <span className="cm-diff-a">{planned.emoji} {planned.name}</span>
              <span className="cm-diff-ar" aria-hidden="true">→</span>
              <span className="cm-diff-b">{act.place.emoji} {act.place.name}</span>
            </>
          ) : (
            <>
              <span className="cm-diff-b is-ok">{act.place.emoji} {act.place.name}</span>
              <span className="cm-diff-ok">예상대로였어</span>
            </>
          )}
        </div>
        {fx && <div className="cm-diff-say">{fx.line}</div>}
        {/* "내가 N장, 모모가 M장" / "안 찍길래 내가 대충 찍었어" — 계획대로였을 때도, 옛 만화에도 붙는다 (ADR-0004) */}
        <ShotsLine shots={shots} name={memory.name} />
        {/* 인물 구성은 만화가 기억한다(comic.cast, ADR-0026) — 그게 없는 옛 만화만 phase에서 되찾은 것으로 그린다 */}
        <div className="cm-gridwrap"><ComicPanels comic={comic} option={act.option} friendColor={friend?.color} tz={phase.tz} cast={castOf(phase.companions, enc)} /></div>
      </div>
      <Character className="cm-me" pose="happy" size={170} />
      <Bubble className="cm-me-bubble">{shots.user > 0 ? '같이 만든 이야기!' : '오늘 이야기 완성!'}</Bubble>
      <div className="cm-stamp num">STORY #{String(no).padStart(2, '0')}</div>
      <div className="cm-foot">
        <Button onClick={() => { bookIntent.comicId = comic.id; setBookOpen(true); }}>book에서 보기</Button>
        {/* 다음 이동까지는 보통 십수 분 남아 있다 — "이동 보러 가기"는 빈말이 된다. 시간표 시트를 열어 다음 일정을 보여준다. */}
        <Button tone="coral" onClick={() => onNext(nb && nb !== 'sleep' ? nb : null)}>
          {nextDecided ? '다음 일정 보기' : nb && nb !== 'sleep' ? `${blockDef(nb).label} 정하러 가기` : '시간표 보기'}
        </Button>
      </div>
    </div>
  );
}

/** 헤더 한 줄 (CONTRACT ComicScreen): user>0 → "내가 N장, {name}가 M장", 아니면 "안 찍길래 내가 대충 찍었어". book 상세도 같은 줄을 쓴다. */
export function ShotsLine({ shots, name, className = '' }: { shots: { user: number; agent: number }; name: string; className?: string }) {
  return (
    <div className={`cm-shots ${className}`}>
      <span aria-hidden="true">📷</span>
      {shots.user > 0
        ? <span>내가 <b className="is-me num">{shots.user}장</b>, {name}가 <b className="num">{shots.agent}장</b></span>
        : <span>안 찍길래 내가 대충 찍었어</span>}
    </div>
  );
}

/** 아침에 그린 그림 — 폴라로이드 한 장 + "아침에 그린 것" (ADR-0004). */
export function SketchNote({ src, className = '' }: { src: string; className?: string }) {
  return (
    <figure className={`cm-sketch ${className}`}>
      <img src={src} alt="아침에 그린 그림" draggable={false} />
      <figcaption>아침에 그린 것</figcaption>
    </figure>
  );
}

/**
 * The 2x2 grid (also used by the book viewer). Each panel: bg colour + poses + friend + caption strip.
 * 컷마다 화각·기울기·시각이 다르다 — 정중앙 전신 네 컷은 "그린 그림"으로 읽히기 때문이다 (ADR-0001).
 * 인물 구성: 만화가 기억하는 `comic.cast`가 있으면 컷의 시각(p.t)으로 되찾는다 — 말을 튼 순간(met.at) 전의 컷은 그 사람이 배경의 뒷모습,
 * 뒤의 컷은 정면 (FRIENDS_SPEC §6). 없는 옛 만화는 `cast`(util.castOf — 타임라인에서 되찾은 것), 그것도 없으면 컷의 withFriend로 동행만.
 * @param cast 옛 만화의 인물 구성 (util.castOf)
 */
export function ComicPanels({ comic, option, friendColor, tz, cast }: { comic: Comic; option?: ActivityOption; friendColor?: string; tz?: string; cast?: ShotCast }) {
  // 에이전트 컷의 스티커 이름은 memory.name (Friend/Agent 이름이 아니다 — CONTRACT 문구 규칙)
  const agentName = useWorld(s => s.memory.name);
  const castFor = (p: ComicPanel): ShotCast | undefined => (comic.cast ? shotCastOf(castOfComic(comic.cast, p.t ?? comic.createdAt)) : cast);
  return (
    <div className="cm-grid">
      {comic.panels.map((p, i) => <Panel key={i} p={p} i={i} comicId={comic.id} option={option} friendColor={friendColor} tz={tz} placeType={comic.placeType} agentName={agentName} cast={castFor(p)} timed={!!comic.cast} />)}
    </div>
  );
}

/** @param timed cast가 comic.cast에서 컷 시각으로 되찾은 것 — 만난 사람은 시각이 정한다 (util.panelCast) */
function Panel({ p, i, comicId, option, friendColor, tz, placeType, agentName, cast, timed }: { p: ComicPanel; i: number; comicId: string; option?: ActivityOption; friendColor?: string; tz?: string; placeType: PlaceType; agentName: string; cast?: ShotCast; timed: boolean }) {
  const look = useWorld(s => s.memory.look);
  const patchPanelShot = useWorld(s => s.patchPanelShot);
  const ref = useRef<HTMLDivElement>(null);
  const mine = p.by === 'user';
  // 사용자 컷은 카메라 뷰파인더에 보이던 포즈(poseFor) 그대로 — 옵션을 못 찾는 옛 만화(book)에서만 비트 포즈로 대신한다
  const pose = mine ? (option ? poseFor(option) : beatPose(p.beat)) : beatPose(p.beat, option);
  // 옛 만화(질감 이전에 저장된 것)에는 crop/t가 없다 — 그때는 원래대로 정중앙 전신으로 그린다
  const c = p.crop ?? { scale: 1, x: 0, y: 0, rot: 0 };
  // 에이전트 컷의 --cx/--cy는 px (사용자 컷은 ShotStage가 %로 직접 받는다 — CONTRACT ComicPanel.unit). 옛 경로의 .cm-shot에만 단다 —
  // 구운 사진(<img class="cm-shot">)은 크롭이 이미 픽셀에 들어 있어 변수 없이(항등 transform) 그린다
  const vars = mine ? {} : { ['--rot' as string]: `${c.rot}deg`, ['--cs' as string]: String(c.scale), ['--cx' as string]: `${c.x}${p.unit === 'pct' ? '%' : 'px'}`, ['--cy' as string]: `${c.y}${p.unit === 'pct' ? '%' : 'px'}` };
  // 에이전트가 대충 찍은 흔적 (ADR-0004 오너 결정 14): is-dark/is-blur는 CSS가(.cm-shot — 구운 사진에도 그대로), overzoom/cut/tilt는 crop에 이미 반영돼 있다
  const flaws = p.flaws ?? [];
  const cls = ['cm-p', mine ? 'is-user' : '', p.withFriend ? 'has-f' : '', p.blur ? 'is-blur is-miss' : '', flaws.length ? 'has-flaw' : '', ...flaws.map(f => `is-${f}`)]
    .filter(Boolean).join(' ');
  // 컷의 인물 구성 (util.panelCast): 사용자 컷은 찍을 때 그대로, 에이전트 컷은 동행은 withFriend일 때만·만난 사람은 컷의 시각대로(timed), 배경 인물은 cast대로
  const { friendColor: fColor, metColor: mColor, present } = panelCast(p, cast, friendColor, timed);
  const left = p.withFriend || p.beat === 'arrive' || !!mColor;

  // ── 옛 컷은 다음 열람 때 한 번 굽는다 (ADR-0024 결정 2) — 브라우저에서만, 컷마다 한 번, ?preview 화면은 제외 ──
  // 사용자 컷: 카메라와 같은 BakeInput(무대·자세·% 크롭·겉모습·인물). 에이전트 컷: 근사 — 원래 컷은 무대 없이 단색 바닥 + 소품 +
  // 118px 캐릭터인데, 굽기는 무대 위의 캐릭터로 그린다(같은 자세·동행·열화 클래스). px 크롭(--cx/--cy, .cm-shot: rotate → scale →
  // translate, origin 50 % 78 %)은 굽기의 % 단위로 옮긴다: 지금 그려진 컷의 크기로 나눈다 (못 재면 PANEL_W). 굽고 나면 다시 그릴 일이 없다
  useEffect(() => {
    if (p.shotId || PREVIEW || typeof document === 'undefined') return;
    const key = `${comicId}:${i}`;
    if (baking.has(key)) return;
    baking.add(key);
    const el = ref.current;
    const w = el?.clientWidth || PANEL_W;
    const h = el?.clientHeight || w * 1.08;
    const crop: ShotCrop = mine || p.unit === 'pct' ? { ...c } : { ...c, x: (c.x / w) * 100, y: (c.y / h) * 100 };
    const id = newShotId();
    void bakeShot({ type: sceneTypeFor(placeType), pose, crop, look: look ?? DEFAULT_LOOK, friend: fColor ? { color: fColor } : undefined, met: mColor ? { color: mColor } : undefined, present: present?.map(f => ({ color: f.color, look: presentLook(f.hairStyle), ...(f.glance ? { glance: true } : {}) })) })
      .then(b => putLocal(id, b.blob, 'shot'))
      .then(() => patchPanelShot(comicId, i, id))
      .catch((e: unknown) => { console.warn(`comic: 컷 굽기 실패 — 옛 경로로 (${key})`, e); });
    // 마운트 시점의 컷 한 번만 — 나머지 props는 그 컷의 파생값이라 deps에 넣지 않는다 (넣어도 baking이 막는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comicId, i, p.shotId]);

  // 옛 경로: 픽셀이 없거나 못 받았을 때 crop으로 다시 그린다
  const legacy = mine ? (
    /* 카메라 뷰파인더와 **같은 컴포넌트**(ShotStage): 정지 무대 + 캐릭터(발이 78 % 높이) + 동행/마주침/배경 인물, 크롭은 % —
       컷 비율(1/1.08)도 같아 "찍은 그대로"다. 인물 구성을 모르면(cast 없음) 컷의 withFriend로 동행만 */
    <ShotStage type={placeType} pose={pose} crop={c} friendColor={fColor} metColor={mColor} present={present} still className="cm-usr" />
  ) : (
    <div className="cm-shot" style={vars}>
      <Prop beat={p.beat} withFriend={!!p.withFriend} />
      <Character className={`cm-c ${left ? 'is-left' : ''}`} pose={pose} size={118} />
      {/* 옆의 인물: 만난 사람이 있는 컷(at 뒤)이면 그 사람 색으로, 아니면 동행 색 — 옛 경로라 배경 인물은 안 그린다 (구운 컷엔 있다) */}
      {(p.withFriend || mColor) && <Character className="cm-f" pose="wave" size={100} variant="friend" color={mColor ?? fColor} />}
    </div>
  );
  return (
    <div ref={ref} className={cls} style={{ background: p.bg }}>
      {!mine && !p.shotId && <div className="cm-floor" />}
      {/* 컷 번호 대신 그 컷이 찍힌 시각 — 이거 하나로 "삽화 → 기록"이 뒤집힌다 */}
      <span className="cm-k num">{p.t && tz ? hhmmIn(p.t, tz) : i + 1}</span>
      {/* 누가 찍었나 스티커 — 옛 만화(by 없음)에는 붙이지 않는다 (헤더 줄은 전부 에이전트로 센다: util.shotCount) */}
      {p.by && <span className="cm-by">{mine ? '내가 찍음' : `${agentName}가 찍음`}</span>}
      {/* 구운 사진(ADR-0024): 같은 .cm-shot 자리에 <img> — is-dark/is-blur 필터가 그대로 얹힌다. 못 받으면 옛 경로 */}
      {p.shotId ? <PhotoImg shotId={p.shotId} className="cm-shot" alt={p.caption}>{legacy}</PhotoImg> : legacy}
      <div className="cm-cap">{p.caption}</div>
    </div>
  );
}

/** One small prop per beat so each panel reads differently even with the same bg. */
function Prop({ beat, withFriend }: { beat: ComicPanel['beat']; withFriend: boolean }) {
  switch (beat) {
    case 'arrive':
      return (
        <svg className="cm-prop" style={{ right: 12, bottom: 36 }} width="54" height="84" viewBox="0 0 54 84" aria-hidden="true">
          <rect x="3" y="3" width="48" height="78" rx="6" fill="#FFF6E6" stroke="#2A2118" strokeWidth="3" />
          <rect x="12" y="12" width="30" height="24" rx="4" fill="#A9DCF5" stroke="#2A2118" strokeWidth="2" />
          <circle cx="40" cy="50" r="3.5" fill="#FFC64D" stroke="#2A2118" strokeWidth="2" />
        </svg>
      );
    case 'doing':
      return (
        <svg className="cm-prop" style={{ left: 8, bottom: 30 }} width="150" height="50" viewBox="0 0 150 50" aria-hidden="true">
          <rect x="4" y="18" width="142" height="12" rx="6" fill="#FFC64D" stroke="#2A2118" strokeWidth="3" />
          <path d="M22 30v16M128 30v16" stroke="#2A2118" strokeWidth="3" strokeLinecap="round" />
          <rect x="34" y="6" width="30" height="12" rx="3" fill="#FFF6E6" stroke="#2A2118" strokeWidth="2" />
          <path d="M96 18l-4-12h20l-4 12z" fill="#5FC9A6" stroke="#2A2118" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case 'twist':
      return withFriend ? (
        <svg className="cm-prop" style={{ left: '50%', top: 22, marginLeft: -22 }} width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
          <path d="M22 4l4 10 11 1-8 7 3 11-10-6-10 6 3-11-8-7 11-1z" fill="#FFC64D" stroke="#2A2118" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="cm-prop" style={{ right: 14, top: 18 }} width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
          <path d="M31 4l6 12 13-4-6 12 12 7-13 3 3 13-11-7-8 11-4-13-13 3 8-10-11-8 13-2-2-13 11 6z" fill="#FFC64D" stroke="#2A2118" strokeWidth="2.5" strokeLinejoin="round" />
          <text x="31" y="40" textAnchor="middle" fontFamily="Jua, sans-serif" fontSize="24" fill="#2A2118">!</text>
        </svg>
      );
    case 'end':
      return (
        <svg className="cm-prop" style={{ inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g stroke="#2A2118" strokeWidth="1.2" strokeLinejoin="round">
            <path d="M16 20l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z" fill="#FF6A48" />
            <path d="M82 16l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z" fill="#FFC64D" />
            <path d="M86 46l1.5 4 4 .8-3 2.4.8 4-3.3-2.4-3.3 2.4.8-4-3-2.4 4-.8z" fill="#5FC9A6" />
            <path d="M12 52l1.5 4 4 .8-3 2.4.8 4-3.3-2.4-3.3 2.4.8-4-3-2.4 4-.8z" fill="#A9DCF5" />
          </g>
        </svg>
      );
  }
}
