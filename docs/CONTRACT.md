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
  "trip": null | "교토",
  "model": "qwen3.5:9b", "ms": 2310 }
```

*   `text: null`은 읽고 답하지 않는다는 뜻(읽씹). 프론트는 규칙 답장을 지운다 — 단, 규칙이 이미
    전화를 약속한 묶음이면 규칙 답장을 남긴다.
*   `worry`·`callMe`는 규칙이 못 알아들은 것을 모델이 알아들었을 때만 프론트가 뒤처리한다.
*   `trip`은 사용자가 어디로 여행 가자고 했을 때 그 도시 이름(한국어, ≤30자). 프론트는 아는 도시면
    소원만 적고, 모르는 도시면 `/api/trip/plan`을 부른다 (ADR-0009). 답장이 이미 떴어도 유효하다.

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

## POST /api/trip/plan

"교토 가자"의 교토를 웹에서 찾아 **도시 팩**(도시 정보 + 실제 장소들)으로 돌려준다 (ADR-0009).
Ollama Web Search 3회 → 로컬 모델이 JSON으로 추출 → Nominatim 지오코딩 → 조립. 프론트는 팩을
`sim/places.ts`에 등록할 뿐이고, 여행 카드·이동·도착지의 하루는 규칙 엔진이 그대로 만든다.
**1~2분** 걸린다. 같은 도시는 서버가 파일에 캐시해 두 번째부터 즉시다.

요청

```json
{ "tier": "small" | "good", "city": "교토" }
```

*   `city`는 1~40자. 한국어든 영어든. 추출 모델은 `tier`를 따른다 (서버의 `TRIP_MODEL`이 있으면 그것으로 고정).

응답 (200)

```json
{ "city": { "key": "kyoto", "nameKo": "교토", "nameEn": "Kyoto", "country": "JP", "tz": "Asia/Tokyo",
            "stayNights": 2,
            "hubs": { "airport": "kyoto-kansai-international-airport", "intlAirport": "kyoto-kansai-international-airport",
                      "station": "kyoto-kyoto-station", "hasSubway": true } },
  "places": [ { "id": "kyoto-kiyomizu-dera", "name": "기요미즈데라", "type": "temple", "lng": 135.785, "lat": 34.9949,
                "area": "히가시야마", "city": "kyoto", "country": "JP", "emoji": "⛩️" }, … ],
  "sources": ["https://…"],
  "cached": false, "model": "qwen3.5:9b", "ms": 48210 }
```

*   `places`는 프론트 `Place`와 같은 모양. 허브(공항·역·항구)와 호텔 1개를 포함하고, 전부
    `city === city.key`다. `hubs`의 id는 `places` 안에 있다.
*   국내 도시인데 역이 없으면 장소마다 `reachBy: "plane"`이 붙는다.
*   `key`는 붙박이 13개 도시와 겹치지 않는다 — 프론트가 아는 도시("도쿄")는 애초에 부르지 않는다.

오류: `400` 계약 위반, `422` 얇은 팩(장소 6개 미만·호텔 없음·허브 없음), `502` 검색·모델·지오코딩
실패, `503` 서버에 `OLLAMA_API_KEY`가 없음. 프론트는 어느 쪽이든 "찾아보려 했는데 잘 안 됐어" 한 줄을
남기고 만다.

## POST /api/plan/options

블록마다 "무엇을 할지" 카드 3장을 모델이 짓는다 (ADR-0010). 장소는 프론트가 보낸 카탈로그의 id만
쓸 수 있고(스키마 enum), 범주가 정해진 블록은 그 안에서, 비어 있으면 모델이 범주도 고른다. 언제 시작하고
어디를 거쳐 가는지, 돈·피로에 막히는지는 여전히 프론트 규칙(`review`·`timeline`)이 본다.

프론트는 두 가지로 부른다. **하루**: 하루가 시작될 때(또는 tier를 켤 때) 오늘의 빈 블록들을 한 번에 —
결과는 `llmPlans[today]`에 저장되고 블록이 시작하면 `decide()`가 규칙 카드 대신 쓴다. **블록 하나**: 사용자가
범주를 고르면 그 블록·범주의 카드를 — 그동안 "제안을 준비하는 중…"이 뜨고, 15초 안에 안 오면 규칙 카드.

요청

```json
{ "tier": "small" | "good",
  "agent": { "name": "모모", "traits": ["느긋한"], "likes": ["카페"], "dislikes": ["줄 서기"] },
  "day": { "dateKey": "2026-09-08", "weekday": "화요일" },
  "city": { "key": "seoul", "nameKo": "서울", "home": true },
  "status": { "money": 620000, "fatigue": 22, "mood": 58 },
  "worry": null | "work" | …,
  "visited": ["경의선숲길"],
  "places": [ { "id": "layered-yeonnam", "name": "카페 레이어드 연남", "type": "cafe", "area": "연남동" }, … ],
  "blocks": [ { "id": "am", "category": null, "from": "우리 집", "avoid": ["tuktuk-noodle"] },
              { "id": "lunch", "category": "meal", "from": "우리 집", "avoid": [], "previous": ["툭툭누들에서 팟타이"] } ] }
```

*   `places`는 그 도시의 활동 장소(역·공항·항구·친구 집 제외), 최대 120개.
*   `blocks`는 1~6개 (`morning`~`night`). `category`는 `meal|play|exercise|study|work|rest` 또는 null(모델이 고른다).
    `avoid`는 오늘 다른 블록에 이미 잡힌 장소, `previous`는 "다른 제안 보기"에서 방금 보여 준 제목들.

응답 (200)

```json
{ "blocks": [ { "id": "am", "category": "study",
                "options": [ { "placeId": "mapo-central-library", "title": "마포중앙도서관에서 책 읽기", "reason": "조용한 자리 좋아함", "emoji": "📚" }, … ] } ],
  "model": "qwen3.5:9b", "ms": 6100 }
```

*   요청한 블록 중 제대로 지어진 것만 온다(카드 2~3장). 빠진 블록은 프론트가 규칙으로 채운다.
*   `title`은 24자, `reason`은 30자 안. 범주에 안 맞는 장소 유형(식사에 헬스장)은 서버가 뺀다.

오류: `400` 계약 위반, `502` Ollama 오류·제한 시간(블록 하나 20초, 하루 120초). 프론트는 규칙 카드를 쓴다.

## POST /api/warm

모델을 미리 올려 둔다 (생성 없음). 벨이 울릴 때·대화 실을 열 때 프론트가 부른다 — 첫마디가 모델 로드(3~15초)를
기다리지 않게. 요청 `{ "tier": "small" | "good" }`, 응답 `{ "ok": true, "model": "…" }`. 답은 기다리지 않아도 된다.

## POST /api/call/turn

말로 하는 통화의 한 턴 (ADR-0011). 사용자가 방금 한 말(또는 통화가 막 붙은 첫 턴)에 에이전트가 뭐라고
하는지를 **문장이 완성될 때마다** 흘려보낸다 — 프론트가 그 문장을 음성 서비스(`voice/`)에 넣어 목소리로 낸다.
언제 걸리고 받을 수 있는지, 부재중이면 내용이 사라지는 것은 그대로 프론트 규칙(`sim/call.ts`).

요청

```json
{ "tier": "small" | "good",
  "agent": { "name": "모모", "traits": ["느긋한"], "likes": ["카페"], "dislikes": [] },
  "situation": { "where": "연남동 카페", "doing": "커피 마시는 중", "hhmm": "16:25", "mood": 70, "fatigue": 20 },
  "why": "worry" | "ask" | "friction" | "out",
  "worry": null | "work" | …,
  "transcript": [ { "from": "agent", "text": "여보세요, 나야." }, { "from": "me", "text": "어 왔어?" } ],
  "user": "아 그냥 팀 사람들이 좀 그래" | null }
```

*   `why`: worry(약속한 전화) · ask(걸어 달래서) · friction(어긋남 통보) · out(사용자가 걸었다).
*   `transcript`는 지금까지 오간 말, 마지막 20줄. `user`가 null이면 첫 턴 — 에이전트가 먼저 말한다.

응답 (200, `application/x-ndjson`) — 한 줄에 문장 하나, 끝에 `done`

```
{"s":"어… 그랬구나."}
{"s":"많이 힘들었겠다."}
{"done":true,"model":"qwen3.5:9b","ms":1420}
```

*   문장은 60자 안, 이름표·따옴표·이모지·지문을 걷어 낸 것. 한 턴은 한두 문장이다.
*   **끼어들기**: 사용자가 말을 시작하면 프론트가 요청을 닫는다. 서버는 그 신호로 Ollama 생성을 멈춘다.

오류: `400` 계약 위반, 스트림 중 오류는 `{"error": …}` 한 줄로 끝난다. 프론트는 통화를 이어 간다.

## 음성 서비스 (`voice/`, WebSocket)

백엔드가 아니라 별도 선택 서비스다(파이썬·MLX). 귀(STT)·목소리(TTS)·말 감지(VAD)만 하고 말은 짓지 않는다.
기본 주소 `ws://localhost:8790`, 프론트 개발 서버는 `/voice`를 여기로 프록시한다(`/voice/health`로 있는지 본다).

| 방향 | 프레임 | 뜻 |
|---|---|---|
| 브라우저 → | binary | 마이크 PCM 16kHz · mono · int16, 통화 중 계속 |
| 브라우저 → | `{"type":"say","turn":n,"seq":i,"text":"…"}` | 이 문장을 목소리로 |
| 브라우저 → | `{"type":"cancel"}` | 말하던 것·줄 선 것 전부 버려라 (끼어들었다) |
| 브라우저 → | `{"type":"stop"}` | 세션 끝 |
| → 브라우저 | `{"type":"ready","tts":…,"voice":…,"stt":…}` | 붙었다 |
| → 브라우저 | `{"type":"speech_start"}` / `{"type":"speech_end"}` | 사람 목소리가 들리기 시작했다 / 끝났다 |
| → 브라우저 | `{"type":"transcript","text":"…","ms":…}` | 한 발화가 글로 |
| → 브라우저 | `{"type":"audio","turn":n,"seq":i,"sr":24000,"last":false}` + binary | 목소리 조각 (int16 PCM). `last:true`는 그 문장의 끝 표시(binary 없음) |

*   `speech_start`가 오면 브라우저는 재생을 즉시 멈추고 `/api/call/turn` 요청을 닫는다 (barge-in).
*   `cancel` 뒤에 도착하는 옛 turn의 조각은 서비스가 버린다.
