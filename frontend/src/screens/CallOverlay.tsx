import { useEffect, useRef, useState } from 'react';
import { useWorld } from '../sim/store';
import type { CallEvent } from '../sim/call';
import { hhmmIn } from '../sim/tz';
import { Character } from '../character';
import { Bubble, Button, Glyph } from '../ui';
import { voiceAvailable } from '../sim/voice';
import { warmModel } from '../sim/llm';
import { startVoiceCall, type VoiceCallHandle, type VoiceState } from '../sim/callvoice';

/** 못 받았을 때 문자가 늦게 도착하는 연출 (wall ms). 실제 40초를 기다리게 하지는 않되, 시각은 1분 뒤로 찍는다. */
const LATE_MS = 2400;
/** 걸려온 전화가 저절로 끊기기까지 (wall ms). */
const RING_MS = 12_000;
/** 받은 통화에서 한 줄씩 쌓이는 간격 (wall ms). */
const LINE_MS = 800;

const STATE_KO: Record<VoiceState, string> = { connecting: '연결 중…', listening: '듣고 있어', thinking: '생각 중…', speaking: '말하는 중', off: '' };

/**
 * 통화 — 에이전트가 말을 거는 가장 센 단계 (docs/adr/0001-agentness.md §1).
 * 새 `ScreenKind`가 아니라 **오버레이**다: 어떤 상태 위에도 떠야 하고 밑의 상태를 파괴하면 안 된다.
 *
 * 세 얼굴이 있다. 걸려온 전화(받기/안 받기) · 받은 통화(말이 한 줄씩) · 못 받은 발신(늦게 오는 문자).
 * 받은 통화는 음성 서비스(voice/)가 있고 모델이 켜져 있으면 **말로** 한다 (ADR-0011): 마이크로 듣고 목소리로 답하며
 * 오간 말이 줄로 쌓인다. 서비스가 없거나 마이크를 못 열면 지금처럼 규칙 대사가 한 줄씩 뜬다.
 */
export function CallOverlay({ call, tz }: { call: CallEvent; tz: string }) {
  const answerCall = useWorld(s => s.answerCall);
  const endCall = useWorld(s => s.endCall);
  const llmTier = useWorld(s => s.llmTier);
  const beginVoiceCall = useWorld(s => s.beginVoiceCall);
  const appendCallLine = useWorld(s => s.appendCallLine);
  const [shown, setShown] = useState(0);
  const [late, setLate] = useState(false);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const handle = useRef<VoiceCallHandle | null>(null);
  /** 세션은 통화당 한 번 — 개발 모드의 StrictMode가 효과를 두 번 돌려도 마이크를 두 번 열지 않는다 */
  const started = useRef(false);
  const linesEnd = useRef<HTMLDivElement>(null);

  const answered = call.result === 'answered';
  const refused = call.result === 'refused';

  // 받은 통화: 말로 할 수 있으면 말로 (음성 서비스 + 모델). 아니면 규칙 대사가 한 줄씩
  useEffect(() => {
    if (!answered || llmTier === 'off' || started.current) return;
    started.current = true;
    void (async () => {
      if (!(await voiceAvailable())) return;
      try {
        const h = await startVoiceCall(() => useWorld.getState(), { onConnected: beginVoiceCall, onLine: appendCallLine, onState: setVoice });
        if (handle.current) { h.stop(); return; }   // 그 사이 끊었다
        handle.current = h;
      } catch {
        // 마이크를 못 열었거나 서비스에 못 붙었다 — 규칙 대사로 간다
        setVoice(null);
      }
    })();
  }, [answered, llmTier, beginVoiceCall, appendCallLine]);

  // 벨이 울리는 12초 동안 모델을 미리 올린다 — 받자마자 첫마디가 나오게 (ADR-0011)
  useEffect(() => { if (call.dir === 'in' && call.result === 'missed' && llmTier !== 'off') warmModel(llmTier); }, [call.dir, call.result, llmTier]);

  // 끊으면(오버레이가 사라지면) 마이크도 놓는다
  useEffect(() => () => { handle.current?.stop(); handle.current = null; }, []);

  // 글 통화: 말이 한 줄씩 쌓인다
  useEffect(() => {
    if (!answered || call.voice || !call.lines) return;
    if (shown >= call.lines.length) return;
    const id = window.setTimeout(() => setShown(n => n + 1), shown === 0 ? 350 : LINE_MS);
    return () => window.clearTimeout(id);
  }, [answered, call.voice, call.lines, shown]);

  // 말 통화: 새 줄이 오면 아래로
  useEffect(() => { if (call.voice) linesEnd.current?.scrollIntoView({ block: 'end' }); }, [call.voice, call.lines?.length]);

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
  const lines = call.voice ? (call.lines ?? []) : (call.lines ?? []).slice(0, shown);
  const pose = ringing ? 'wave' : voice === 'thinking' ? 'think' : voice === 'listening' ? 'idle' : 'happy';
  const hangUp = () => { handle.current?.stop(); handle.current = { stop: () => {} }; endCall(); };

  return (
    <div className={`call ${refused ? 'is-refused' : ''} ${call.voice ? 'is-voice' : ''}`} role="dialog" aria-label="통화">
      <div className="call-hd">
        <b>{ringing ? '지금 전화 왔어' : refused ? '신호 가는 중…' : '통화 중'}</b>
        <span className="num">{hhmmIn(call.at, tz)}</span>
        {call.voice && voice && voice !== 'off' && <span className={`call-state is-${voice}`}>{STATE_KO[voice]}</span>}
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
          <Character className="call-me" pose={pose} size={call.voice ? 220 : 300} />
          {answered && (
            <div className="call-lines">
              {lines.map((l, i) => {
                const mine = l.startsWith('나: ');
                return (
                  <Bubble key={`${i}:${l}`} side={mine ? 'right' : 'left'} className={`call-say ${mine ? 'mine' : ''} ${!call.voice ? `i${i}` : ''}`}>{mine ? l.slice(3) : l}</Bubble>
                );
              })}
              <div ref={linesEnd} />
            </div>
          )}
        </>
      )}

      <div className="call-btns">
        {ringing ? (
          <>
            <Button tone="paper" onClick={() => answerCall(false)}><Glyph name="phone-off" size={20} /> 안 받기</Button>
            <Button tone="coral" onClick={() => answerCall(true)}><Glyph name="phone" size={20} color="#fff" /> 받기</Button>
          </>
        ) : (
          <Button tone="paper" onClick={hangUp}>{refused && !late ? '끊기' : '끊었어'}</Button>
        )}
      </div>
    </div>
  );
}
