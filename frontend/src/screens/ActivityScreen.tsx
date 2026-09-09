import type { Phase } from '../sim/types';
import { useWorld } from '../sim/store';
import { cityNameKo } from '../sim/places';
import { shotsFor } from '../sim/shots';
import { Character } from '../character';
import { Button, CompanionChip, JetlagChip, ProgressBar, type ChipFriend } from '../ui';
import { Scene, sceneTypeFor } from '../scenes';
import { roomFor, RoomStage } from '../room';
import { activityLog } from '../sim/actlog';
import { hhmmIn } from '../sim/tz';
import { fmtRemain, poseFor, progressLabel } from './util';
import './camera.css';

type Active = Extract<Phase, { kind: 'active' }>;

/** State 3 — generic place scene (350px character on top), place tag, bottom status card.
 *  동행은 이름이 아니라 얼굴로 (FRIENDS_SPEC 동행 표시 규칙): the friend stands beside, the chip under the place tag.
 *  마주침(§4): 말을 걸었으면 상대가 옆에 서서 "안녕!", 못 걸었으면 배경에 실루엣만. */
export function ActivityScreen({ phase }: { phase: Active }) {
  const { act, remainingMin, progress, companions, encounter } = phase;
  // 결과가 아니라 과정을 본다 (ADR-0001): 타임스탬프 줄이 활동 중에 하나씩 쌓인다.
  // `progress`로 지금 시각을 되짚어 로그를 만든다 — 화면은 스토어의 now를 따로 안 읽는다.
  const nowMs = act.arriveAt + (act.endAt - act.arriveAt) * Math.min(1, Math.max(0, progress));
  const fullLog = activityLog(act, nowMs);
  const log = fullLog.slice(-4);
  // 2.5D 방(ADR-0015)이 있는 장소면 캐릭터가 방 안을 돌아다닌다 — 로그 줄이 곧 동선. 없으면 옛 정면 무대
  const room = roomFor(sceneTypeFor(act.place.type));
  // 사진 (ADR-0004): 활동 중에만 찍을 수 있다 — 만화는 endAt에 한 번 만들어져 앨범에 굳는다. 오버레이는 Home이 띄운다.
  const setCameraOpen = useWorld(s => s.setCameraOpen);
  const shots = useWorld(s => s.shots);
  const shotCount = Object.keys(shotsFor(shots, act.key)).length;
  const friend = companions[0];
  const met = encounter?.talked ? encounter.agent : null;
  const seen = encounter && !encounter.talked ? encounter.agent : null;
  const metChip: ChipFriend[] = met ? [{ id: met.id, name: met.name, color: met.color }] : [];
  // real place: 동네 (+ city when abroad) — no implementation vocabulary in the tag
  const where = act.place.country === 'KR' ? act.place.area : `${act.place.area} · ${cityNameKo(act.place.city)}`;

  return (
    <div className={`act ${friend ? 'has-friend' : ''} ${met ? 'has-met' : ''} ${room ? 'has-room' : ''}`}>
      <div className="act-iris" />
      {room && <RoomStage room={room} log={fullLog} seatPose={poseFor(act.option)} companions={companions} encounter={encounter} />}
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
      {/* 왼쪽 좁은 컬럼: 오래된 줄부터 흐려진다. 캐릭터를 가리지 않는다. */}
      {!!log.length && (
        <ol className="act-log" aria-label="지금까지">
          {log.map((l, i) => (
            <li key={`${l.at}:${l.text}`} className={l.fx ? 'is-fx' : ''} style={{ opacity: 0.35 + 0.65 * ((i + 1) / log.length) }}>
              <b className="num">{hhmmIn(l.at, act.tz)}</b> {l.text}
            </li>
          ))}
          <li className="act-log-now"><b className="num">{hhmmIn(nowMs, act.tz)}</b> ▸ 지금</li>
        </ol>
      )}
      <div className="act-stat">
        <div>
          <b>{progressLabel(act.option, act.place)}</b>
          {/* lock 문구 자리: 지켜보기만 하던 활동 중에 유일하게 손댈 수 있는 것 — 사진 */}
          <Button tone="coral" small className="act-shoot" onClick={() => setCameraOpen(true)} ariaLabel={`사진 찍기 (${shotCount}/4)`}>
            📷 사진 찍기 <i className={`act-shoot-n ${shotCount >= 4 ? 'is-full' : ''}`}>{shotCount}/4</i>
          </Button>
        </div>
        <div className="act-t num">{fmtRemain(remainingMin)}<small>남음</small></div>
        <ProgressBar className="act-bar" value={progress} color="var(--mint)" />
      </div>
    </div>
  );
}
