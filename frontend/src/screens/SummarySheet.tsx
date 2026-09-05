import { useWorld } from '../sim/store';
import { agentById } from '../sim/agents';
import type { DaySummaryItem } from '../sim/types';
import { blockDef } from '../sim/blocks';
import { Character } from '../character';
import { Button, CompanionChip, type ChipFriend } from '../ui';
import { blockRange, bookIntent, gapLabel } from './util';
import { toldLine, type AgentRequest } from '../sim/requests';
import { missedLine, type CallEvent } from '../sim/call';
import { hhmmIn } from '../sim/tz';

export interface SummarySheetProps {
  items: DaySummaryItem[];
  /** the stretch the owner was away for, in the character's zone — stamped at the top as evidence */
  gap?: { from: number; to: number } | null;
  /** 마감을 넘겨 에이전트가 혼자 정한 것들 — 무시된 부탁은 사라지지 않고 이야기가 되어 돌아온다 */
  untold?: AgentRequest[];
  /** 자리를 비운 사이 놓친 전화들. **시각만 남고 내용은 없다** (오너 결정: 안 받았으면 없는 것). */
  missed?: CallEvent[];
  tz: string;
  onClose: () => void;
}

/** Catch-up sheet: "자는 동안 이런 일이" — comics since the last visit. Tap one to read it in the book. */
export function SummarySheet({ items, gap, tz, untold = [], missed = [], onClose }: SummarySheetProps) {
  const setBookOpen = useWorld(s => s.setBookOpen);
  const memory = useWorld(s => s.memory);
  /** the friends who went along, as the chip needs them (memory first, the agent pool as a fallback) */
  const companionsOf = (it: DaySummaryItem): ChipFriend[] =>
    it.act.companions.map(id => {
      const f = memory.friends.find(x => x.id === id);
      if (f) return { id: f.id, name: f.name, color: f.color };
      const a = agentById(id);
      return a ? { id: a.id, name: a.name, color: a.color } : null;
    }).filter((f): f is ChipFriend => !!f);
  return (
    <>
      <div className="sheet-dim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="자는 동안 이런 일이">
        <div className="sheet-hd">
          <Character pose="wave" size={72} />
          <div>
            <h3>자는 동안 이런 일이</h3>
            <p>{items.length}개의 이야기가 쌓였어요</p>
          </div>
        </div>
        {/* 공백 밴드: 시각 자체가 "내가 없을 때도 돌아갔다"는 증거 (SPEC 자율 생활과 개입) */}
        {gap && (() => {
          const g = gapLabel(gap.from, gap.to, tz);
          return (
            <div className="sum-gap">
              <span className="sum-gap-r num">{g.range}</span>
              <span className="sum-gap-s">{g.span} 동안 혼자 있었어</span>
            </div>
          );
        })()}
        {/* 놓친 전화: 시각과 "안 받더라"만. 무슨 얘기였는지는 주지 않는다 (ADR-0001 §1) */}
        {!!missed.length && (
          <ul className="sum-missed">
            {missed.map(c => (
              <li key={c.id}><b className="num">{hhmmIn(c.at, tz)}</b> {missedLine()}</li>
            ))}
          </ul>
        )}
        {/* 답이 없어서 에이전트가 혼자 정한 것들 (ADR-0001 §1) */}
        {!!untold.length && (
          <ul className="sum-alone">
            {untold.map(r => (
              <li key={r.id}><b className="num">{hhmmIn(r.dueAt, tz)}</b> {toldLine(r)}</li>
            ))}
          </ul>
        )}
        <div className="sheet-list">
          {items.map(it => (
            <button key={it.comic.id} type="button" className="sum" onClick={() => { bookIntent.comicId = it.comic.id; onClose(); setBookOpen(true); }}>
              <div className="sum-ic" style={{ background: it.comic.panels[0]?.bg }}>{it.act.option.emoji}</div>
              <div>
                <span className="sum-meta num">{blockRange(it.blockId)} · {blockDef(it.blockId).label} 블록</span>
                <b>{it.comic.title}</b>
                <span>{it.comic.summary}</span>
                {/* 같이 간 친구는 요약 줄에도 얼굴로 */}
                {!!companionsOf(it).length && <CompanionChip className="sum-with" friends={companionsOf(it)} small />}
              </div>
            </button>
          ))}
        </div>
        <Button tone="ink" onClick={onClose}>다 봤어, 지금은 뭐 해?</Button>
      </div>
    </>
  );
}
