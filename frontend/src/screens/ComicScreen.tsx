import { useWorld } from '../sim/store';
import type { ActivityOption, Comic, ComicPanel, Phase } from '../sim/types';
import { blockDef, categoryDef, nextBlockId } from '../sim/blocks';
import { cityNameKo } from '../sim/places';
import { Character } from '../character';
import { Bubble, Button, CompanionChip, JetlagChip, type ChipFriend } from '../ui';
import { beatPose, bookIntent } from './util';

type ComicPhase = Extract<Phase, { kind: 'comic' }>;

/** State 4 — 2x2 panels on paper-2, then two buttons: open in book (secondary; the comic is already saved) / next block (coral primary). */
export function ComicScreen({ phase, onNext }: { phase: ComicPhase; onNext: () => void }) {
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

  return (
    <div className={`cm ${hasWith ? 'has-with' : ''}`}>
      <div className="cm-head">
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
      <div className="cm-gridwrap"><ComicPanels comic={comic} option={act.option} friendColor={friend?.color} /></div>
      <Character className="cm-me" pose="happy" size={170} />
      <Bubble className="cm-me-bubble">오늘 이야기 완성!</Bubble>
      <div className="cm-stamp num">STORY #{String(no).padStart(2, '0')}</div>
      <div className="cm-foot">
        <Button onClick={() => { bookIntent.comicId = comic.id; setBookOpen(true); }}>book에서 보기</Button>
        <Button tone="coral" onClick={onNext}>
          {nextDecided ? '이동 보러 가기' : nb && nb !== 'sleep' ? `${blockDef(nb).label} 정하러 가기` : '다음 블록 정하러 가기'}
        </Button>
      </div>
    </div>
  );
}

/** The 2x2 grid (also used by the book viewer). Each panel: bg colour + poses + friend + caption strip. */
export function ComicPanels({ comic, option, friendColor }: { comic: Comic; option?: ActivityOption; friendColor?: string }) {
  return (
    <div className="cm-grid">
      {comic.panels.map((p, i) => <Panel key={i} p={p} i={i} option={option} friendColor={friendColor} />)}
    </div>
  );
}

function Panel({ p, i, option, friendColor }: { p: ComicPanel; i: number; option?: ActivityOption; friendColor?: string }) {
  const pose = beatPose(p.beat, option);
  const left = p.withFriend || p.beat === 'arrive';
  return (
    <div className="cm-p" style={{ background: p.bg }}>
      <div className="cm-floor" />
      <span className="cm-k">{i + 1}</span>
      <Prop beat={p.beat} withFriend={!!p.withFriend} />
      <Character className={`cm-c ${left ? 'is-left' : ''}`} pose={pose} size={118} />
      {p.withFriend && <Character className="cm-f" pose="wave" size={100} variant="friend" color={friendColor} />}
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
