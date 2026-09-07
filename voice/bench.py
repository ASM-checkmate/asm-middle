# 목소리·귀·VAD가 이 맥에서 얼마나 빠른지 잰다. 모델을 처음 받으면 몇 GB가 내려온다.
import time, sys, numpy as np
t0 = time.time()
from mlx_audio.tts.utils import load_model
import mlx.core as mx
tts = load_model("mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit")
print(f"tts loaded {time.time()-t0:.1f}s; speakers={getattr(tts, 'get_supported_speakers', lambda: '?')()}", flush=True)
text = "여보세요, 나야. 아까 사람한테 지쳤다고 했잖아. 누가 그랬어?"
for stream in ():
    t1 = time.time(); first = None; chunks = []; sr = None
    for r in tts.generate(text=text, voice="Sohee", lang_code="korean", stream=stream, streaming_interval=0.6):
        if first is None: first = time.time() - t1
        sr = r.sample_rate; chunks.append(np.array(r.audio, dtype=np.float32))
    audio = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
    print(f"tts stream={stream}: first={first:.2f}s total={time.time()-t1:.2f}s chunks={len(chunks)} sr={sr} dur={len(audio)/sr:.2f}s", flush=True)
import soundfile as sf
audio, sr = sf.read("bench-sohee.wav", dtype="float32")
# 귀: 방금 만든 소리를 16k로 내려 whisper에
from mlx_audio.resample import resample_audio_array as resample_audio
a16 = resample_audio(audio, sr, 16000) if sr != 16000 else audio
a16 = np.asarray(a16, dtype=np.float32)
t2 = time.time()
import mlx_whisper
res = mlx_whisper.transcribe(a16, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="ko", fp16=True)
print(f"whisper: {time.time()-t2:.2f}s (incl. load) → {res['text']!r}", flush=True)
t3 = time.time(); res = mlx_whisper.transcribe(a16, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="ko", fp16=True)
print(f"whisper warm: {time.time()-t3:.2f}s → {res['text']!r}", flush=True)
# VAD
from silero_vad import load_silero_vad
vad = load_silero_vad(onnx=True)
import torch
t4 = time.time(); probs = []
for i in range(0, len(a16) - 512, 512):
    probs.append(float(vad(torch.from_numpy(a16[i:i+512]), 16000)))
print(f"vad: {len(probs)} windows in {time.time()-t4:.3f}s, speech ratio={np.mean(np.array(probs) > 0.5):.2f}", flush=True)
