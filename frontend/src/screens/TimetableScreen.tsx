import { useState } from 'react';
import { useWorld } from '../sim/store';
import type { BlockId, Category, Phase, ScheduledActivity } from '../sim/types';
import { BLOCKS, BLOCK_ORDER, CATEGORIES, blockDef, blockEndAt, blockStartAt, categoryDef, hhmmIn } from '../sim/blocks';
import { dayStartOfKey, ownerTz } from '../sim/tz';
import { isBlockEditable } from '../sim/timeline';
import { cityNameKo } from '../sim/places';
import { primaryMode } from '../sim/journey';
import { STAY_CHOICES, withStayDays } from '../sim/suggest';
import { agentById } from '../sim/agents';
import { wonKo } from '../sim/status';
import type { TimetableWorld } from '../dev/preview';
import { Character, type Pose } from '../character';
import { Bubble, Button, Chip, CompanionChip, Glyph, JetlagChip, type ChipFriend } from '../ui';
import { Scene } from '../scenes';
import { CATEGORY_FILL, Ring, type RingSeg } from './Ring';
import { blockRange, bookIntent, dayTitle, progressLabel, shortTitle, transitNote, vehicleName } from './util';

type Waiting = Extract<Phase, { kind: 'waiting' }>;
type BlockState = 'sleep' | 'past' | 'current' | 'future';
/** How an activity relates to a block of today: planned in it, a trip spanning it, or a journey from another day/zone
 *  (the flight that lands this morning) — either still on the way (`transit`) or the block it arrives in (`landing`). */
type CoverKind = 'own' | 'span' | 'transit' | 'landing';

/** Placeholder copy on the three ghost cards before a category is picked (no skeletons — deck rule).
 *  The last line says out loud what an empty block can still become: 친구가 부르면 동행 계획이 들어온다 (FRIENDS_SPEC §2). */
const GHOST_COPY = ['이 시간에 뭐 할까?', '카페? 산책? 게임?', '친구가 부르면 같이 갈 수도'];
/** "당일치기 / 1박 / 2박" — the stay chips over the CTA (FRIENDS_SPEC §5). */
const stayLabel = (n: number) => (n > 0 ? `${n}박` : '당일치기');

/** State 1 — the character waits in the yard; the timetable card rises from under its feet.
 *  Every time on it (block bounds, the ring's hand, "09:00 출발") is read in `phase.tz`, the zone the day is lived in. */
export function TimetableScreen({ phase, asSheet, onClose, world }: { phase: Waiting; asSheet?: boolean; onClose?: () => void; world?: TimetableWorld }) {
  const storeNow = useWorld(s => s.now);
  const storePlans = useWorld(s => s.plans);
  const storeTimeline = useWorld(s => s.timeline);
  const storeToday = useWorld(s => s.today);
  const storeAnchor = useWorld(s => s.anchor);
  const { now, plans, timeline, today, anchor } = world ?? { now: storeNow, plans: storePlans, timeline: storeTimeline, today: storeToday, anchor: storeAnchor };
  const book = useWorld(s => s.book);
  const memory = useWorld(s => s.memory);
  const selectedBlock = useWorld(s => s.selectedBlock);
  const selectBlock = useWorld(s => s.selectBlock);
  const setCategory = useWorld(s => s.setCategory);
  const chooseOption = useWorld(s => s.chooseOption);
  const regenerateOptions = useWorld(s => s.regenerateOptions);
  const setBookOpen = useWorld(s => s.setBookOpen);
  const pushAnyway = useWorld(s => s.pushAnyway);
  const clearVerdict = useWorld(s => s.clearVerdict);
  const storeStatus = useWorld(s => s.status);
  const status = world?.status ?? storeStatus;

  const tz = phase.tz;
  const dayStart = dayStartOfKey(today);
  const bounds = (id: BlockId): [number, number] => [blockStartAt(dayStart, id), blockEndAt(dayStart, id)];
  const stateOf = (id: BlockId): BlockState =>
    id === 'sleep' ? 'sleep' : blockEndAt(dayStart, id) <= now ? 'past' : blockStartAt(dayStart, id) <= now ? 'current' : 'future';
  /** the activity occupying any moment of block `id` today (journey, activity and comic all count — same rule as the engine) */
  const coverOf = (id: BlockId): ScheduledActivity | undefined => { const [s, e] = bounds(id); return timeline.find(a => a.departAt < e && a.comicUntil > s); };
  const kindOf = (id: BlockId, a: ScheduledActivity): CoverKind =>
    a.dayKey === today && a.blockIds[0] === id ? 'own' : a.dayKey === today && a.blockIds.includes(id) ? 'span' : bounds(id)[1] <= a.arriveAt ? 'transit' : 'landing';
  const canEdit = (id: BlockId) => isBlockEditable(now, id, today, timeline, anchor);

  const firstEditable = BLOCK_ORDER.find(canEdit) ?? null;
  const sel: BlockId = selectedBlock && BLOCK_ORDER.includes(selectedBlock) ? selectedBlock : firstEditable ?? phase.currentBlockId;

  // local UI state, reset whenever the selected block changes
  const [pending, setPending] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** 체류 일수 chips: the nights the user picked for the selected travel option (null = the option's own default). */
  const [stay, setStay] = useState<number | null>(null);
  const [prevSel, setPrevSel] = useState(sel);
  if (prevSel !== sel) { setPrevSel(sel); setPending(null); setPicking(false); setStay(null); }

  const b = blockDef(sel);
  const plan = plans[sel];
  const cover = coverOf(sel);
  const kind = cover ? kindOf(sel, cover) : null;
  /** planned in this block, or a trip of today spanning it */
  const act = kind === 'own' || kind === 'span' ? cover : undefined;
  const span = kind === 'span' ? cover : undefined;
  /** a journey from another day/zone covering this block */
  const foreign = kind === 'transit' || kind === 'landing' ? cover : undefined;
  const st = stateOf(sel);
  const editable = canEdit(sel);
  const category = act?.option.category ?? plan.category;
  const catDef = category ? categoryDef(category) : null;
  const options = plan.options;
  const verdict = editable ? plan.verdict : undefined;
  const pendingId = pending ?? verdict?.optionId ?? plan.chosenId ?? options[0]?.id ?? null;
  /** 판정이 서 있는 동안에는 판단의 대상과 역제안만 남긴다 — 나머지는 지금 고를 수 있는 게 아니다 */
  const shownOptions = verdict ? options.filter(o => o.id === verdict.optionId || o.id === verdict.counterOptionId) : options;
  /** user-confirmed (an agent pre-pick still shows the '이걸로 정할래' action, deck-style) */
  const confirmed = !!plan.chosenId && plan.chosenBy === 'user' && pendingId === plan.chosenId;
  const ownAct = kind === 'own' ? cover : undefined;
  /** 정해둠 = the owner's own decisions and the friend proposals left standing — never the agent's block-start picks. */
  const decidedCount = BLOCK_ORDER.filter(id => id !== 'sleep' && (plans[id].chosenBy === 'user' || plans[id].chosenBy === 'friend')).length;
  // 상태는 게이지로 상주하지 않는다 (SPEC 메인 화면). 카드 안의 조용한 한 줄이 전부다.
  const statusLabel = `${decidedCount ? `${decidedCount}개 · ` : ''}${wonKo(status.money)} · 🔋${Math.round(100 - status.fatigue)}%`;
  /** A friend (or an agent we have not befriended yet) as the chip needs them — id, name, colour. */
  const chipFriend = (id?: string): ChipFriend | null => {
    if (!id) return null;
    const f = memory.friends.find(x => x.id === id);
    if (f) return { id: f.id, name: f.name, color: f.color };
    const a = agentById(id);
    return a ? { id: a.id, name: a.name, color: a.color } : null;
  };
  const chipFriends = (ids: string[]): ChipFriend[] => ids.map(chipFriend).filter((f): f is ChipFriend => !!f);
  /** 친구가 먼저 계획한 블록 (FRIENDS_SPEC §2) — the standing proposal, gone the moment the user picks something else. */
  const proposal = plan.chosenBy === 'friend' ? plan.options.find(o => o.id === plan.chosenId) : undefined;
  const proposer = chipFriend(proposal?.proposedBy);
  /** 비어 있는 미래 블록: no category, no options, nothing to show but the picker. */
  const emptyFuture = editable && !category && !plan.options.length;
  const pendingOpt = options.find(o => o.id === pendingId);
  const stayChoices = pendingOpt && pendingOpt.category === 'travel' ? STAY_CHOICES(pendingOpt) : [];
  const stayValue = stay ?? pendingOpt?.stayDays ?? null;
  const showStay = stayChoices.length > 1 && stayValue !== null;
  /** The card title with the picked nights written into it ("(2박)" / "당일치기"). */
  const titleOf = (o: typeof options[number]) =>
    o.id === pendingId && stay !== null && o.category === 'travel' ? withStayDays(o, stay).title : o.title;
  /** the CTA reads "정했어" only while the stay chips still match what was confirmed */
  const staySettled = confirmed && (stay === null || stay === pendingOpt?.stayDays);
  const abroad = tz !== ownerTz;
  const title = dayTitle(today, phase.at.city, abroad);

  const segs: RingSeg[] = BLOCKS.map(bd => {
    const a = coverOf(bd.id);
    const cat: Category | null = bd.id === 'sleep' ? 'sleep' : a?.option.category ?? null;
    const paint = (cat && CATEGORY_FILL[cat]) || { fill: 'var(--paper-2)', dark: false };   // unknown/legacy category → blank wedge
    return {
      id: bd.id,
      label: bd.id === 'sleep' ? '잠' : cat ? categoryDef(cat).label : '?',
      fill: paint.fill,
      dark: paint.dark,
      state: stateOf(bd.id),
      decided: !!a,
      diff: !!a?.outcome && a.outcome.plannedPlaceId !== a.place.id && now >= a.outcome.divertedAt,
    };
  });

  // what the character says
  const bubble = (() => {
    if (!firstEditable) return phase.nextBlockId ? '오늘 계획 다 세웠다!' : '오늘도 수고했어, 이제 잘 시간';
    if (!editable) {
      if (st === 'sleep') return '쿨쿨… 7시엔 일어날게';
      if (foreign) return kind === 'transit' ? `그땐 ${vehicleName(primaryMode(foreign.journey))} 안이었어` : `${b.label}에 ${cityNameKo(foreign.place.city)} 도착했어!`;
      if (span) return `${blockDef(span.blockIds[0]).label}부터 이어서 ${shortTitle(span.option.title)}!`;
      if (act && act.comicUntil <= now) return `${b.label}엔 ${shortTitle(act.option.title)} 했어`;
      if (act) return `지금은 ${progressLabel(act.option, act.place)}!`;
      return `${b.label} 블록은 지나갔어`;
    }
    if (proposer) return `${proposer.name}가 같이 가자는데, 갈까?`;
    if (plan.chosenBy === 'agent') return '내가 골라놨어, 바꿔도 돼';
    if (plan.chosenId) return '좋아, 이대로 갈게!';
    return `오늘 ${b.label}엔 뭐 할까?`;
  })();
  const pose: Pose = editable ? (plan.chosenId ? 'happy' : 'think') : st === 'sleep' ? 'sleep' : 'idle';

  const shown = foreign ?? act;
  const todayComic = shown ? book.find(c => c.id === `c:${shown.key}`) : undefined;
  /** waiting somewhere other than home (the previous activity's place) → that place's scene instead of the yard */
  const away = phase.at.type !== 'home' && phase.at.id !== memory.homePlaceId;
  const openComic = (id: string) => { bookIntent.comicId = id; setBookOpen(true); };

  // ── block info column ──
  /** the companions of whatever this block holds: the activity's, or the pending option's */
  const blockCompanions = chipFriends(shown ? shown.companions : pendingOpt?.friendId ? [pendingOpt.friendId] : []);
  const catChip = st === 'sleep'
    ? <Chip tone="night">😴 잠자기</Chip>
    : catDef && !foreign
      ? editable
        ? <button type="button" className="tt-chipbtn" onClick={() => setPicking(true)} aria-label="범주 바꾸기"><Chip>{catDef.emoji} {catDef.label}</Chip></button>
        : <Chip>{catDef.emoji} {catDef.label}</Chip>
      : foreign
        ? <Chip tone="night">{foreign.option.emoji} {kind === 'transit' ? `${vehicleName(primaryMode(foreign.journey))} 안` : '도착'}</Chip>
        : editable
          ? <Chip tone="ghost" onClick={() => setPicking(true)}>범주 고르기 ›</Chip>
          : <Chip tone="ghost">범주 없음</Chip>;

  // 범주 칩 옆에 동행 칩 (FRIENDS_SPEC 동행 표시 규칙)
  const chip = (
    <div className="tt-chips">
      {catChip}
      {!!blockCompanions.length && <CompanionChip friends={blockCompanions} small />}
    </div>
  );

  const note = editable
    ? (catDef && !picking
      ? <button type="button" className="tt-link" onClick={() => setPicking(true)}>범주 바꾸기 ›</button>
      : catDef && picking
        ? <button type="button" className="tt-link" onClick={() => setPicking(false)}>‹ 제안으로 돌아가기</button>
        : <div className="tt-note">{emptyFuture ? '비어 있어요 · 시작할 때 캐릭터가 알아서 골라요' : '범주만 정하면 내가 3개 제안할게'}</div>)
    : st === 'sleep'
      ? <div className="tt-note">잠자기로 정해진 시간이에요</div>
      : foreign
        ? <div className="tt-note">{kind === 'transit'
          ? transitNote(primaryMode(foreign.journey), foreign.place.city, foreign.tz !== foreign.originTz)
          : `${hhmmIn(foreign.arriveAt, tz)} 도착 · 여기서부터 ${cityNameKo(foreign.place.city)} 시간`}</div>
        : span
          ? <div className="tt-note">{now < span.arriveAt
            ? transitNote(primaryMode(span.journey), span.place.city, span.tz !== span.originTz)
            : '여행에 포함된 블록 · 끝날 때까지 지켜봐요'}</div>
          : act && act.comicUntil <= now
            ? <div className="tt-note">{st === 'past' ? '지나간 블록이에요 · 바꿀 수 없어요' : '이 블록은 끝났어요 · 다음 블록을 기다려요'}</div>
            : <div className="tt-note">지금 진행 중 · 끝날 때까지 지켜봐요</div>;

  // ── body ──
  let body;
  if (editable && (picking || !category)) {
    body = (
      <>
        <div className="tt-hint">{category ? '다른 범주로 바꿀까?' : '이 시간엔 뭘 할까? 범주를 골라줘'}</div>
        <div className="tt-cats">
          {CATEGORIES.map(c => (
            <Chip key={c.id} big tone={category === c.id ? 'sun' : 'paper'} on={category === c.id}
              onClick={() => { setCategory(sel, c.id); setPicking(false); setPending(null); }}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
        <div className="tt-ghost" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="opt opt--ghost">
              <div className="opt-ic">?</div>
              <div className="opt-tx"><span className="opt-ghost-tx">{GHOST_COPY[i]}</span></div>
            </div>
          ))}
          <div className="tt-ghost-note"><Glyph name="sparkle" size={14} color="#FF6A48" /> {category ? '바꾸면 새로 3개 제안할게' : '범주를 고르면 여기 3개가 나와요'}</div>
        </div>
      </>
    );
  } else if (editable) {
    body = (
      <>
        <div className="tt-head">
          {plan.chosenBy === 'agent'
            ? <span className="tt-agent"><Glyph name="sparkle" size={14} /> 캐릭터가 대신 골랐어요</span>
            : confirmed
              ? <span className="tt-agent is-ok"><Glyph name="check" size={14} color="#5FC9A6" /> 정해졌어요</span>
              : <span>안 고르면 첫 번째로 갈게</span>}
          <button type="button" className="tt-link" onClick={() => { regenerateOptions(sel); setPending(null); }}>
            다른 제안 보기 <Glyph name="refresh" size={13} color="#6B5B4B" />
          </button>
        </div>
        {shownOptions.length ? (
          <div className="tt-list">
            {shownOptions.map(o => {
              const on = o.id === pendingId;
              const f = chipFriend(o.friendId);
              // 친구 제안 카드는 라벨을 하나 더 단다; 다른 걸 고르면 동행이 취소되므로 (chosenBy ≠ 'friend') 라벨도 사라진다
              const asked = o.proposedBy && proposal?.id === o.id ? chipFriend(o.proposedBy) : null;
              return (
                <button key={o.id} type="button" className={`opt ${on ? 'is-on' : ''} ${verdict?.counterOptionId === o.id ? 'is-counter' : ''}`} onClick={() => { setPending(o.id); setStay(null); }} aria-pressed={on}>
                  <div className="opt-ic">{o.emoji}</div>
                  <div className="opt-tx">
                    <b>{titleOf(o)}</b>
                    {/* 친구 제안 카드는 이유 대신 그 한 줄 ("민수가 같이 가자고 함"과 겹치지 않게) */}
                    {asked ? <span className="opt-ask">{asked.name}가 같이 가자고 해요</span> : <span>{o.reason}</span>}
                  </div>
                  {f && <CompanionChip friends={[f]} small className="opt-friend" />}
                  {on && <span className="opt-check"><Glyph name="check" size={14} color="#fff" /></span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="tt-empty">제안을 준비하는 중… <button type="button" className="tt-link" onClick={() => category && setCategory(sel, category)}>다시 받기</button></div>
        )}
        {/* 예고 (ADR-0001): 확정하면 에이전트가 자기 예측을 남긴다. 결과가 이 말을 배반할 수 있어야 한다. */}
        {confirmed && pendingOpt?.forecast && !verdict && (
          <div className="tt-forecast"><b>예고</b> {pendingOpt.forecast}</div>
        )}
        {showStay && (
          <div className="tt-stay" role="group" aria-label="며칠 머물까">
            <span className="tt-stay-k">며칠 있을까?</span>
            <div className="tt-stay-row">
              {stayChoices.map(n => (
                <Chip key={n} tone={n === stayValue ? 'sun' : 'paper'} on={n === stayValue} className="tt-stay-c" onClick={() => setStay(n)}>
                  {stayLabel(n)}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {/* 에이전트의 판단 (ADR-0001): 반대는 밀어붙일 수 있고, 거절은 못 한다 */}
        {verdict ? (
          <div className={`tt-verdict is-${verdict.kind}`} role="status">
            <Bubble className="tt-verdict-say">{verdict.line}</Bubble>
            {verdict.evidence && (
              <Chip tone="coral" className="tt-verdict-ev">{verdict.evidence.label} <b className="num">{verdict.evidence.value}</b></Chip>
            )}
            <div className="tt-verdict-btns">
              <Button tone="paper" small onClick={() => { clearVerdict(sel); setPending(verdict.counterOptionId ?? null); }}>
                {verdict.counterOptionId ? '그래, 네 맘대로' : '알겠어, 딴 거 고를게'}
              </Button>
              {verdict.kind === 'pushback' && (
                <Button tone="coral" small onClick={() => pushAnyway(sel)}>
                  그래도 가 · 기분 −{Math.abs(verdict.cost?.mood ?? 0)}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <Button className="tt-cta" tone={staySettled ? 'done' : 'ink'} disabled={!pendingId}
            onClick={() => pendingId && chooseOption(sel, pendingId, 'user', showStay ? stayValue ?? undefined : undefined)}>
            {staySettled ? (ownAct ? `정했어 · ${hhmmIn(ownAct.departAt, tz)} 출발` : '이걸로 정했어') : '이걸로 정할래'}
          </Button>
        )}
      </>
    );
  } else {
    // "12:30 출발 · 14:35 끝" — a zone jump names the arrival city, a foreign journey names the city it left
    const when = (a: ScheduledActivity) => {
      if (foreign) return `${cityNameKo(a.fromPlace.city)} ${hhmmIn(a.departAt, a.originTz)} 출발 · ${hhmmIn(a.arriveAt, a.tz)} 도착`;
      if (a.tz !== a.originTz) return `${hhmmIn(a.departAt, a.originTz)} 출발 · ${cityNameKo(a.place.city)} ${hhmmIn(a.arriveAt, a.tz)} 도착`;
      return `${hhmmIn(a.departAt, tz)} 출발 · ${hhmmIn(a.endAt, tz)} 끝`;
    };
    const tag = (a: ScheduledActivity) => a.comicUntil <= now ? '했어요' : now < a.arriveAt ? '이동 중' : kind === 'transit' ? '도착했어요' : span ? '여행 중' : '진행 중';
    // 발길을 돌린 뒤에만 어긋남을 드러낸다 — 아직 도착 전인 블록의 제목이 새면 안 된다
    const shownDiverted = !!shown?.outcome && shown.outcome.plannedPlaceId !== shown.place.id && now >= shown.outcome.divertedAt;
    body = st === 'sleep' ? (
      <div className="done">
        <div className="opt-ic">😴</div>
        <div className="opt-tx"><b>잠자기</b><span>00:00 – 07:00 · 매일 고정</span></div>
        <Chip tone="night" className="done-tag">고정</Chip>
      </div>
    ) : shown ? (
      <>
        <div className="done">
          <div className="opt-ic">{shown.place.emoji}</div>
          <div className="opt-tx">
            {/* 어긋난 블록은 계획을 취소선으로 남기고 실제로 간 곳을 아래에 쓴다 (ADR-0001) */}
            {shownDiverted && <span className="done-was">{shown.outcome!.plannedTitle}</span>}
            <b>{shownDiverted ? `${shown.place.name}에서 ${shortTitle(shown.option.title)}` : shown.option.title}</b>
            <span>{shown.outcome && now >= shown.outcome.divertedAt ? shown.outcome.line : shown.option.reason}</span>
          </div>
          <Chip className="done-tag" tone={shownDiverted ? 'coral' : shown.comicUntil <= now ? 'mint' : 'sun'}>{shownDiverted ? '바뀜' : tag(shown)}</Chip>
        </div>
        <div className="tt-head" style={{ marginTop: 6 }}>
          <span>{when(shown)}</span>
          {todayComic && <button type="button" className="tt-link" onClick={() => openComic(todayComic.id)}>만화 다시 보기 ›</button>}
        </div>
      </>
    ) : (
      <div className="tt-note" style={{ marginTop: 8 }}>이 블록엔 아무것도 없었어요</div>
    );
  }

  if (asSheet) {
    return (
      <div className={`tt tt-sheet ${verdict ? 'is-judging' : ''}`} role="dialog" aria-label="생활계획표">
        <button type="button" className="tt-backdrop" aria-label="닫기" onClick={onClose} />
        <div className="tt-panel">
          {phase.jetlag && <JetlagChip sticker className="tt-sheet-jetlag" />}
          <div className="tt-grip" aria-hidden="true" />
          <div className="tt-ttl"><span className="tt-ttl-tx">{title}</span><small className="num">{statusLabel}</small>
            <button type="button" className="tt-close" aria-label="닫기" onClick={onClose}><Glyph name="close" size={18} /></button>
          </div>
          <div className="tt-row">
            <Ring segs={segs} selected={sel} now={now} tz={tz} center={b.label} onSelect={selectBlock} />
            <div className="tt-info">
              <div className="tt-bl">{blockRange(sel)}</div>
              <div className="tt-bh">{b.label} 블록</div>
              {chip}
              {note}
            </div>
          </div>
          <div className="tt-body">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`tt ${verdict ? 'is-judging' : ''}`}>
      {away ? (
        <div className="tt-scene"><Scene type={phase.at.type} hush /></div>
      ) : (
        <>
          <div className="tt-sky" />
          <div className="tt-sun" />
          <div className="tt-cloud c1" />
          <div className="tt-cloud c2" />
          <div className="tt-hill" />
          <div className="tt-hill2" />
          <Yard />
        </>
      )}
      <Bubble key={bubble} className="tt-bubble">
        {bubble}
        {!!phase.companions.length && (
          <small className="tt-bubble-with">
            <CompanionChip friends={phase.companions} small />
            {phase.companions[0].name}랑 같이 가요
          </small>
        )}
        {away && <small className="tt-bubble-where">{phase.at.emoji} {phase.at.name}에서 기다리는 중</small>}
        {phase.jetlag && <JetlagChip sticker />}
      </Bubble>
      <Character className="tt-chara" pose={pose} size={290} />
      <div className="tt-panel">
        <div className="tt-ttl"><span className="tt-ttl-tx">{title}</span><small className="num">{statusLabel}</small></div>
        <div className="tt-row">
          <Ring segs={segs} selected={sel} now={now} tz={tz} center={b.label} onSelect={selectBlock} />
          <div className="tt-info">
            <div className="tt-bl">{blockRange(sel)}</div>
            <div className="tt-bh">{b.label} 블록</div>
            {chip}
            {note}
          </div>
        </div>
        <div className="tt-body">{body}</div>
      </div>
    </div>
  );
}

/** Fence + flowers on the hill (the character's 마당). */
function Yard() {
  return (
    <svg className="tt-yard" viewBox="0 0 390 120" preserveAspectRatio="none" aria-hidden="true">
      <g fill="#FFF6E6" stroke="#2A2118" strokeWidth="2.5" strokeLinejoin="round">
        {[14, 44, 74, 104].map(x => <path key={x} d={`M${x} 62l8-10 8 10v30h-16z`} />)}
        {[290, 320, 350, 380].map(x => <path key={x} d={`M${x} 62l8-10 8 10v30h-16z`} />)}
        <rect x="6" y="70" width="122" height="6" rx="3" /><rect x="282" y="70" width="112" height="6" rx="3" />
      </g>
      {[[150, 104, '#FF6A48'], [172, 112, '#FFC64D'], [236, 110, '#A9DCF5'], [258, 102, '#FF6A48'], [130, 114, '#FFC64D'], [275, 116, '#FFC64D']].map(([x, y, c], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M0 0v-12" stroke="#2A2118" strokeWidth="2" strokeLinecap="round" />
          <circle cy="-15" r="5.5" fill={c as string} stroke="#2A2118" strokeWidth="2" />
          <circle cy="-15" r="1.8" fill="#FFF6E6" />
        </g>
      ))}
      <g transform="translate(330 96)">
        <rect x="-4" y="-30" width="8" height="34" fill="#2A2118" />
        <rect x="-16" y="-44" width="32" height="20" rx="6" fill="#FF6A48" stroke="#2A2118" strokeWidth="2.5" />
        <circle cx="8" cy="-34" r="2.5" fill="#FFF6E6" />
      </g>
    </svg>
  );
}
