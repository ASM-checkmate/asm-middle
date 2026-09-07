# theworld voice

말로 하는 통화의 **귀·목소리·말 감지**만 하는 선택 서비스 (docs/adr/0011-voice-call.md). 무슨 말을 할지는
`backend/`와 로컬 LLM이 짓고, 언제 걸리고 받을 수 있는지는 프론트 규칙이다. 이 서비스가 없어도 통화는 글로 된다.

```bash
# 한 번만 — Python 3.12 가상환경 (이 맥의 기본 3.14는 MLX 패키지가 아직 안 붙는다)
cd voice
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python mlx-audio mlx-whisper silero-vad onnxruntime websockets numpy soundfile

# 실행 (첫 실행에 모델 ~2GB를 받는다: Qwen3-TTS 0.6B 8bit + whisper-large-v3-turbo)
.venv/bin/python server.py           # ws://localhost:8790, http://localhost:8790/health
```

프론트(`frontend/`, `npm run dev`)는 `/voice`를 여기로 프록시한다. 앱에서 `?dev=1` 패널의 llm을 켜고
통화를 받으면(또는 대화 실에서 걸면) 마이크 권한을 묻고 말로 이어진다.

| 부품 | 모델 | 실측 (M5 Pro 48GB, 2026-09-08) |
|---|---|---|
| 목소리 | Qwen3-TTS 0.6B CustomVoice 8bit, 화자 Sohee(한국어) | 스트리밍 첫 소리 0.15초, 7초 문장을 1.5초에 |
| 귀 | whisper-large-v3-turbo (MLX) | `bench.py` 참조 |
| 말 감지 | Silero VAD (ONNX) | 32ms 창 |

환경변수: `VOICE_PORT`(8790) · `VOICE_TTS` · `VOICE_SPEAKER`(Sohee) · `VOICE_STT` · `VOICE_VAD_ON`(0.5) ·
`VOICE_VAD_OFF`(0.35) · `VOICE_END_FRAMES`(18 = 말 끝났다고 보는 침묵 ≈580ms).

`bench.py`는 목소리·귀·VAD 속도를 잰다.
