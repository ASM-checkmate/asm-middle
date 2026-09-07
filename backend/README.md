# theworld backend

에이전트의 **말을 짓는** 서버. 지금은 Ollama 앞의 관문 하나다 — 시뮬레이션(시계·하루·판단)은
아직 프론트에 있고, 무엇을 말할지만 여기로 온다. 왜 이렇게 나눴는지는
`docs/adr/0006-backend-and-llm.md`, API는 `docs/CONTRACT.md`.

```bash
# 1. Ollama와 모델 (한 번만)
brew install ollama            # 또는 https://ollama.com
ollama pull qwen3.5:9b         # small
ollama pull qwen3.8:27b        # good (18GB, 메모리 24GB 이상 권장)

# 2. 서버
cd backend
npm install                    # 타입체크·린트용. 실행 자체는 의존성 0
cp .env.example .env           # 필요하면 모델·포트 바꾸기
npm run dev                    # http://localhost:8787
```

프론트(`frontend/`, `npm run dev`)는 `/api`를 이 서버로 프록시한다. 앱에서 `?dev=1` 패널의
**llm** 줄에서 `off · small · good`을 고른다. 서버가 없거나 늦으면 프론트는 규칙 기반 답장을
그대로 쓴다 — 백엔드 없이도 앱은 돈다.

```bash
npm test          # 프롬프트·파서 검사 (Ollama 없이)
npm run typecheck
```
