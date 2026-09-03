import { useWorld } from '../sim/store';
import { agentById } from '../sim/agents';
import type { DaySummaryItem } from '../sim/types';
import { blockDef } from '../sim/blocks';
import { Character } from '../character';
import { Button, CompanionChip, type ChipFriend } from '../ui';
import { blockRange, bookIntent } from './util';

/** Catch-up sheet: "자는 동안 이런 일이" — comics since the last visit. Tap one to read it in the book. */
export function SummarySheet({ items, onClose }: { items: DaySummaryItem[]; onClose: () => void }) {
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
