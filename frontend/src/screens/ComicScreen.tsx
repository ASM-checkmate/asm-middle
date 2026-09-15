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
import { backdropById, backdropDataUrl } from '../sim/backdrops';
import { hhmmIn } from '../sim/tz';
import { PhotoImg } from '../photo/PhotoImg';
import { bakeShot, newShotId } from '../photo/bake';
import { putLocal } from '../sim/media';

type ComicPhase = Extract<Phase, { kind: 'comic' }>;

/** `?preview=` QA 화면 — 스토어를 건드리지 않는다 (dev/preview.ts 계약): 옛 컷을 굽지도 책에 적지도 않는다 */
const PREVIEW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('preview');
/** 이 세션에서 굽기를 시작한 컷 (`${comicId}:${index}`) — 같은 컷을 두 번 굽지 않는다 (실패해도 이 세션엔 다시 안 한다) */
const baking = new Set<string>();
/** 옛 에이전트 컷의 px 크롭을 % 단위로 옮길 때의 기준 컷 크기 (폰 폭 390의 2열 격자 ≈ 170px) */
const PANEL_W = 170;

/** State 4 — 오늘 찍은 사진 1~3장(옛 앨범은 4컷), 그리고 두 버튼: 앨범에서 보기(secondary; 이미 저장돼 있다) / 다음 블록(coral primary). */
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
      <div className="cm-stamp num">ALBUM #{String(no).padStart(2, '0')}</div>
      <div className="cm-foot">
        <Button onClick={() => { bookIntent.comicId = comic.id; setBookOpen(true); }}>앨범에서 보기</Button>
        {/* 다음 이동까지는 보통 십수 분 남아 있다 — "이동 보러 가기"는 빈말이 된다. 시간표 시트를 열어 다음 일정을 보여준다. */}
        <Button tone="coral" onClick={() => onNext(nb && nb !== 'sleep' ? nb : null)}>
          {nextDecided ? '다음 일정 보기' : nb && nb !== 'sleep' ? `${blockDef(nb).label} 정하러 가기` : '시간표 보기'}
        </Button>
      </div>
    </div>
  );
}

/** 헤더 한 줄: user>0 → "내가 N장" (+ 옛 앨범이면 "{name}가 M장"), 아니면 "안 찍길래 내가 한 장 찍었어". 앨범 상세도 같은 줄을 쓴다. */
export function ShotsLine({ shots, name, className = '' }: { shots: { user: number; agent: number }; name: string; className?: string }) {
  return (
    <div className={`cm-shots ${className}`}>
      <span aria-hidden="true">📷</span>
      {shots.user > 0
        ? <span>내가 <b className="is-me num">{shots.user}장</b>{shots.agent > 0 && <>, {name}가 <b className="num">{shots.agent}장</b></>}</span>
        : <span>안 찍길래 내가 한 장 찍었어</span>}
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
    <div className={`cm-grid has-${Math.min(4, comic.panels.length)}`}>
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
  // 사용자 컷은 찍을 때의 자세(p.me.pose, 없으면 poseFor) 그대로 — 옵션을 못 찾는 옛 앨범(book)에서만 비트 포즈로 대신한다
  const pose = mine ? (option ? poseFor(option) : beatPose(p.beat)) : beatPose(p.beat, option);
  // 옛 앨범(질감 이전에 저장된 것)에는 crop/t가 없다 — 그때는 원래대로 정중앙 전신으로 그린다. 옛 에이전트 컷의 px 크롭은 %로 옮긴다
  const c0 = p.crop ?? { scale: 1, x: 0, y: 0, rot: 0 };
  const c: ShotCrop = mine || p.unit === 'pct' ? c0 : { ...c0, x: (c0.x / PANEL_W) * 100, y: (c0.y / (PANEL_W * 1.08)) * 100 };
  const cls = ['cm-p', mine ? 'is-user' : '', p.withFriend ? 'has-f' : ''].filter(Boolean).join(' ');
  // 컷의 인물 구성 (util.panelCast): 사용자 컷은 찍을 때 그대로, 에이전트 컷은 동행은 withFriend일 때만·만난 사람은 컷의 시각대로(timed), 배경 인물은 cast대로
  const { friendColor: fColor, metColor: mColor, present } = panelCast(p, cast, friendColor, timed);
  const backdrop = backdropById(p.backdrop);

  // ── 픽셀 없는 컷은 다음 열람 때 한 번 굽는다 (ADR-0024 결정 2) — 브라우저에서만, 컷마다 한 번, ?preview 화면은 제외 ──
  // 카메라와 같은 BakeInput(배경·자리·자세·% 크롭·겉모습·동행). 굽고 나면 다시 그릴 일이 없다
  useEffect(() => {
    if (p.shotId || PREVIEW || typeof document === 'undefined') return;
    const key = `${comicId}:${i}`;
    if (baking.has(key)) return;
    baking.add(key);
    const id = newShotId();
    const input = {
      type: sceneTypeFor(placeType), pose, crop: { ...c }, look: look ?? DEFAULT_LOOK, me: p.me,
      friend: fColor ? { color: fColor } : undefined, friendPos: p.friend, met: mColor ? { color: mColor } : undefined,
      present: present?.map(f => ({ color: f.color, look: presentLook(f.hairStyle), ...(f.glance ? { glance: true } : {}) })),
    };
    const withBackdrop = backdrop ? backdropDataUrl(backdrop).then(url => ({ ...input, backdrop: url })) : Promise.resolve(input);
    void withBackdrop.then(inp => bakeShot(inp))
      .then(b => putLocal(id, b.blob, 'shot'))
      .then(() => patchPanelShot(comicId, i, id))
      .catch((e: unknown) => { console.warn(`comic: 컷 굽기 실패 — 옛 경로로 (${key})`, e); });
    // 마운트 시점의 컷 한 번만 — 나머지 props는 그 컷의 파생값이라 deps에 넣지 않는다 (넣어도 baking이 막는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comicId, i, p.shotId]);

  // 옛 경로: 픽셀이 없거나 못 받았을 때 다시 그린다 — 카메라 뷰파인더와 **같은 컴포넌트**(ShotStage), 컷 비율(1/1.08)도 같아 "찍은 그대로"다
  const legacy = <ShotStage type={placeType} pose={pose} crop={c} backdrop={backdrop} me={p.me} friendColor={fColor} friendPos={p.friend} metColor={mColor} present={present} still className="cm-usr" />;
  return (
    <div ref={ref} className={cls} style={{ background: p.bg }}>
      {/* 컷 번호 대신 그 컷이 찍힌 시각 — 이거 하나로 "삽화 → 기록"이 뒤집힌다 */}
      <span className="cm-k num">{p.t && tz ? hhmmIn(p.t, tz) : i + 1}</span>
      {/* 누가 찍었나 스티커 — 옛 앨범(by 없음)에는 붙이지 않는다 (헤더 줄은 전부 에이전트로 센다: util.shotCount) */}
      {p.by && <span className="cm-by">{mine ? '내가 찍음' : `${agentName}가 찍음`}</span>}
      {/* 구운 사진(ADR-0024): 같은 자리에 <img>. 못 받으면 옛 경로 */}
      {p.shotId ? <PhotoImg shotId={p.shotId} className="cm-shot" alt={p.caption}>{legacy}</PhotoImg> : legacy}
      {/* 어디서 · 무엇을 (ADR-0029): 배경의 자리 이름이 앞에 붙는다 */}
      <div className="cm-cap">{p.spot && <b className="cm-spot">📍 {p.spot}</b>}{p.caption}</div>
    </div>
  );
}
