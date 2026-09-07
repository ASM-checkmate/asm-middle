# 프론트 ↔ 백엔드 계약

`backend/`가 내는 HTTP API의 단일 진실. 바뀌면 이 문서와 `backend/src/contract.ts`,
`frontend/src/sim/llm.ts`의 타입을 **같은 PR**에서 고친다. 두 패키지는 서로를 import하지 않는다.

기본 주소 `http://localhost:8787`. 프론트 개발 서버는 `/api`를 여기로 프록시한다.
모든 응답은 `application/json`. 오류는 `{ "error": string }`.

## GET /api/health

`{ "ok": true }`

## GET /api/models

어느 모델이 어느 단계인지, 설치돼 있는지.

```json
{ "ollama": true,
  "tiers": { "small": { "model": "qwen3.5:9b", "installed": true },
             "good":  { "model": "qwen3.8:27b", "installed": true } } }
```

## POST /api/chat/reply

한 묶음의 내 말에 에이전트가 **뭐라고** 답할지. **언제** 읽고 답할지는 프론트 규칙
(`sim/chat.ts`)이 정하고, 여기서는 말만 짓는다 (ADR-0006).

요청

```json
{ "tier": "small" | "good",
  "agent": { "name": "모모", "traits": ["느긋한"], "likes": ["카페"], "dislikes": [] },
  "situation": { "where": "연남동 카페", "doing": "커피 마시는 중", "hhmm": "16:25",
                 "lateWhy": null | "자느라" | "이동 중이라" | "조용히 해야 하는 데라" | "밥 먹느라",
                 "mood": 70, "fatigue": 20, "worry": null | "work" | "people" | "body" | "money" | "focus" | "blue" | "bored" },
  "recent": [ { "from": "me" | "agent", "text": "…" } ],
  "texts": ["야", "어디야", "뭐해"] }
```

*   `recent`는 이번 묶음을 뺀 최근 대화, 오래된 것부터. 서버는 마지막 12줄만 본다.
*   `texts`는 이번 묶음 — 연달아 보낸 내 말들. 1개 이상, 서버는 마지막 8줄만 본다.
*   `mood`·`fatigue`는 0–100.

응답 (200)

```json
{ "text": "ㅋㅋ 뭐야 한꺼번에. 나 지금 카페야, 커피 마시는 중" | null,
  "worry": null | "work" | …,
  "callMe": false,
  "model": "qwen3.5:9b", "ms": 2310 }
```

*   `text: null`은 읽고 답하지 않는다는 뜻(읽씹). 프론트는 규칙 답장을 지운다 — 단, 규칙이 이미
    전화를 약속한 묶음이면 규칙 답장을 남긴다.
*   `worry`·`callMe`는 규칙이 못 알아들은 것을 모델이 알아들었을 때만 프론트가 뒤처리한다.

오류: `400` 계약 위반, `502` Ollama 오류·제한 시간(`LLM_TIMEOUT_MS`, 기본 25초). 프론트는
어느 쪽이든 규칙 기반 답장을 그대로 쓴다.

## POST /api/sketch/read

사용자가 그림으로 넘긴 계획이 그 블록의 카드 중 어느 것을 가리키는지 비전 모델이 읽는다
(ADR-0007). 그림을 넘기는 순간 프론트가 미리 묻고 결과를 계획에 적어 둔다. 사용자에게는
보이지 않는다.

요청

```json
{ "tier": "small" | "good",
  "sketch": "data:image/png;base64,…",
  "category": "play",
  "options": [ { "id": "…", "title": "레이어드에서 커피", "placeName": "레이어드 연남", "placeType": "cafe" }, … ] }
```

*   `sketch`는 240px PNG dataURL (SketchOverlay가 만든 그대로). 본문 상한 512KB.
*   `options`는 1~8개. 그 블록의 카드 3장이 보통이다.

응답 (200)

```json
{ "optionId": "…" | null, "seen": "컵",
  "category": null | "meal" | "play" | "exercise" | "study" | "work" | "rest" | "travel",
  "model": "qwen3.8:27b", "ms": 2100 }
```

*   `optionId: null`은 어느 카드와도 이어지지 않는다는 뜻.
*   `category`는 그림이 어떤 종류의 활동으로 읽히는지. 활동이 아니거나 모르면 null.
    사용자가 고른 범주와 어긋나는지는 **프론트 규칙**이 판단한다 (ADR-0008) — 모델은 뜻만 돌려준다.
*   `seen`은 무엇으로 봤는지 한국어 한 조각(≤12자). 출발 줄에 끼워진다.

오류: `400` 계약 위반, `502` Ollama 오류·제한 시간. 프론트는 못 읽은 것으로 본다.
