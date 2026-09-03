import type { Phase } from '../sim/types';
import { cityNameKo } from '../sim/places';
import { Character } from '../character';
import { CompanionChip, JetlagChip, ProgressBar, type ChipFriend } from '../ui';
import { Scene } from '../scenes';
import { fmtRemain, poseFor, progressLabel } from './util';

type Active = Extract<Phase, { kind: 'active' }>;

/** State 3 — generic place scene (350px character on top), place tag, bottom status card.
 *  동행은 이름이 아니라 얼굴로 (FRIENDS_SPEC 동행 표시 규칙): the friend stands beside, the chip under the place tag.
 *  마주침(§4): 말을 걸었으면 상대가 옆에 서서 "안녕!", 못 걸었으면 배경에 실루엣만. */
export function ActivityScreen({ phase }: { phase: Active }) {
  const { act, remainingMin, progress, companions, encounter } = phase;
  const friend = companions[0];
  const met = encounter?.talked ? encounter.agent : null;
  const seen = encounter && !encounter.talked ? encounter.agent : null;
  const metChip: ChipFriend[] = met ? [{ id: met.id, name: met.name, color: met.color }] : [];
  // real place: 동네 (+ city when abroad) — no implementation vocabulary in the tag
  const where = act.place.country === 'KR' ? act.place.area : `${act.place.area} · ${cityNameKo(act.place.city)}`;

  return (
    <div className={`act ${friend ? 'has-friend' : ''} ${met ? 'has-met' : ''}`}>
      <div className="act-iris" />
      <div className="act-scene"><Scene type={act.place.type} /></div>
      {/* 말은 못 걸었지만 그 자리에 있던 사람 — 배경의 흐린 실루엣 */}
      {seen && <Character className="act-ghost" pose="idle" size={190} variant="friend" color="#A08C76" />}
      {friend && <Character className="act-friend" pose="wave" size={224} variant="friend" color={friend.color} />}
      <Character className="act-chara" pose={poseFor(act.option)} size={350} />
      {met && (
        <>
          <Character className="act-met" pose="wave" size={190} variant="friend" color={met.color} />
          <div className="act-met-bubble">안녕!</div>
        </>
      )}
      <div className="act-tag">
        {act.place.emoji} {act.place.name}
        <small>{where}</small>
        {phase.jetlag && <JetlagChip sticker />}
      </div>
      {!!companions.length && (
        <CompanionChip className="act-with" friends={companions} />
      )}
      {met && (
        <CompanionChip className="act-metchip" friends={metChip} happy prefix={encounter?.again ? '또 만났네' : '새 친구'} />
      )}
      <div className="act-stat">
        <div>
          <b>{progressLabel(act.option, act.place)}</b>
          <span className="lock">끝날 때까지 지켜봐요</span>
        </div>
        <div className="act-t num">{fmtRemain(remainingMin)}<small>남음</small></div>
        <ProgressBar className="act-bar" value={progress} color="var(--mint)" />
      </div>
    </div>
  );
}
