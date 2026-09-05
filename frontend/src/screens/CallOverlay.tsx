import { useEffect, useState } from 'react';
import { useWorld } from '../sim/store';
import type { CallEvent } from '../sim/call';
import { hhmmIn } from '../sim/tz';
import { Character } from '../character';
import { Bubble, Button, Glyph } from '../ui';

/** 못 받았을 때 문자가 늦게 도착하는 연출 (wall ms). 실제 40초를 기다리게 하지는 않되, 시각은 1분 뒤로 찍는다. */
const LATE_MS = 2400;
/** 걸려온 전화가 저절로 끊기기까지 (wall ms). */
const RING_MS = 12_000;
/** 받은 통화에서 한 줄씩 쌓이는 간격 (wall ms). */
const LINE_MS = 800;

/**
 * 통화 — 에이전트가 말을 거는 가장 센 단계 (docs/adr/0001-agentness.md §1).
 * 새 `ScreenKind`가 아니라 **오버레이**다: 어떤 상태 위에도 떠야 하고 밑의 상태를 파괴하면 안 된다.
 *
 * 세 얼굴이 있다. 걸려온 전화(받기/안 받기) · 받은 통화(말이 한 줄씩) · 못 받은 발신(늦게 오는 문자).
 */
export function CallOverlay({ call, tz }: { call: CallEvent; tz: string }) {
  const answerCall = useWorld(s => s.answerCall);
  const endCall = useWorld(s => s.endCall);
  const [shown, setShown] = useState(0);
  const [late, setLate] = useState(false);

  const answered = call.result === 'answered';
  const refused = call.result === 'refused';

  // 받은 통화: 말이 한 줄씩 쌓인다
  useEffect(() => {
    if (!answered || !call.lines) return;
    if (shown >= call.lines.length) return;
    const id = window.setTimeout(() => setShown(n => n + 1), shown === 0 ? 350 : LINE_MS);
    return () => window.clearTimeout(id);
  }, [answered, call.lines, shown]);

  // 못 받은 발신: 신호가 끊기고 조금 뒤 문자가 온다
  useEffect(() => {
    if (!refused) return;
    const id = window.setTimeout(() => setLate(true), LATE_MS);
    return () => window.clearTimeout(id);
  }, [refused]);

  // 걸려온 전화는 12초 뒤 저절로 부재중이 된다 — 안 받으면 내용도 사라진다
  useEffect(() => {
    if (call.dir !== 'in' || call.result !== 'missed') return;
    const id = window.setTimeout(() => answerCall(false), RING_MS);
    return () => window.clearTimeout(id);
  }, [call.dir, call.result, answerCall]);

  const ringing = call.dir === 'in' && call.result === 'missed';

  return (
    <div className={`call ${refused ? 'is-refused' : ''}`} role="dialog" aria-label="통화">
      <div className="call-hd">
        <b>{ringing ? '지금 전화 왔어' : refused ? '신호 가는 중…' : '통화 중'}</b>
        <span className="num">{hhmmIn(call.at, tz)}</span>
      </div>

      {refused ? (
        <div className="call-fail">
          <div className="call-dots" aria-hidden="true"><i /><i /><i /></div>
          <div className="call-nope">— 안 받음 —</div>
          {late && (
            <div className="call-text">
              <span className="num">{hhmmIn(call.at + 60_000, tz)}</span>
              <p>「{call.text}」</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="call-ring" aria-hidden="true" />
          <Character className="call-me" pose={ringing ? 'wave' : 'happy'} size={300} />
          {answered && call.lines?.slice(0, shown).map((l, i) => (
            <Bubble key={l} className={`call-say i${i}`}>{l}</Bubble>
          ))}
        </>
      )}

      <div className="call-btns">
        {ringing ? (
          <>
            <Button tone="paper" onClick={() => answerCall(false)}><Glyph name="phone-off" size={20} /> 안 받기</Button>
            <Button tone="coral" onClick={() => answerCall(true)}><Glyph name="phone" size={20} color="#fff" /> 받기</Button>
          </>
        ) : (
          <Button tone="paper" onClick={endCall}>{refused && !late ? '끊기' : '끊었어'}</Button>
        )}
      </div>
    </div>
  );
}
