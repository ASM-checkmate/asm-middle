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
cp .env.example .env           # 필요하면 모델·포트 바꾸기 (.env는 npm run dev가 읽는다)
npm run dev                    # http://localhost:8787
```

**여행지 찾기**(`/api/trip/plan`, ADR-0009)는 Ollama Web Search 키가 있어야 한다. ollama.com 무료
계정을 만들고 https://ollama.com/settings/keys 에서 키를 받아 `.env`의 `OLLAMA_API_KEY`에 넣는다.
한도는 공개돼 있지 않다("개인용으로 넉넉한 무료 티어", 유료 Cloud는 더 높음) — 서버가 도시당 한 번만
검색하고 `.cache/trip/`에 캐시한다. 좌표는 Nominatim(OpenStreetMap) 공개 서버에서 받는데, 그쪽
정책대로 초당 1회로 순차 호출하고 `NOMINATIM_CONTACT`를 User-Agent에 싣는다. **`you@example.com` 같은
자리표시를 넣으면 403으로 막히니** 진짜 연락처를 넣거나 비워 둔다(비우면 `dev@localhost`). 키가 없으면 그
엔드포인트만 503이고 나머지는 그대로 돈다. 검색 결과와 완성된 팩은 `.cache/trip/`에 남아 같은 도시를 두 번
검색하지 않는다.

프론트(`frontend/`, `npm run dev`)는 `/api`를 이 서버로 프록시한다. 앱에서 `?dev=1` 패널의
**llm** 줄에서 `off · small · good`을 고른다. 서버가 없거나 늦으면 프론트는 규칙 기반 답장을
그대로 쓴다 — 백엔드 없이도 앱은 돈다.

```bash
npm test          # 프롬프트·파서 검사 (Ollama 없이)
npm run typecheck
```
