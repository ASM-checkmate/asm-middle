import { useWorld } from '../sim/store';
import type { ActivityOption, BlockId, Comic, ComicPanel, Phase, PlaceType } from '../sim/types';
import { blockDef, categoryDef, nextBlockId } from '../sim/blocks';
import { cityNameKo, placeById } from '../sim/places';
import { Character } from '../character';
import { Bubble, Button, CompanionChip, JetlagChip, type ChipFriend } from '../ui';
import { beatPose, bookIntent, castOf, poseFor, shotCount, type ShotCast } from './util';
import { ShotStage } from './CameraOverlay';
import { hhmmIn } from '../sim/tz';

type ComicPhase = Extract<Phase, { kind: 'comic' }>;

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
        {/* 사용자 컷은 카메라가 찍을 때의 인물 구성(동행·마주침) 그대로 — 만화엔 없으니 phase에서 넘긴다 */}
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
 * @param cast 사용자 컷의 인물 구성 (util.castOf — 없으면 컷의 withFriend로 동행만 그린다: 지평선 밖 옛 만화)
 */
export function ComicPanels({ comic, option, friendColor, tz, cast }: { comic: Comic; option?: ActivityOption; friendColor?: string; tz?: string; cast?: ShotCast }) {
  // 에이전트 컷의 스티커 이름은 memory.name (Friend/Agent 이름이 아니다 — CONTRACT 문구 규칙)
  const agentName = useWorld(s => s.memory.name);
  return (
    <div className="cm-grid">
      {comic.panels.map((p, i) => <Panel key={i} p={p} i={i} option={option} friendColor={friendColor} tz={tz} placeType={comic.placeType} agentName={agentName} cast={cast} />)}
    </div>
  );
}

/** 에이전트 컷의 px 크롭을 %로 옮길 때의 컷 너비 (2열 격자, 390px 화면 기준) */
const AGENT_PANEL_PX = 170;

function Panel({ p, i, option, friendColor, tz, placeType, agentName, cast }: { p: ComicPanel; i: number; option?: ActivityOption; friendColor?: string; tz?: string; placeType: PlaceType; agentName: string; cast?: ShotCast }) {
  const mine = p.by === 'user';
  // 사용자 컷은 카메라 뷰파인더에 보이던 포즈(poseFor) 그대로 — 옵션을 못 찾는 옛 만화(book)에서만 비트 포즈로 대신한다
  const pose = mine ? (option ? poseFor(option) : beatPose(p.beat)) : beatPose(p.beat, option);
  // 옛 만화(질감 이전에 저장된 것)에는 crop/t가 없다 — 그때는 원래대로 정중앙 전신으로 그린다
  const c = p.crop ?? { scale: 1, x: 0, y: 0, rot: 0 };
  // 에이전트 컷의 x/y는 px(CONTRACT ComicPanel.unit) — 3D 무대(ShotStage)는 %로 받으니 컷 너비(≈170px)로 나눈다
  const agentCrop = p.unit === 'pct' ? c : { ...c, x: Math.round((c.x / AGENT_PANEL_PX) * 1000) / 10, y: Math.round((c.y / (AGENT_PANEL_PX * 1.08)) * 1000) / 10 };
  // 에이전트가 대충 찍은 흔적 (ADR-0004 오너 결정 14): is-dark/is-blur는 CSS가, overzoom/cut/tilt는 crop에 이미 반영돼 있다
  const flaws = p.flaws ?? [];
  const cls = ['cm-p', mine ? 'is-user' : '', p.withFriend ? 'has-f' : '', p.blur ? 'is-blur is-miss' : '', flaws.length ? 'has-flaw' : '', ...flaws.map(f => `is-${f}`)]
    .filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ background: p.bg }}>

      {/* 컷 번호 대신 그 컷이 찍힌 시각 — 이거 하나로 "삽화 → 기록"이 뒤집힌다 */}
      <span className="cm-k num">{p.t && tz ? hhmmIn(p.t, tz) : i + 1}</span>
      {/* 누가 찍었나 스티커 — 옛 만화(by 없음)에는 붙이지 않는다 (헤더 줄은 전부 에이전트로 센다: util.shotCount) */}
      {p.by && <span className="cm-by">{mine ? '내가 찍음' : `${agentName}가 찍음`}</span>}
      {mine ? (
        /* 카메라 뷰파인더와 **같은 컴포넌트**(ShotStage): 정지 무대 + 캐릭터(발이 78 % 높이) + 동행/마주침/실루엣, 크롭은 % —
           컷 비율(1/1.08)도 같아 "찍은 그대로"다. 인물 구성을 모르면(cast 없음) 컷의 withFriend로 동행만 */
        <ShotStage type={placeType} pose={pose} crop={c} friendColor={cast ? cast.friendColor : p.withFriend ? friendColor : undefined} metColor={cast?.metColor} seenColor={cast?.seenColor} still className="cm-usr" />
      ) : (
        /* 에이전트 컷도 같은 3D 무대 (ADR-0014 개정 4): 열화(흐림·어둠)는 CSS가 .cam-stage에, overzoom/cut/tilt는 crop에 */
        <>
          <ShotStage type={placeType} pose={pose} crop={agentCrop} friendColor={p.withFriend ? friendColor : undefined} still className="cm-agt" />
          <Prop beat={p.beat} withFriend={!!p.withFriend} />
        </>
      )}
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
