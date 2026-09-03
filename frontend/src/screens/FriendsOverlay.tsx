import { useWorld } from '../sim/store';
import { PLACES, placeById } from '../sim/places';
import { agentActivityAt, agentOfFriend } from '../sim/agents';
import { blockAtIn, blockDef } from '../sim/blocks';
import { localParts } from '../sim/tz';
import { Character } from '../character';
import { FriendHead } from '../character/FriendHead';
import { Button, Glyph } from '../ui';
import type { Friend } from '../sim/types';

/** The friends list: who they are, where they live, how we met, and what their agent is doing in this block. */
export function FriendsOverlay({ onClose }: { onClose: () => void }) {
  const friends = useWorld(s => s.memory.friends);
  const now = useWorld(s => s.now);
  const tz = useWorld(s => s.tz);
  const today = useWorld(s => s.today);
  const blockId = blockAtIn(now, tz);

  const metLine = (f: Friend) => {
    if (f.metAt === undefined) return '처음부터 친구';
    const p = localParts(f.metAt, tz);
    const where = f.metPlaceId ? PLACES.find(x => x.id === f.metPlaceId)?.name : null;
    return `${p.m}월 ${p.d}일${where ? ` · ${where}에서 만남` : ' · 새 친구'}`;
  };
  const nowLine = (f: Friend) => {
    if (blockId === 'sleep') return '자는 중';
    const a = agentActivityAt(agentOfFriend(f), blockId, today);
    if (!a) return '집에서 쉬는 중';
    return `${blockDef(blockId).label} · ${a.option.title}`;
  };

  return (
    <div className="book fr" role="dialog" aria-label="친구 목록">
      <div className="book-hd">
        <h2>친구<small className="num">{friends.length ? `${friends.length}명` : '아직 없음'}</small></h2>
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      {friends.length === 0 ? (
        <div className="book-empty">
          <Character pose="think" size={170} />
          <span>아직 친구가 없어요<br />같은 곳에서 마주치면 말을 걸어볼게요</span>
        </div>
      ) : (
        <div className="book-list">
          {friends.map(f => {
            const home = placeById(f.homePlaceId);
            return (
              <div key={f.id} className="book-item fr-item" style={{ ['--friend' as string]: f.color }}>
                <div className="fr-row">
                  <FriendHead size={44} color={f.color} title={f.name} />
                  <div className="fr-main">
                    <b>{f.name}</b>
                    <span className="fr-home">{f.emoji} {home.area}에 사는 친구</span>
                  </div>
                </div>
                <span className="fr-now"><i /> 지금 · {nowLine(f)}</span>
                <span className="book-meta num">{metLine(f)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
