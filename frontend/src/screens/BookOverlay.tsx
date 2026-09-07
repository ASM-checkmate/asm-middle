import { useState } from 'react';
import { useWorld } from '../sim/store';
import type { Comic } from '../sim/types';
import { blockDef } from '../sim/blocks';
import { Character } from '../character';
import { Button, Glyph } from '../ui';
import { PLACES } from '../sim/places';
import { companionsOf, encounterOf } from '../sim/timeline';
import { ComicPanels, ShotsLine } from './ComicScreen';
import { beatPose, bookIntent, castOf, shotCount } from './util';

/** The book: every comic, newest first. Tap to read. */
export function BookOverlay({ onClose, comics }: { onClose: () => void; comics?: Comic[] }) {
  const book = useWorld(s => s.book);
  const memory = useWorld(s => s.memory);
  const tz = useWorld(s => s.tz);
  const timeline = useWorld(s => s.timeline);
  const list = comics ?? [...book].reverse();
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = bookIntent.comicId;
    bookIntent.comicId = null;
    return id && list.some(c => c.id === id) ? id : null;
  });
  const cur = openId ? list.find(c => c.id === openId) ?? null : null;
  // 누가 찍었나 — 옛 만화(by 없음)는 전부 에이전트로 센다 (util.shotCount)
  const curShots = cur ? shotCount(cur) : null;
  // 사용자 컷을 찍었을 때의 옵션(포즈)·동행·마주침은 만화에 없다 — 타임라인의 그 활동에서 되찾아 ComicScreen과 같은 그림이 나오게 한다.
  // 지평선 밖으로 밀려난(KEEP_DAYS 지난) 옛 만화는 비트 포즈·컷의 withFriend로 대신한다
  const curAct = cur ? timeline.find(a => `c:${a.key}` === cur.id) : undefined;
  const cast = curAct ? castOf(companionsOf(curAct, memory), encounterOf(curAct, memory)) : undefined;
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
        {/* 아침에 그린 그림 (ADR-0004) — 상세 헤더에 40px 썸네일 */}
        {cur?.sketch && <img className="book-sketch" src={cur.sketch} alt="아침에 그린 그림" title="아침에 그린 것" draggable={false} />}
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      {cur ? (
        <div className="book-view">
          <ComicPanels comic={cur} option={curAct?.option} friendColor={cast?.friendColor ?? memory.friends[0]?.color} tz={tz} cast={cast} />
          {curShots && <ShotsLine className="book-shots" shots={curShots} name={memory.name} />}
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
                {/* 사용자 컷은 코랄 테두리 (ADR-0004) */}
                {c.panels.map((p, i) => <i key={i} className={p.by === 'user' ? 'is-user' : undefined} style={{ background: p.bg }}><Character pose={beatPose(p.beat)} size={30} /></i>)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
