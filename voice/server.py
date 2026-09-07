"""theworld 음성 서비스 — 귀(STT)·목소리(TTS)·말 감지(VAD)만 한다 (docs/adr/0011-voice-call.md).

무슨 말을 할지는 여전히 backend/(Node)와 로컬 LLM이 짓고, 언제 걸리고 받을 수 있는지는 프론트 규칙이다.
이 서비스는 브라우저와 WebSocket 하나로 이어진다:

  브라우저 → 서비스
    binary            마이크 PCM (16kHz · mono · int16), 통화 중 계속
    {"type":"start"}  세션 시작
    {"type":"say","turn":n,"seq":i,"text":"…"}   이 문장을 목소리로
    {"type":"cancel"} 말하던 것·줄 선 것 전부 버려라 (사용자가 끼어들었다)
    {"type":"stop"}   세션 끝
  서비스 → 브라우저
    {"type":"ready","tts":…,"stt":…}
    {"type":"speech_start"}            사람 목소리가 들리기 시작했다 — 브라우저는 재생을 멈춘다 (barge-in)
    {"type":"speech_end"}
    {"type":"transcript","text":"…","ms":…}
    {"type":"audio","turn":n,"seq":i,"sr":24000,"last":bool} 뒤이어 binary 한 프레임 (int16 PCM)
    {"type":"error","message":"…"}

의존성은 backend/와 달리 파이썬·MLX다 — 그래서 별도 폴더의 선택 서비스다. 없어도 통화는 글로 된다.
"""
import asyncio
import json
import os
import struct
import sys
import time
from dataclasses import dataclass, field

import numpy as np
import websockets

PORT = int(os.environ.get("VOICE_PORT", "8790"))
TTS_MODEL = os.environ.get("VOICE_TTS", "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit")
TTS_VOICE = os.environ.get("VOICE_SPEAKER", "Sohee")
STT_MODEL = os.environ.get("VOICE_STT", "mlx-community/whisper-large-v3-turbo")
SR_IN = 16_000
FRAME = 512                       # silero가 받는 창 (32ms @16k)
SPEECH_ON = float(os.environ.get("VOICE_VAD_ON", "0.5"))
SPEECH_OFF = float(os.environ.get("VOICE_VAD_OFF", "0.35"))
START_FRAMES = 5                  # 이만큼 연속으로 말이면 "시작" (≈160ms) — 기침·컵 소리에 안 끊기게
END_FRAMES = int(os.environ.get("VOICE_END_FRAMES", "18"))   # 이만큼 조용하면 "끝" (≈580ms) — 380ms면 쉼표 뒤 쉼에서 잘렸다. 짧으면 말을 자르고 길면 느리다
PRE_ROLL = 10                     # 시작 판정 전의 창들도 발화에 넣는다 (첫 음절 보존)
MAX_UTTER_S = 20


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


class Engines:
    """모델 셋을 한 번만 올린다. 첫 요청이 느리지 않게 시작할 때 미리 돌려 본다."""

    def __init__(self):
        t0 = time.time()
        from mlx_audio.tts.utils import load_model
        self.tts = load_model(TTS_MODEL)
        self.tts_sr = None
        from silero_vad import load_silero_vad
        import torch
        self.torch = torch
        self.vad = load_silero_vad(onnx=True)
        import mlx_whisper
        self.whisper = mlx_whisper
        log(f"models loaded in {time.time()-t0:.1f}s: tts={TTS_MODEL} voice={TTS_VOICE} stt={STT_MODEL}")
        # 예열 — 첫 문장이 3초 걸리면 첫 통화가 어색하다
        for _ in self.speak("여보세요."):
            pass
        self.transcribe(np.zeros(SR_IN, dtype=np.float32))
        log("warm")

    def vad_prob(self, frame: np.ndarray) -> float:
        return float(self.vad(self.torch.from_numpy(frame), SR_IN))

    def vad_reset(self):
        try:
            self.vad.reset_states()
        except Exception:
            pass

    def transcribe(self, audio16: np.ndarray) -> str:
        r = self.whisper.transcribe(audio16, path_or_hf_repo=STT_MODEL, language="ko", fp16=True, condition_on_previous_text=False)
        return (r.get("text") or "").strip()

    def speak(self, text: str):
        """문장 하나를 int16 PCM 조각들로. 스트리밍이라 첫 조각이 빨리 나온다."""
        for r in self.tts.generate(text=text, voice=TTS_VOICE, lang_code="korean", stream=True, streaming_interval=0.5, verbose=False):
            self.tts_sr = r.sample_rate
            a = np.asarray(r.audio, dtype=np.float32).reshape(-1)
            if a.size:
                yield np.clip(a * 32767, -32768, 32767).astype(np.int16)


@dataclass
class Session:
    ws: websockets.ServerConnection
    eng: Engines
    speaking: bool = False        # 사람이 말하는 중
    run: int = 0                  # 말하기 세대 — cancel마다 올라가 이전 문장들이 버려진다
    say_q: asyncio.Queue = field(default_factory=asyncio.Queue)
    buf: list = field(default_factory=list)      # 발화 중 모은 창들
    pre: list = field(default_factory=list)      # 시작 판정 전의 창들
    on_run: int = 0
    off_run: int = 0
    rest: bytes = b""

    async def send(self, obj):
        await self.ws.send(json.dumps(obj, ensure_ascii=False))

    # ── 마이크 → VAD → STT ──────────────────────────────────────────────────
    async def on_pcm(self, data: bytes):
        data = self.rest + data
        n = (len(data) // 2 // FRAME) * FRAME * 2
        chunk, self.rest = data[:n], data[n:]
        if not chunk:
            return
        pcm = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        for i in range(0, len(pcm), FRAME):
            await self.on_frame(pcm[i:i + FRAME])

    async def on_frame(self, frame: np.ndarray):
        p = await asyncio.to_thread(self.eng.vad_prob, frame)
        if not self.speaking:
            self.pre.append(frame)
            if len(self.pre) > PRE_ROLL:
                self.pre.pop(0)
            self.on_run = self.on_run + 1 if p >= SPEECH_ON else 0
            if self.on_run >= START_FRAMES:
                self.speaking = True
                self.buf = list(self.pre)
                self.pre = []
                self.off_run = 0
                await self.send({"type": "speech_start"})
            return
        self.buf.append(frame)
        self.off_run = self.off_run + 1 if p < SPEECH_OFF else 0
        too_long = len(self.buf) * FRAME / SR_IN > MAX_UTTER_S
        if self.off_run >= END_FRAMES or too_long:
            self.speaking = False
            self.on_run = 0
            audio = np.concatenate(self.buf)
            self.buf = []
            self.eng.vad_reset()
            await self.send({"type": "speech_end"})
            asyncio.create_task(self.transcribe(audio))

    async def transcribe(self, audio: np.ndarray):
        t0 = time.time()
        text = await asyncio.to_thread(self.eng.transcribe, audio)
        ms = int((time.time() - t0) * 1000)
        log(f"stt {ms}ms {len(audio)/SR_IN:.1f}s → {text!r}")
        if text:
            await self.send({"type": "transcript", "text": text, "ms": ms})

    # ── 문장 → TTS → 브라우저 ────────────────────────────────────────────────
    async def speaker_loop(self):
        while True:
            run, turn, seq, text = await self.say_q.get()
            if run != self.run:
                continue                                   # cancel 뒤의 옛 문장
            t0 = time.time()
            first = None
            loop = asyncio.get_running_loop()
            chunks: asyncio.Queue = asyncio.Queue()

            def produce():
                try:
                    for c in self.eng.speak(text):
                        loop.call_soon_threadsafe(chunks.put_nowait, c)
                finally:
                    loop.call_soon_threadsafe(chunks.put_nowait, None)

            task = asyncio.create_task(asyncio.to_thread(produce))
            while True:
                c = await chunks.get()
                if c is None:
                    break
                if run != self.run:
                    continue                               # 끼어들었다 — 만들던 건 버린다 (생성은 끝까지 돌지만 짧다)
                if first is None:
                    first = time.time() - t0
                await self.send({"type": "audio", "turn": turn, "seq": seq, "sr": self.eng.tts_sr, "last": False})
                await self.ws.send(c.tobytes())
            await task
            if run == self.run:
                await self.send({"type": "audio", "turn": turn, "seq": seq, "sr": self.eng.tts_sr, "last": True})
                log(f"tts first={first and int(first*1000)}ms total={int((time.time()-t0)*1000)}ms {text!r}")

    async def handle(self):
        await self.send({"type": "ready", "tts": TTS_MODEL, "voice": TTS_VOICE, "stt": STT_MODEL})
        speaker = asyncio.create_task(self.speaker_loop())
        try:
            async for msg in self.ws:
                if isinstance(msg, (bytes, bytearray)):
                    await self.on_pcm(bytes(msg))
                    continue
                try:
                    m = json.loads(msg)
                except Exception:
                    continue
                t = m.get("type")
                if t == "say":
                    await self.say_q.put((self.run, int(m.get("turn", 0)), int(m.get("seq", 0)), str(m.get("text", ""))))
                elif t == "cancel":
                    self.run += 1
                    while not self.say_q.empty():
                        self.say_q.get_nowait()
                elif t == "stop":
                    break
        finally:
            speaker.cancel()


async def main():
    eng = Engines()

    async def on_conn(ws):
        log(f"call session from {ws.remote_address}")
        try:
            await Session(ws, eng).handle()
        except websockets.ConnectionClosed:
            pass
        log("session closed")

    async def health(conn, request):
        if request.path in ("/health", "/voice/health"):
            return conn.respond(200, json.dumps({"ok": True, "tts": TTS_MODEL, "voice": TTS_VOICE, "stt": STT_MODEL}) + "\n")
        return None

    async with websockets.serve(on_conn, "localhost", PORT, process_request=health, max_size=8 * 1024 * 1024):
        log(f"theworld voice on ws://localhost:{PORT}  (health: http://localhost:{PORT}/health)")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
