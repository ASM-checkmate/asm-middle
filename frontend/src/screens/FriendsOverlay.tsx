import { useWorld } from '../sim/store';
import { hasPlace, placeById } from '../sim/places';
import { friendNow } from '../sim/agents';
import { blockDef } from '../sim/blocks';
import { localParts } from '../sim/tz';
import { Character } from '../character';
import { FriendHead } from '../character/FriendHead';
import { Button, Glyph } from '../ui';
import type { Friend } from '../sim/types';
import { currentUser } from '../sim/api';
import { switchUser } from '../sim/sync';

/** The friends list: who they are, where they live, how we met, and what their agent is doing in this block. */
export function FriendsOverlay({ onClose }: { onClose: () => void }) {
  const friends = useWorld(s => s.memory.friends);
  const now = useWorld(s => s.now);
  const tz = useWorld(s => s.tz);
  const today = useWorld(s => s.today);
  // remote 캐시가 바뀌면 진짜 사람 친구의 '지금'도 바뀐다 — 구독해 두어야 다시 그려진다 (BACKEND-CONTRACT §3.5)
  useWorld(s => s.remote);
  /** 서버에 들어와 있는 아이디 — 없으면(오프라인) 로그아웃 줄을 그리지 않는다 */
  const me = currentUser();

  const metLine = (f: Friend) => {
    if (f.metAt === undefined) return '처음부터 친구';
    const p = localParts(f.metAt, tz);
    // 만난 곳이 남의 도시의 장소면 카탈로그에 숨어 있다 (places.ts registerRemotePlaces) — id로 찾는다
    const where = f.metPlaceId && hasPlace(f.metPlaceId) ? placeById(f.metPlaceId).name : null;
    return `${p.m}월 ${p.d}일${where ? ` · ${where}에서 만남` : ' · 새 친구'}`;
  };
  // NPC는 내 블록·내 하루로, 진짜 사람은 발행된 활동의 `arriveAt <= now < endAt`로 (sim/agents.ts friendNow)
  const nowLine = (f: Friend) => {
    const n = friendNow(f, now, tz, today);
    if (n.kind === 'sleep') return '자는 중';
    if (n.kind === 'home') return '집에서 쉬는 중';
    return `${blockDef(n.blockId).label} · ${n.title}`;
  };
  // 집을 모르는 친구(캐시가 아직 안 온 진짜 사람)라도 목록이 깨지면 안 된다
  const homeArea = (f: Friend) => { try { return placeById(f.homePlaceId).area; } catch { return '어딘가'; } };

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
          {friends.map(f => (
            <div key={f.id} className="book-item fr-item" style={{ ['--friend' as string]: f.color }}>
              <div className="fr-row">
                <FriendHead size={44} color={f.color} title={f.name} />
                <div className="fr-main">
                  <b>{f.name}</b>
                  <span className="fr-home">{f.emoji} {homeArea(f)}에 사는 친구</span>
                </div>
              </div>
              <span className="fr-now"><i /> 지금 · {nowLine(f)}</span>
              <span className="book-meta num">{metLine(f)}</span>
            </div>
          ))}
        </div>
      )}
      {/* 로그아웃: 사람 목록의 맨 아래가 자연스럽다. 이 기기의 하루·앨범·기억이 비워지니 한 번 묻는다 */}
      {me && (
        <div className="fr-me">
          <span className="fr-me-who"><b>{me.name}</b><small className="num">{me.userId}</small></span>
          <Button small onClick={() => { if (confirm('다른 아이디로 들어갈까요? 이 기기의 하루·앨범·기억은 비워져요.')) void switchUser(); }}>로그아웃</Button>
        </div>
      )}
    </div>
  );
}
