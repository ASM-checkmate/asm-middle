import { useState } from 'react';
import { useWorld } from '../sim/store';
import type { Comic } from '../sim/types';
import { blockDef } from '../sim/blocks';
import { Character } from '../character';
import { Button, Glyph } from '../ui';
import { PLACES } from '../sim/places';
import { ComicPanels } from './ComicScreen';
import { beatPose, bookIntent } from './util';

/** The book: every comic, newest first. Tap to read. */
export function BookOverlay({ onClose, comics }: { onClose: () => void; comics?: Comic[] }) {
  const book = useWorld(s => s.book);
  const memory = useWorld(s => s.memory);
  const tz = useWorld(s => s.tz);
  const list = comics ?? [...book].reverse();
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = bookIntent.comicId;
    bookIntent.comicId = null;
    return id && list.some(c => c.id === id) ? id : null;
  });
  const cur = openId ? list.find(c => c.id === openId) ?? null : null;
  /** "2026-09-03 · 오전 블록 · 연남동" — the real 동네 (the comic only carries the place name) */
  const meta = (c: Comic) => `${c.dateKey} · ${blockDef(c.blockId).label} 블록 · ${PLACES.find(p => p.name === c.placeName)?.area ?? c.placeName}`;

  return (
    <div className="book" role="dialog" aria-label="book">
      <div className="book-hd">
        {cur && <Button round ariaLabel="목록으로" onClick={() => setOpenId(null)}><Glyph name="back" /></Button>}
        <h2>
          {cur ? cur.title : 'book'}
          <small className="num">{cur ? meta(cur) : `${list.length}개의 이야기`}</small>
        </h2>
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      {cur ? (
        <div className="book-view">
          <ComicPanels comic={cur} friendColor={memory.friends[0]?.color} tz={tz} />
          <p className="book-sum">{cur.summary}</p>
        </div>
      ) : list.length === 0 ? (
        <div className="book-empty">
          <Character pose="think" size={170} />
          <span>아직 이야기가 없어요<br />캐릭터가 다녀오면 여기에 쌓여요</span>
        </div>
      ) : (
        <div className="book-list">
          {list.map(c => (
            <button key={c.id} type="button" className="book-item" onClick={() => setOpenId(c.id)}>
              <span className="book-meta num">{meta(c)}</span>
              <b>{c.title}</b>
              <span>{c.summary}</span>
              <div className="book-thumbs" aria-hidden="true">
                {c.panels.map((p, i) => <i key={i} style={{ background: p.bg }}><Character pose={beatPose(p.beat)} size={30} /></i>)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
