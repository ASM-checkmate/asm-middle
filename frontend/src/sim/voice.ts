// ─── 음성 세션 (docs/adr/0011-voice-call.md) ─────────────────────────────────
// 브라우저 쪽 귀와 입. 마이크를 16kHz PCM으로 음성 서비스(voice/)에 흘리고, 서비스가 보내는 목소리 조각을 이어 재생한다.
// **무슨 말을 할지는 여기서 정하지 않는다** — 그건 sim/callvoice.ts가 백엔드에 묻는다. 여기는 소리만 나른다.
//
// 끼어들기(barge-in): 서비스가 `speech_start`를 보내면 재생 중인 소리를 즉시 멈추고 줄 선 조각을 버린다.
// 에이전트 목소리가 스피커→마이크로 되돌아와 스스로를 끊지 않게 getUserMedia의 echoCancellation을 켠다.

export interface VoiceEvents {
  onReady?: (info: { tts: string; stt: string; voice: string }) => void;
  /** 사람 목소리가 들리기 시작했다 — 호출자는 진행 중인 답을 끊는다 */
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  /** 한 발화가 글로 바뀌었다 */
  onTranscript?: (text: string) => void;
  /** 이 턴의 목소리를 다 냈다 (마지막 조각 재생까지) */
  onSpoken?: (turn: number) => void;
  onError?: (message: string) => void;
}

/** 서비스가 있는지 (`/voice/health`). 없으면 통화는 글로만 된다. */
export async function voiceAvailable(timeoutMs = 1_500): Promise<boolean> {
  try {
    const res = await fetch('/voice/health', { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 마이크 샘플을 16kHz int16으로 내려 보내는 워크릿. 문자열로 두고 Blob URL로 올린다 — 파일 하나를 더 안 만든다. */
const WORKLET = `
class Mic16k extends AudioWorkletProcessor {
  constructor() { super(); this.acc = []; this.n = 0; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = sampleRate / 16000;
    for (; this.pos < ch.length; this.pos += ratio) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = ch[i], b = ch[Math.min(i + 1, ch.length - 1)];
      const v = a + (b - a) * f;
      this.acc.push(Math.max(-1, Math.min(1, v)));
    }
    this.pos -= ch.length;
    if (this.acc.length >= 1024) {
      const out = new Int16Array(this.acc.length);
      for (let k = 0; k < out.length; k++) out[k] = this.acc[k] * 32767;
      this.acc = [];
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('mic16k', Mic16k);
`;

export class VoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private playing: AudioBufferSourceNode[] = [];
  private nextAt = 0;
  private pendingMeta: { turn: number; seq: number; sr: number; last: boolean } | null = null;
  private lastTurnScheduled: { turn: number; endsAt: number } | null = null;
  private closed = false;
  private ev: VoiceEvents;
  constructor(ev: VoiceEvents) { this.ev = ev; }

  /**
   * 마이크를 열고 서비스에 붙는다.
   *
   * @throws 마이크 권한이 없거나 서비스에 못 붙으면 — 호출자는 글 통화로 돌아간다
   */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/voice/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('voice service unreachable'));
      ws.onclose = () => rej(new Error('voice service closed'));
    });
    ws.onmessage = e => this.onMessage(e.data);
    ws.onclose = () => { if (!this.closed) this.ev.onError?.('음성 서비스와 끊겼어'); };
    ws.onerror = () => { if (!this.closed) this.ev.onError?.('음성 서비스 오류'); };
    ws.send(JSON.stringify({ type: 'start' }));
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'mic16k');
    this.node.port.onmessage = e => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer); };
    src.connect(this.node);
    // 워크릿 출력을 어디에도 안 잇는다 — 마이크가 스피커로 나가면 하울링이 난다
  }

  /** 문장 하나를 목소리로. 같은 turn 안에서 seq 순서대로 이어진다. */
  say(turn: number, seq: number, text: string) {
    this.ws?.send(JSON.stringify({ type: 'say', turn, seq, text }));
  }

  /** 말하던 것·줄 선 것 전부 멈춘다 (끼어들기). */
  cancel() {
    this.ws?.send(JSON.stringify({ type: 'cancel' }));
    this.stopPlayback();
  }

  /** 세션을 닫는다. 마이크도 놓는다. */
  stop() {
    this.closed = true;
    try { this.ws?.send(JSON.stringify({ type: 'stop' })); } catch { /* 닫힘 */ }
    this.ws?.close();
    this.stopPlayback();
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close();
  }

  private stopPlayback() {
    for (const s of this.playing) { try { s.stop(); } catch { /* 이미 끝남 */ } }
    this.playing = [];
    this.nextAt = 0;
    this.lastTurnScheduled = null;
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data !== 'string') {
      const meta = this.pendingMeta;
      this.pendingMeta = null;
      if (meta) this.play(new Int16Array(data), meta);
      return;
    }
    let m: { type: string; [k: string]: unknown };
    try { m = JSON.parse(data); } catch { return; }
    switch (m.type) {
      case 'ready': this.ev.onReady?.({ tts: String(m.tts), stt: String(m.stt), voice: String(m.voice) }); break;
      case 'speech_start': this.stopPlayback(); this.ev.onSpeechStart?.(); break;
      case 'speech_end': this.ev.onSpeechEnd?.(); break;
      case 'transcript': this.ev.onTranscript?.(String(m.text)); break;
      case 'audio': {
        const meta = { turn: Number(m.turn), seq: Number(m.seq), sr: Number(m.sr), last: m.last === true };
        if (meta.last) this.markEnd(meta.turn); else this.pendingMeta = meta;
        break;
      }
      case 'error': this.ev.onError?.(String(m.message)); break;
    }
  }

  private play(pcm: Int16Array, meta: { turn: number; seq: number; sr: number }) {
    const ctx = this.ctx;
    if (!ctx || !pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, meta.sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.nextAt);
    src.start(at);
    this.nextAt = at + buf.duration;
    this.playing.push(src);
    src.onended = () => { this.playing = this.playing.filter(s => s !== src); };
    this.lastTurnScheduled = { turn: meta.turn, endsAt: this.nextAt };
  }

  /** 서비스가 이 문장의 마지막 조각을 보냈다 — 재생이 실제로 끝나는 시각에 onSpoken을 부른다. */
  private markEnd(turn: number) {
    const ctx = this.ctx;
    const end = this.lastTurnScheduled?.turn === turn ? this.lastTurnScheduled.endsAt : ctx?.currentTime ?? 0;
    const wait = Math.max(0, (end - (ctx?.currentTime ?? 0)) * 1000);
    window.setTimeout(() => this.ev.onSpoken?.(turn), wait);
  }
}
