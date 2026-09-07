import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorld } from '../sim/store';
import type { Phase } from '../sim/types';
import { blockAtIn, nextBlockId } from '../sim/blocks';
import { movingPhase } from '../sim/timeline';
import { placeById } from '../sim/places';
import { MapScene } from '../map';
import { TopChrome } from '../ui';
import { usePreview, usePreviewOverlay } from '../dev/preview';
import { TimetableScreen } from './TimetableScreen';
import { ActivityScreen } from './ActivityScreen';
import { ComicScreen } from './ComicScreen';
import { SleepScreen } from './SleepScreen';
import { SummarySheet } from './SummarySheet';
import { BookOverlay } from './BookOverlay';
import { FriendsOverlay } from './FriendsOverlay';
import { RequestCard } from './RequestCard';
import { CallOverlay } from './CallOverlay';
import { ChatOverlay } from './ChatOverlay';
import { SayBubble } from './SayBubble';
import { SketchOverlay } from './SketchOverlay';
import { CameraOverlay } from './CameraOverlay';
import { pendingOf, untoldOf } from '../sim/requests';
import { buildThread, unreadCount } from '../sim/chat';
import { chromeLabel } from './util';
import './screens.css';

type ScreenKind = 'timetable' | 'map' | 'active' | 'comic' | 'sleep';
const SCREEN_OF: Record<Phase['kind'], ScreenKind> = { waiting: 'timetable', moving: 'map', active: 'active', comic: 'comic', sleeping: 'sleep' };
/** How long the leaving screen stays mounted (must cover its exit animation). */
const LEAVE_MS: Partial<Record<string, number>> = { 'timetable>map': 760, 'map>active': 1000 };
/** MOVEMENT_SPEC §6.2: the map keeps the screen for 900 ms after p = 1 (pin bounce, two-hop, confetti, easeTo), then the
 *  iris + reverse FLIP start. The store flips to `active` on its 1 Hz tick (0–1000 ms after arrival), so Home holds the
 *  map until that wall-clock moment itself; the map's own `onArrive` (1800 ms) is only a fallback. */
const ARRIVE_HOLD_MS = 1000;   // spec 900 + ~100 ms: the map's rAF notices p = 1 a frame or two after the store clock
const DEFAULT_LEAVE_MS = 460;
/** Mount the next ride's map (hidden) this long before departure, in sim ms, so the departure morph lands on a live map. */
const PREWARM_SIM_MS = 150_000;
/** Without a pre-warmed map, MapLibre's synchronous construction blocks the main thread ~0.7 s; let the morph play first. */
const MAP_HOLD_MS = 620;

/** One home, five states. Switches on phase.kind, keeps the top chrome, animates between states. */
/** The timetable sheet can open from any state: it only needs "where the character is" and the current block. */
function pseudoWaiting(phase: Phase, now: number): Extract<Phase, { kind: 'waiting' }> {
  if (phase.kind === 'waiting') return phase;
  const at = phase.kind === 'moving' ? phase.act.fromPlace : phase.kind === 'sleeping' ? phase.at : phase.act.place;
  const cur = blockAtIn(now, phase.tz);
  const jetlag = phase.kind === 'active' || phase.kind === 'comic' ? phase.jetlag : false;
  const companions = phase.kind === 'sleeping' ? [] : phase.companions;
  return { kind: 'waiting', at, currentBlockId: cur, nextBlockId: nextBlockId(cur), nextStartAt: null, tz: phase.tz, jetlag, companions };
}

/** The city the character calls home — the chrome sub-line names every other city. */
const homeCityOf = (homePlaceId: string) => { try { return placeById(homePlaceId).city; } catch { return 'seoul'; } };

export function Home() {
  const storePhase = useWorld(s => s.phase);
  const storeNow = useWorld(s => s.now);
  const memory = useWorld(s => s.memory);
  const summary = useWorld(s => s.summary);
  const storeGap = useWorld(s => s.gap);
  const requests = useWorld(s => s.requests);
  const calls = useWorld(s => s.calls);
  const storeCall = useWorld(s => s.activeCall);
  const messages = useWorld(s => s.messages);
  const chatOpen = useWorld(s => s.chatOpen);
  const chatSeen = useWorld(s => s.chatSeen);
  const setChatOpen = useWorld(s => s.setChatOpen);
  const say = useWorld(s => s.say);
  const dismissSay = useWorld(s => s.dismissSay);
  const sketchOpen = useWorld(s => s.sketchOpen);
  const setSketchOpen = useWorld(s => s.setSketchOpen);
  const cameraOpen = useWorld(s => s.cameraOpen);
  const setCameraOpen = useWorld(s => s.setCameraOpen);
  const schedule = useWorld(s => s.timeline);
  const bookOpen = useWorld(s => s.bookOpen);
  const scale = useWorld(s => s.clock.scale);
  const setBookOpen = useWorld(s => s.setBookOpen);
  const ttOpen = useWorld(s => s.ttOpen);
  const setTtOpen = useWorld(s => s.setTtOpen);
  const selectBlock = useWorld(s => s.selectBlock);
  const friendsOpen = useWorld(s => s.friendsOpen) || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('preview') === 'friends');
  const setFriendsOpen = useWorld(s => s.setFriendsOpen);
  const dismissSummary = useWorld(s => s.dismissSummary);
  const markRequestTold = useWorld(s => s.markRequestTold);

  const { phase: preview, world: previewWorld, now: previewNow, camera: previewCamera } = usePreview();
  const previewOverlay = usePreviewOverlay();
  const isPreview = preview !== null;
  /** a `?preview=timetable&hour=` world carries its own "now" */
  const now = previewNow ?? storeNow;
  const homeCity = homeCityOf(memory.homePlaceId);

  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  const [previewClosed, setPreviewClosed] = useState({ summary: false, book: false });
  /** `?preview=active:…&camera=1` — 마운트 때 카메라를 연 것으로 친다. 스토어는 안 건드린다 (dev/preview.ts 계약) */
  const [previewCam, setPreviewCam] = useState(previewCamera);

  // the map's arrival beat can hand over to the scene slightly before the sim tick flips the phase
  useEffect(() => { if (storePhase.kind !== 'moving') setArrivedKey(null); }, [storePhase.kind]);
  const movingKeyRef = useRef<string | null>(null);
  const onArrive = useCallback(() => { const k = movingKeyRef.current; if (k) setArrivedKey(k); }, []);

  let phase: Phase = preview ?? storePhase;
  const lastPhaseRef = useRef(phase);
  // ── arrival hold: moving → active for the same activity keeps the map for ARRIVE_HOLD_MS wall ms after p = 1 ──
  const holdRef = useRef<{ key: string; until: number } | null>(null);
  const [, wake] = useState(0);
  if (!isPreview && phase.kind === 'active') {
    const key = phase.act.key;
    const prev = lastPhaseRef.current;
    if (prev.kind === 'moving' && prev.act.key === key && holdRef.current?.key !== key) {
      const wallSinceArrival = (now - phase.act.arriveAt) / Math.max(1, scale);
      holdRef.current = { key, until: performance.now() + Math.max(0, ARRIVE_HOLD_MS - wallSinceArrival) };
    }
    if (holdRef.current?.key === key && performance.now() < holdRef.current.until) phase = movingPhase(phase.act.arriveAt, phase.act);
  }
  const holdUntil = phase.kind === 'moving' && holdRef.current?.key === phase.act.key ? holdRef.current.until : null;
  useEffect(() => {
    if (holdUntil === null) return;
    const id = window.setTimeout(() => wake(n => n + 1), Math.max(0, holdUntil - performance.now()) + 4);
    return () => window.clearTimeout(id);
  }, [holdUntil]);
  if (!isPreview && phase.kind === 'moving' && arrivedKey === phase.act.key) {
    const act = phase.act;
    phase = { kind: 'active', act, remainingMin: Math.max(1, Math.ceil((act.endAt - now) / 60_000)), progress: 0, tz: act.tz, jetlag: act.jetlagUntil !== null && now < act.jetlagUntil, companions: phase.companions, encounter: phase.encounter };
  }
  movingKeyRef.current = phase.kind === 'moving' ? phase.act.key : null;
  const screen = SCREEN_OF[phase.kind];

  // ── 카메라 (ADR-0004 오너 결정 7): 활동 중에만 뜬다. 활동이 끝나 만화로 넘어가면 접는다 — 만화는 endAt에 한 번 굳어
  //    (store.addShot 가드) 더 찍을 곳이 없고, 스토어 플래그가 남아 다음 활동에서 저절로 열리면 안 된다 ──
  const camPhase = phase.kind === 'active' && (cameraOpen || previewCam) ? phase : null;
  useEffect(() => { if (cameraOpen && phase.kind !== 'active') setCameraOpen(false); }, [cameraOpen, phase.kind, setCameraOpen]);
  const closeCamera = () => { setCameraOpen(false); setPreviewCam(false); };

  // ── transitions: keep the previous screen mounted as a "ghost" while it animates out ──
  // The ghost is derived during render (not in an effect) so the leaving screen never unmounts for a frame;
  // its exit keyframes start on the very render that brings the new screen in.
  const [ghost, setGhost] = useState<{ screen: ScreenKind; phase: Phase } | null>(null);
  const [prevScreen, setPrevScreen] = useState(screen);
  if (prevScreen !== screen) {
    setGhost({ screen: prevScreen, phase: lastPhaseRef.current });
    setPrevScreen(screen);
  }
  lastPhaseRef.current = phase;
  useEffect(() => {
    if (!ghost) return;
    const id = window.setTimeout(() => setGhost(null), LEAVE_MS[`${ghost.screen}>${screen}`] ?? DEFAULT_LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [ghost, screen]);

  // ── map pre-warm: the upcoming ride's map is mounted hidden under the timetable shortly before departure ──
  const upcoming = !isPreview && phase.kind === 'waiting'
    ? schedule.find(a => a.departAt > now && a.departAt - now <= PREWARM_SIM_MS) ?? null
    : null;
  const movingKey = phase.kind === 'moving' ? phase.act.key : null;
  const prewarmRef = useRef<string | null>(null);
  if (phase.kind === 'waiting') prewarmRef.current = upcoming?.key ?? null;
  // decided once per moving episode (reset whenever we are not moving, so a dev jump back and forth re-evaluates)
  const decisionRef = useRef<{ key: string; prewarmed: boolean } | null>(null);
  if (!movingKey) decisionRef.current = null;
  else if (decisionRef.current?.key !== movingKey) decisionRef.current = { key: movingKey, prewarmed: prewarmRef.current === movingKey };
  const [heldMapReleased, setHeldMapReleased] = useState<string | null>(null);
  const holdMap = !!movingKey && !decisionRef.current?.prewarmed && ghost?.screen === 'timetable' && heldMapReleased !== movingKey;
  useEffect(() => {
    if (!holdMap || !movingKey) return;
    const id = window.setTimeout(() => setHeldMapReleased(movingKey), MAP_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [holdMap, movingKey]);

  const render = (p: Phase, isGhost: boolean): ReactNode => {
    switch (p.kind) {
      case 'waiting': return <TimetableScreen phase={p} world={previewWorld ?? undefined} />;
      case 'moving': return holdMap ? <div className="scr-hold" /> : <MapScene act={p.act} onArrive={isGhost || isPreview ? undefined : onArrive} />;
      case 'active': return <ActivityScreen phase={p} />;
      // 만화의 "다음" 버튼은 시간표를 **시트로** 연다 — 기본 화면을 시간표로 바꾸면 내릴 수 없고 크롬의 링 버튼도 사라진다.
      // 만화 창이 끝나면(comicUntil) 스토어가 알아서 대기(시간표)로 넘어간다.
      case 'comic': return <ComicScreen phase={p} onNext={block => { selectBlock(block); setTtOpen(true); }} />;
      case 'sleeping': return <SleepScreen phase={p} />;
    }
  };

  const layers: { key: ScreenKind; cls: string; node: ReactNode }[] = [];
  if (upcoming && screen !== 'map' && ghost?.screen !== 'map') layers.push({ key: 'map', cls: 'scr scr-prewarm', node: <MapScene act={upcoming} /> });
  if (ghost && ghost.screen !== screen) layers.push({ key: ghost.screen, cls: `scr scr-leave to-${screen}`, node: render(ghost.phase, true) });
  layers.push({ key: screen, cls: `scr scr-enter from-${ghost && ghost.screen !== screen ? ghost.screen : 'none'}`, node: render(phase, false) });

  // ── overlays ──
  const summaryItems = previewOverlay.summary && !previewClosed.summary ? previewOverlay.summary : summary;
  const summaryGap = previewOverlay.summary && !previewClosed.summary ? previewOverlay.gap : storeGap;
  const untold = untoldOf(requests);
  const closeSummary = () => {
    for (const r of untold) markRequestTold(r.id);
    if (previewOverlay.summary) setPreviewClosed(s => ({ ...s, summary: true })); else dismissSummary();
  };
  const showBook = bookOpen || (!!previewOverlay.book && !previewClosed.book);
  const pendingReq = previewOverlay.request ?? pendingOf(requests, now)[0] ?? null;
  const activeCall = previewOverlay.call ?? storeCall;
  // 대화 실 (ADR-0002): 쪽지·통화·자유 대화가 한 줄로 섞인다. 배지는 아직 안 본 줄의 개수.
  const showChat = chatOpen || previewOverlay.chat;
  const unread = unreadCount(buildThread(messages, requests, calls, now), chatSeen);
  const closeBook = () => { setBookOpen(false); if (previewOverlay.book) setPreviewClosed(s => ({ ...s, book: true })); };
  // 혼잣말이 **실제로 떠 있는지** — 시트·통화·요약이 가리거나 지도 위(이동 중·도착 홀드)면 말풍선이 안 그려지고, say는 SayBubble의
  // onDone(dismissSay)으로만 지워진다. 그래서 쪽지 카드는 say 자체가 아니라 이 값에만 비킨다: 지도 위에서 고민에 답해 say가 생긴 채
  // 비행처럼 긴 이동을 하면 카드가 이동 내내 숨어 마감(dueAt)이 지나가 버린다 (ADR-0001 §1의 "한 번에 하나"는 보이는 것끼리의 규칙)
  const sayVisible = !!say && !showChat && !activeCall && !summaryItems?.length && screen !== 'map';

  return (
    <div className={`home home--${screen}`}>
      {layers.map(l => <div key={l.key} className={l.cls}>{l.node}</div>)}
      <TopChrome now={now} tz={phase.tz} label={chromeLabel(now, phase, homeCity)} tone={screen === 'sleep' ? 'paper' : 'ink'} onBook={() => setBookOpen(true)} onTimetable={() => setTtOpen(true)} hideTimetable={screen === 'timetable'} onFriends={() => setFriendsOpen(true)} onChat={() => setChatOpen(true)} unread={unread} scale={scale} />
      {showChat && <ChatOverlay tz={phase.tz} onClose={() => setChatOpen(false)} />}
      {/* 혼잣말: 대가 없이 지나가는 1단계 (ADR-0001 §1). 시트가 떠 있으면 자리를 비켜 주고, 지도 위(이동 중·도착 홀드)에는 안 띄운다 —
          도착 혼잣말(store tick 'arrive-ask', ADR-0004 오너 결정 6)은 활동 화면에서 보인다 */}
      {sayVisible && say && <SayBubble text={say.text} onDone={dismissSay} />}
      {activeCall && <CallOverlay call={activeCall} tz={phase.tz} />}
      {friendsOpen && <FriendsOverlay onClose={() => setFriendsOpen(false)} />}
      {ttOpen && screen !== 'timetable' && <TimetableScreen phase={pseudoWaiting(phase, now)} asSheet onClose={() => setTtOpen(false)} world={previewWorld ?? undefined} />}
      {/* 그려서 알려줘 (ADR-0004): 시간표 시트(z 45) 위. 카드 분기의 "✎ 카드 대신 그려서 알려줄래" / 그림 카드의 "다시 그리기"가 연다 */}
      {sketchOpen && <SketchOverlay blockId={sketchOpen} onClose={() => setSketchOpen(null)} />}
      {/* 카메라: nowMs는 ActivityScreen과 같은 식으로 progress에서 되짚는다 — 화면은 스토어의 now를 따로 안 읽는다. preview면 샷은 오버레이 로컬 */}
      {camPhase && <CameraOverlay act={camPhase.act} progress={camPhase.progress} nowMs={camPhase.act.arriveAt + (camPhase.act.endAt - camPhase.act.arriveAt) * Math.min(1, Math.max(0, camPhase.progress))} companions={camPhase.companions} encounter={camPhase.encounter} preview={isPreview} onClose={closeCamera} />}
      {/* 쪽지: 시트·그림·카메라가 떠 있지 않고 혼잣말이 (보이는 채로) 지나가는 중도 아닐 때만, 한 번에 하나 (ADR-0001 §1) */}
      {pendingReq && !summaryItems?.length && !ttOpen && !showBook && !friendsOpen && !sketchOpen && !camPhase && !sayVisible && <RequestCard req={pendingReq} tz={phase.tz} />}
      {summaryItems && summaryItems.length > 0 && <SummarySheet items={summaryItems} gap={summaryGap} tz={phase.tz} untold={untold} missed={summaryGap ? calls.filter(c => c.dir === 'in' && c.result !== 'answered' && c.at >= summaryGap.from && c.at <= summaryGap.to) : []} onClose={closeSummary} />}
      {showBook && <BookOverlay onClose={closeBook} comics={previewOverlay.book ?? undefined} />}
    </div>
  );
}
