// ─── 귀가 뒤 눕기 (ADR-0030): 취침 전 이동으로 집에 닿으면 잠깐 집 방 — 책상에 앉았다가 침대로 가 눕는다, 그 뒤 수면 화면 ───
import type { Phase } from '../sim/types';
import type { LogLine } from '../sim/actlog';
import { roomForPlace, RoomStage } from '../room';
import { cityNameKo } from '../sim/places';
import { hhmmIn } from '../sim/tz';

type Sleeping = Extract<Phase, { kind: 'sleeping' }>;
/** 닿은 뒤 이만큼(sim)은 집 방을 보여 준다 — 그 뒤는 수면 화면 */
export const HOME_LIE_MS = 20 * 60_000;
/** 닿고 나서 침대로 가는 시각 (sim) */
const LIE_AFTER_MS = 90_000;

export function HomeNightScreen({ phase, now }: { phase: Sleeping; now: number }) {
  const room = roomForPlace(phase.at);
  if (!room) return null;
  const lines: LogLine[] = [{ at: phase.since + LIE_AFTER_MS, text: '집. 눕는다' }].filter(l => l.at <= now);
  const where = phase.at.country === 'KR' ? phase.at.area : `${phase.at.area} · ${cityNameKo(phase.at.city)}`;
  return (
    <div className="act has-room">
      <div className="act-iris" />
      <RoomStage room={room} log={lines} seatPose="idle" cast={{ companions: [], present: [] }} seed={`night:${phase.since}`} />
      <div className="act-tagrow">
        <div className="act-tag">
          {phase.at.emoji} {phase.at.name}
          <small>{where}</small>
        </div>
      </div>
      <div className="act-stat">
        <div><b>집에 왔다 — 씻고 눕자</b></div>
        <div className="act-t num">{hhmmIn(phase.until, phase.tz)}<small>기상</small></div>
      </div>
    </div>
  );
}
