import type { Memory, Phase, WorryKey } from './types';
import type { Status } from './status';
import type { CallEvent } from './call';
import { hhmmIn } from './tz';
import { whereOf } from './chat';
import type { LlmTier } from './llm';
import { VoiceSession } from './voice';

// ─── 말로 하는 통화의 턴 (docs/adr/0011-voice-call.md) ───────────────────────
// 귀·입(sim/voice.ts)과 말 짓기(백엔드 /api/call/turn)를 잇는다.
//   붙는다 → 첫 턴(에이전트가 먼저) → 사용자가 말하면 → 글로 → 턴 → 문장마다 목소리 → …
// 사용자가 끼어들면(speech_start) 진행 중인 턴을 끊는다: 요청을 닫으면 Ollama도 멈춘다.
// 오간 말은 전부 `onLine`으로 스토어에 쌓인다 — 대화 실의 기록 줄이 그걸 펼친다.

/** 백엔드 계약 (docs/CONTRACT.md의 CallTurnRequest). backend/src/contract.ts와 같은 모양을 복사해 둔다. */
export interface CallTurnRequest {
  tier: Exclude<LlmTier, 'off'>;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  situation: { where: string; doing: string; hhmm: string; mood: number; fatigue: number };
  why: 'worry' | 'ask' | 'friction' | 'out';
  worry: Exclude<WorryKey, 'none'> | null;
  transcript: { from: 'me' | 'agent'; text: string }[];
  user: string | null;
}

/** 며칠 안의 고민만 넘긴다 (sim/llm.ts와 같은 창). */
const WORRY_FRESH_MS = 3 * 24 * 3600_000;
/** 프롬프트에 넣는 최근 줄 수. */
const TRANSCRIPT_N = 20;

/**
 * 스토어 상태와 통화로 턴 요청 하나를 만든다. 순수 함수.
 *
 * @param call 지금 통화
 * @param transcript 지금까지 오간 말
 * @param user 방금 들은 말 (첫 턴이면 null)
 */
export function callTurnRequestOf(call: CallEvent, transcript: { from: 'me' | 'agent'; text: string }[], user: string | null, s: { phase: Phase; status: Status; memory: Memory; now: number }, tier: Exclude<LlmTier, 'off'>): CallTurnRequest {
  const { where, doing } = whereOf(s.phase);
  const fresh = s.memory.worry && s.memory.worry.key !== 'none' && s.now - s.memory.worry.at < WORRY_FRESH_MS ? s.memory.worry.key : null;
  const why: CallTurnRequest['why'] = call.dir === 'out' ? 'out' : call.why ?? 'friction';
  return {
    tier,
    agent: { name: s.memory.name, traits: s.memory.traits, likes: s.memory.likes, dislikes: s.memory.dislikes },
    situation: { where, doing, hhmm: hhmmIn(s.now, s.phase.tz), mood: Math.round(s.status.mood), fatigue: Math.round(s.status.fatigue) },
    why,
    worry: why === 'worry' ? fresh : null,
    transcript: transcript.slice(-TRANSCRIPT_N),
    user,
  };
}

/**
 * 백엔드에 턴을 묻고 문장이 올 때마다 `onSentence`를 부른다. 실패·끊김은 조용히 끝난다 (통화는 계속된다).
 *
 * @returns 이 턴의 문장들 (끊겼으면 거기까지)
 */
export async function streamCallTurn(req: CallTurnRequest, onSentence: (s: string) => void, signal: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  try {
    const res = await fetch('/api/call/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal });
    if (!res.ok || !res.body) return out;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let pending = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as { s?: string; done?: boolean; error?: string };
          if (typeof j.s === 'string' && j.s) { out.push(j.s); onSentence(j.s); }
        } catch { /* 깨진 줄은 넘긴다 */ }
      }
    }
  } catch { /* 끊김·서버 없음 */ }
  return out;
}

export type VoiceState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'off';

export interface VoiceCallHandle { stop: () => void }

/**
 * 말로 하는 통화 하나를 굴린다. 붙으면 에이전트가 먼저 말하고, 사용자가 말할 때마다 턴을 돈다.
 *
 * @param get 지금 상태를 읽는 함수 (턴마다 새로 읽는다 — 통화 중에도 시계는 간다)
 * @param handlers onConnected(붙었다) · onLine(오간 말 한 줄, 스토어에 쌓는다) · onState(상태 표시용)
 * @returns 끊는 손잡이. 실패하면(마이크·서비스) reject — 호출자는 글 통화로 돌아간다
 */
export async function startVoiceCall(
  get: () => { phase: Phase; status: Status; memory: Memory; now: number; activeCall: CallEvent | null; llmTier: LlmTier },
  { onConnected, onLine, onState }: {
    /** 마이크와 서비스가 붙었다 — 이때 규칙 대사를 비운다 (그 전에 실패하면 규칙 대사가 그대로 남아야 한다) */
    onConnected: () => void;
    onLine: (from: 'me' | 'agent', text: string) => void;
    onState: (st: VoiceState) => void;
  },
): Promise<VoiceCallHandle> {
  const transcript: { from: 'me' | 'agent'; text: string }[] = [];
  let turn = 0;
  let ctl: AbortController | null = null;
  let stopped = false;
  let speaking = false;

  const runTurn = (user: string | null) => {
    const s = get();
    if (stopped || !s.activeCall || s.llmTier === 'off') return;
    ctl?.abort();
    const mine = new AbortController();
    ctl = mine;
    const t = ++turn;
    let seq = 0;
    onState('thinking');
    const req = callTurnRequestOf(s.activeCall, transcript, user, s, s.llmTier);
    void streamCallTurn(req, sentence => {
      if (mine.signal.aborted || stopped) return;
      transcript.push({ from: 'agent', text: sentence });
      onLine('agent', sentence);
      session.say(t, seq++, sentence);
      speaking = true;
      onState('speaking');
    }, mine.signal).then(() => { if (!mine.signal.aborted && !stopped && seq === 0) onState('listening'); });
  };

  const session = new VoiceSession({
    onSpeechStart: () => {
      // 끼어들었다 — 만들던 답을 끊는다. 이미 쌓인 문장은 그대로 남긴다 (실제로 들렸으니)
      ctl?.abort();
      speaking = false;
      onState('listening');
    },
    onTranscript: text => {
      if (stopped) return;
      transcript.push({ from: 'me', text });
      onLine('me', text);
      runTurn(text);
    },
    onSpoken: t => { if (t === turn && speaking) { speaking = false; onState('listening'); } },
    onError: () => { if (!stopped) onState('off'); },
  });
  onState('connecting');
  await session.start();
  onConnected();
  onState('listening');
  runTurn(null);   // 붙었다 — 에이전트가 먼저 말한다
  return {
    stop: () => { stopped = true; ctl?.abort(); session.stop(); onState('off'); },
  };
}
