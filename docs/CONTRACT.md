# 프론트 ↔ 백엔드 계약

`backend/`(Spring, ADR-0012)가 내는 HTTP API의 단일 진실. 바뀌면 이 문서와 서버 DTO(`backend/src/main/java/world/theworld/server/**/*Dtos.java`),
`frontend/src/sim/{api,sync,llm,types}.ts`의 타입을 **같은 PR**에서 고친다. 두 패키지는 서로를 import하지 않는다.
기존 Node 백엔드 `backend/`는 참고용 원본이고 이 계약의 LLM 부분(§2.4)을 그대로 옮긴 것이다.

기본 주소 `http://localhost:8080`. 프론트 개발 서버는 `/api`를 여기로 프록시한다.
모든 응답은 `application/json`. 오류는 `{ "error": string }`.

## 공통

*   **인증.** 세션·토큰·비밀번호가 없다 (2026-09-08 개정). 서버가 시드로 가진 고정 아이디(`yoongwan`·`hojun`·`guest1`·
    `guest2`·`guest3`, 모양 `^[a-z][a-z0-9_]{1,23}$`) 중 하나를 골라 모든 `/api/**` 요청에 `X-User-Id: <id>`를 붙인다.
    없거나 모르는 아이디면 `401 { "error": "unauthorized" }` — 프론트는 저장된 사용자를 버리고 **로그인 필요 상태**로 둔다
    (서버가 죽은 것과 다르다). 공개 경로: `/api/health`, `/api/models`, `/api/users`, `/api/auth/login`, `/actuator/**`.
    아이디 하나 = 에이전트 하나 = 서버 문서 한 벌.
*   **오류 본문**은 항상 `{ "error": string }`. `400` 검증, `401` 인증, `403` 권한(친구 아님), `404` 없음,
    `409` 문서 충돌, `413` 본문 초과, `422` 얇은 여행 팩, `502` 외부(LLM·검색·지오코딩) 실패, `503` 검색 키 없음.
*   **본문 상한**: `/api/sketch/read` 512 KB, `/api/character/look` 1.5 MB, `/api/me/docs/*` 4 MB, 그 외 256 KB. 넘으면 `413 { "error": "body too large" }`
    (Content-Length로 먼저 자른다).
*   **시각**은 전부 epoch ms, id는 문자열. CORS는 `CORS_ORIGIN`(기본 `http://localhost:5173`), 헤더 `content-type, x-user-id`.

## 2.1 인증

사용자는 미리 만들어 둔 아이디 중 하나를 고르기만 한다. 프론트는 고른 것을 `theworld.user.v1`(`{ userId, name }`)에 두고
요청마다 `X-User-Id`로 보낸다 (`src/sim/api.ts`). 서버는 성공한 요청마다 `last_seen_at`을 갱신하되 1분에 한 번만 쓴다.
같은 기기에서 다른 아이디로 들어가면 프론트가 **로컬 저장본을 비우고** 서버에서 그 아이디의 문서를 받아 시작한다(없으면 새 하루).

### GET /api/users

공개. 고를 수 있는 아이디 전부, `id` 순.

```json
{ "users": [ { "id": "guest1", "name": "손님1" }, { "id": "guest2", "name": "손님2" }, { "id": "guest3", "name": "손님3" },
             { "id": "hojun", "name": "호준" }, { "id": "yoongwan", "name": "윤관" } ] }
```

### POST /api/auth/login

공개. 요청 `{ "userId": "yoongwan" }`. 응답 (200)

```json
{ "userId": "yoongwan", "name": "윤관" }
```

*   모르는 아이디 `404 { "error": "user not found" }`. `userId`가 없으면 `400 { "error": "userId required" }`, 모양이 틀리면
    `400 { "error": "userId must match ^[a-z][a-z0-9_]{1,23}$" }`.
*   서버 상태는 바뀌지 않는다 — 아이디가 있는지 확인하고 표시 이름을 받는 것뿐이다. 토큰은 없다.

### GET /api/me

`{ "userId": "yoongwan", "name": "윤관", "createdAt": 1788825600000 }`

## 2.2 문서 동기화

프론트 localStorage 저장본 4개를 **불투명 JSON 문서**로 그대로 맡긴다 — 서버는 내용을 해석하지 않고 버전만 안다.
마이그레이션·검증·catch-up은 여전히 프론트 스토어가 한다 (ADR-0012). 문서 이름은 `world | memory | book | places`
(localStorage `theworld.world.v5` · `theworld.memory.v2` · `theworld.book.v1` · `theworld.places.v1`). 그 밖의 이름은 `404`.

### GET /api/me/docs

있는 문서의 메타만.

```json
{ "docs": { "world": { "version": 3, "updatedAt": 1788843212820, "clientTs": 1788843212518 },
            "book":  { "version": 1, "updatedAt": …, "clientTs": … } } }
```

### GET /api/me/docs/{name}

`{ "name": "world", "version": 3, "updatedAt": …, "clientTs": …, "body": <JSON> }`. 없으면 `404`.
`body`는 넣은 JSON 그대로 (객체든 배열이든).

### PUT /api/me/docs/{name}

요청

```json
{ "baseVersion": 2, "clientTs": 1788843212518, "body": <JSON>, "force": false }
```

응답 (200) `{ "name": "world", "version": 3, "updatedAt": … }`

*   `baseVersion`은 내가 갖고 있던 판. 서버에 문서가 없으면 `0`일 때만 만들어진다(version 1). 있으면
    `baseVersion === 현재 version`일 때만 갱신(version+1).
*   아니면 **`409`** — 서버본을 그대로 돌려줘 클라이언트가 결정한다:
    `{ "error": "conflict", "name", "version", "updatedAt", "clientTs", "body" }` (서버에 없으면 `version: 0`, 나머지 null).
    프론트 정책(`src/sim/sync.ts`): 서버 `clientTs`가 내 마지막 로컬 저장보다 나중이면 서버본을 localStorage에 쓰고
    새로 뜬다, 아니면 `force: true`로 다시 보낸다.
*   `force: true`면 `baseVersion`을 무시하고 덮어쓴다 (version은 그래도 +1).
*   `clientTs`는 프론트가 저장한 실제 시각 — 충돌 판정의 근거일 뿐 서버는 비교하지 않는다.
*   본문 4 MB 초과 `413`. dev 시계(`?dev=1`)의 scale이 1이 아니면 프론트는 `world`/`book`을 올리지도 받지도 않는다.

## 2.3 에이전트 프로필 · 발행 일정 · 친구

FRIENDS_SPEC §4 — "서버가 붙으면 NPC 풀 자리에 실제 사용자 에이전트의 확정 일정이 들어온다". 프론트는 받은 것을
`world.remote` 캐시에 넣고(`src/sim/remote.ts`) 마주침·동행·친구 목록에 NPC보다 먼저 쓴다. 굴림·판정은 여전히 프론트.

타입 (프론트 `src/sim/types.ts`와 글자 그대로)

```ts
interface RemotePlace { id: string; name: string; type: string; lng: number; lat: number; area: string; city: string; country: string; emoji: string;
                        reachBy?: 'boat' | 'plane' | 'train'; ownerFriendId?: string }
interface RemoteAgent { id: string /* = userId */; name: string; homePlaceId: string /* = home.id */; color: string; emoji: string;
                        likes: string[]; traits: string[]; hairStyle?: string;
                        home: RemotePlace /* type 'friend_home', ownerFriendId = id, id = `home:${userId}` */ }
interface PublishedActivity { key: string /* `${dayKey}:${blockId}` */; agentId: string; dayKey: string; blockId: string; placeId: string;
                              place?: RemotePlace; category: string; title: string; emoji: string; arriveAt: number; endAt: number;
                              tz: string; companions: string[] }
```

`?` 필드는 없을 때 키 자체가 빠지고, `number|null`로 적힌 것(`metAt`·`metPlaceId`·`now`)은 `null`이 그대로 온다.

### PUT /api/me/agent

내 프로필. 요청 `{ "name", "color", "emoji", "hairStyle"?, "likes": string[], "traits": string[], "home": RemotePlace }`
→ 응답 (200) `RemoteAgent`.

*   `name` 1~40자, `likes`/`traits` 각 ≤ 12개·각 ≤ 30자, `home.lng`/`lat` 유한수. 아니면 `400`.
*   `home`은 서버가 `type: "friend_home"`, `ownerFriendId: <userId>`, `id: "home:<userId>"`로 **강제**한다 — 내 카탈로그의
    `home`을 그대로 보내도 상대에게는 "그 사람의 집"으로 간다.

### PUT /api/me/schedule

내 확정 일정을 창째로. 요청 `{ "from": ms, "to": ms, "activities": PublishedActivity[] }` → 응답 (200) `{ "count": n }`.

*   서버는 그 사용자의 `arriveAt ∈ [from, to)` 행을 **전부 지우고** 받은 것을 넣는다 (창 교체 — 하루가 다시 짜이면 옛 활동이
    남지 않는다). 프론트는 `[anchor.t, now+36h]` 창을 시간표가 바뀔 때마다 800 ms 디바운스로 올린다.
*   각 activity: `key` ≤ 120(창 안에서 유일), `title` ≤ 120(서버가 NFC), `arriveAt < endAt`, `arriveAt`은 창 안, 최대 64개.
    `agentId`는 무시하고 userId로 덮는다. `placeId`는 우회(friction) 반영된 실제 장소이고 `place`를 같이 싣는다 — 상대
    카탈로그에 없을 수 있다. 제목에서 친구 이름은 프론트가 미리 뺀다.

### POST /api/agents/at

내 활동 슬롯마다 "그때 거기 누가 있나". 요청

```json
{ "slots": [ { "key": "2026-09-08@Asia/Seoul:pm", "placeId": "seoul-cafe-x", "from": 1788850800000, "to": 1788858000000 } ] }
```

응답 (200)

```json
{ "hits": { "2026-09-08@Asia/Seoul:pm": [ { "agent": RemoteAgent, "overlapMs": 3600000, "activity": PublishedActivity } ] } }
```

*   슬롯 ≤ 16개. 자기 자신 제외, 같은 `placeId`이고 `[from,to) ∩ [arriveAt,endAt)`이 **30분(1,800,000 ms) 이상**인 것만,
    프로필(`PUT /api/me/agent`) 없는 사용자 제외, **`agent.id` 오름차순**, 슬롯당 ≤ 8명. 못 찾은 슬롯은 빈 배열.
*   프론트는 활동 key마다 **한 번만** 묻고(마주침 결정성), 이미 도착한 활동은 다시 묻지 않는다. 굴림 시드는
    `${dayKey}:${placeId}:${[내 id, 상대 id].sort()}`라 어느 기기에서 봐도 같은 마주침이다.

### GET /api/friends?at=<ms>

```json
{ "friends": [ { "agent": RemoteAgent, "metAt": 1788854400000, "metPlaceId": "seoul-cafe-x", "now": PublishedActivity | null } ] }
```

*   `now`는 `arriveAt <= at < endAt`인 발행 활동 — 시차 있는 친구도 그 순간으로 본다. `at`을 빼면 서버 시각.

### POST /api/friends

말을 튼 마주침이 진짜 사람이면 관계를 적는다. 요청 `{ "otherId", "metAt", "metPlaceId" }` → 응답 (200)
`{ "ok": true, "created": boolean }`.

*   대칭 저장(정렬된 쌍 하나) — 어느 쪽이 먼저 보내도 같은 관계, 두 번째부터 `created: false` (멱등).
    자기 자신 `400`, 없는 사용자 `404`. 프론트는 불 붙이고 잊는다 (`settle()`은 기다리지 않는다).

### DELETE /api/friends/{otherId}

`204`. 양쪽에서 사라진다.

### GET /api/friends/{otherId}/day?from=<ms>&to=<ms>

`{ "activities": PublishedActivity[] }` (arriveAt 순). 친구가 아니면 `403`, 창이 7일을 넘으면 `400`.
프론트는 remote 친구의 오늘~내일을 받아 동행 카드와 친구 목록의 '지금'에 쓴다.

## 2.5 SNS — 미디어 · 글 · 좋아요 · 피드 (초안, ADR-0020·0021. 2026-09-11)

> 서버 구현 기준(media·post 패키지, 2026-09-11). 사진은 픽셀(ADR-0020)이고 글은 opaque 문서가 아니라 서버 리소스다(ADR-0021). 프론트 타입은 이 절을 따른다.

타입

```ts
interface Media { id: string; ownerId: string; kind: 'shot' | 'sketch' | 'npc'; mime: 'image/webp' | 'image/png'; bytes: number; createdAt: number }
interface PostCut { shotId: string; actKey: string; win: 0 | 1 | 2 | 3; by: 'user' | 'agent' }
interface Post { id: string; authorId: string; createdAt: number; cuts: PostCut[]; caption: string;
                 place: string; area: string; city: string; category?: string; dateKey: string;
                 companions: string[]; editedByOwner: boolean; likes: number; likedByMe: boolean }
interface FeedItem { post: Post; author: RemoteAgent /* visibility는 항상, repShotId는 있을 때만 (§2.5 PUT /api/me/agent 개정) */;
                     why?: string /* 추천 구간의 이유 칩. 친구 글엔 없음 */ }
interface Feed { items: FeedItem[]; next: string | null }      // GET /api/feed
interface Posts { items: Post[]; next: string | null }         // GET /api/users/{id}/posts · GET /api/me/posts
interface Likes { likes: number; likedByMe: boolean }          // POST/DELETE /api/posts/{id}/like
```

### PUT /api/media/{id}

**id는 클라이언트가 만든다** — 32자 hex(`^[0-9a-f]{32}$`). 찍는 순간 폰이 id를 정하고 책·글은 업로드 전에도 그 id로 가리킨다(오프라인·dev 시계에서도 책이 먼저 산다).
본문 `image/webp`(Safari 폴백 `image/png`) 그대로, ≤ 60 KB, 긴 변 ≤ 300px. 쿼리 `?kind=shot|sketch|npc` → 응답 (201) `Media`.
**멱등**: 같은 소유자가 같은 id를 다시 올리면 바이트를 버리고 (200) 기존 `Media`(kind·mime도 처음 것). 다른 소유자의 id면 `403 'not yours'`. `kind=npc`는 내 폰의 가상 친구 글(ADR-0021 결정 6)이며 내 용량으로 센다. 파일은 `backend/data/media/<id>`(`theworld.media.dir`).
*   `400`: `id must be 32 hex chars` · `kind required` / `kind must be shot|sketch|npc` · `unsupported image type`(415가 아니다 — 본문이 JSON이 아닌 경로라서) · `body required`. 60 KB(61440 바이트)를 넘으면 `413 'body too large'`.
*   **dev 시계 예외 (프론트).** world/book 문서·일정 발행은 dev가 시간을 돌리는 중(`clockWhy`≠null)이면 올리지 않지만(§3.3), 미디어와 글은 **올린다** —
    id는 폰이 정한 고유값이고 PUT은 멱등이며 픽셀은 세계의 시각을 옮기지 않는다. 가드는 부트스트랩 여부·사용자·`backend≠down`뿐 (`sim/media.ts`).

### GET /api/media/{id}

저장된 타입(`image/webp`·`image/png`) 그대로. 권한: 소유자, 소유자의 친구, 그 id를 참조하는 **공개 계정의 글**이 있을 때(`visibility: 'public'`인 작성자의 `Post.cuts[].shotId` — 비공개로 돌리면 다시 막힌다), 또는 **누군가의 대표컷**(`RemoteAgent.repShotId`)일 때 — 핀은 본인이 얼굴로 내건 것이라 공개 여부와 무관하게 누구나 받고(SNS_SPEC §10 "비공개도 이름·대표컷"), 핀을 풀면 다시 막힌다. 아니면 `403 'not allowed'`(없으면 `404`; 행은 있는데 파일이 지워졌어도 `404`). `Cache-Control: private, max-age=31536000`.
헤더 인증이라 `<img src>`로는 못 받는다 — 프론트는 `X-User-Id`를 붙여 fetch하고 blob URL로 그린다(폰 캐시는 IndexedDB LRU, ADR-0020 §5).

### POST /api/posts

요청 `{ "cuts": PostCut[] (1~10), "caption" (≤ 300자, 빈 문자열 허용), "place", "area", "city" (각 1~120자), "category"?, "dateKey" (1~120자), "companions": string[], "editedByOwner": boolean }`
→ 응답 (201) `Post`. **id는 서버가 만든다**(32자 hex). `authorId`는 헤더의 나 — 본문에 있어도 무시.
*   `cuts[].shotId`는 전부 내 미디어(`PUT /api/media/{id}`로 올린 것)여야 한다 — 남의 것·모르는 것·모양 오류 모두 `400 'cut not yours'`. `win` 0~3(`cut.win must be 0-3`), `by` user|agent(`cut.by must be user|agent`), `actKey` 1~120자. 개수 밖이면 `cuts must have 1-10 items`.
*   `companions`는 서버가 **내 친구 목록과 교집합만** 남긴다 — 남·모르는 id는 400이 아니라 조용히 빠진다. 문자열은 전부 NFC.
*   `category`는 검증하지 않는다(≤ 12자, 빈 문자열은 없음으로). 추천의 이유 칩은 아는 값(`sleep·meal·play·exercise·study·work·rest·travel`)만 한글로 옮긴다.

### PATCH /api/posts/{id}

`{ "cuts"?, "caption"? }` → (200) `Post`. 작성자만(`403 'not yours'`, 없으면 `404`). 온 칸만 바꾸고(컷 검증은 POST와 같다) 고치면 **무조건** `editedByOwner: true`.

### DELETE /api/posts/{id}

`204`. 작성자만(`403 'not yours'`, 없으면 `404`). 좋아요 행도 같이 지운다. **미디어는 남긴다** — "책이 참조하지 않는 것만 지운다"는 책 문서(opaque)를 열어 봐야 알 수 있어 이 단계 밖(ADR-0020 결정 4의 정리 정책과 함께 나중에).

### POST /api/posts/{id}/like · DELETE /api/posts/{id}/like

`{ "likes": n, "likedByMe": boolean }`. 멱등(두 번 눌러도 한 번, 두 번 취소해도 0 아래로 안 간다 — 동시에 눌러도·취소해도 마찬가지). 비공개 계정의 글은 친구만(`403 'not allowed'`), 없으면 `404`.
`likes`는 `post` 행의 비정규화 카운터 — 좋아요 행과 같은 트랜잭션에서, 실제로 넣은·지운 행 수만큼만 맞춘다. **프로필을 안 올린 사용자는 비공개로 친다**(기본값과 같다).

### GET /api/feed?cursor=<opaque>&limit=20

```json
{ "items": FeedItem[], "next": "<cursor>" | null }
```

*   `limit` 1~50(기본 20, 밖이면 `400 'limit must be 1-50'`). `cursor`는 서버가 준 것을 그대로 — 열어 보지 않는다(모양이 틀리거나 offset이 2³¹−1을 넘으면 `400 'cursor invalid'`). 속은 `<구간>:<offset>`의 base64url: 구간 `f`(친구 글)·`r`(추천). 처음엔 커서 없이.
*   앞부분은 **친구 글**(친구 관계가 있고 프로필을 올린 사람의 글, `createdAt` 내림차순 → `id` 내림차순). 다 나오면 **같은 응답 안에서** `items[].why`가 붙는 **추천 글**이 이어진다 — 경계는 클라이언트가 `why` 유무로 안다. `next`가 null이면 끝.
*   추천 후보: `visibility: 'public'`인 사람의 글 중 **나·내 친구가 쓴 것과 내가 좋아요한 글을 뺀** 최신 500편. "본 글 제외"는 지금 **좋아요한 글만** 뜻한다 — 서버는 무엇을 봤는지 모른다(열람 기록을 보내는 경로가 없다).
*   추천 점수는 서버만 안다: `0.5 취향유사도 + 0.3 인기도 + 0.2 신선도`. 취향 = 내 히스토그램(최근 14일 발행 일정의 범주·동네·도시 가중 1.0, 좋아요한 글의 면 가중 1.5)과 글의 one-hot 면 `{category, area, city}`의 코사인. 인기도 = `log1p(likes)·e^(-나이일/7)`를 후보 최댓값으로 [0,1]. 신선도 = `e^(-나이일/3)`.
    점수 내림차순, 동률은 `createdAt` 내림차순 → `id` 내림차순 — **데이터가 같으면 순서도 같다**. 후처리: 같은 작성자 연속 최대 2편(다음 다른 작성자를 앞으로 당김), 매 7번째 자리는 남은 후보 중 취향유사도가 가장 낮은 글(탐색 몫 ≈ 14%).
    가중치·상수는 `FeedService` 한자리에 있고 서버에서만 바꾼다. 전체 순위를 요청마다 다시 매기고 offset으로 자르므로 **사이에 좋아요를 누르면 다음 장의 경계가 조금 움직일 수 있다**(그 글이 빠지고 취향이 바뀐다).
*   `why`(이유 칩)는 맞은 면 중 가장 구체적인 것: 범주 → `'<범주 한글> 글을 좋아하셔서'`(식사·놀기·운동·공부·일·쉬기·여행·잠), 동네 → `'<area> 이웃'`, 도시만 → `'같은 도시'`, 아무것도 안 맞으면 `'요즘 인기'`.
*   `author`는 `RemoteAgent` 그대로(`visibility` 항상, `repShotId` 있을 때만). 가상 친구 글은 여기 없다 — 프론트가 로컬에서 친구 구간에 끼운다.

### GET /api/users/{id}/posts?cursor=&limit=

```json
{ "items": Post[], "next": "<cursor>" | null }
```

그 사람의 글 격자(`createdAt` 내림차순). 비공개 + 친구 아님 `403 'not allowed'`(나 자신은 늘 됨). `limit`·`cursor` 규칙은 피드와 같되 구간은 `u` 하나 — 피드 커서를 여기 쓰면 `400 'cursor invalid'`. `GET /api/me/posts`는 내 것.

### PUT /api/me/agent (개정)

요청에 `"gender"?: "female" | "male"`(ADR-0023), `"visibility"?: "public" | "private"`, `"repShotId"?: string`(대표컷 핀)이 추가된다.
`RemoteAgent`에 같은 세 칸이 실린다 — `visibility`는 항상, `gender`·`repShotId`는 있을 때만(키 생략). 성별은 서버가 검증만 하고 추정하지 않는다.

*   세 칸 모두 **키를 빼면 이전 값을 지킨다**(처음 올리는 프로필은 `visibility: 'private'`, 나머지 없음) — 이 칸을 모르는 클라이언트(부팅·메모리 갱신마다 올리는 `publishProfile`)가 다시 올려도 공개 여부·성별·핀이 되돌아가지 않는다.
    `gender`·`repShotId`는 **명시적 `null`** 로만 지운다(`"repShotId": null` = 핀 풀기); `visibility`는 지울 수 없다(`null`도 이전 값).
*   `repShotId`는 내 미디어(`PUT /api/media/{id}`로 올린 것)여야 한다 — 남의 것·모르는 것·모양 오류는 `400 'repShotId not yours'`. 핀돼 있는 동안 그 컷은 누구나 받는다(GET /api/media).
*   `400`: `gender must be female|male` · `visibility must be public|private`.
*   프론트 숙제: `types.ts`의 `RemoteAgent`·`remote.ts`의 `validRemoteAgent`가 아직 세 칸을 버린다 — SNS UI 단계에서 실어야 한다(서버는 이미 낸다).

## 2.4 LLM 관문

기존 Node 백엔드의 계약을 그대로 옮겼다 (ADR-0006·0007·0009). 프롬프트·파서·스키마는 `backend/src/*.ts`를 글자 단위로
이식했고, 모델 호출은 검사하지 않는다 — 실패하면 프론트가 규칙으로 돈다. `/api/health`·`/api/models`는 공개 경로.

### GET /api/health

`{ "ok": true }`

### GET /api/models

어느 모델이 어느 단계인지, 설치돼 있는지.

```json
{ "ollama": true,
  "tiers": { "small": { "model": "qwen3.5:9b", "installed": true },
             "good":  { "model": "qwen3.8:27b", "installed": true } } }
```

### POST /api/chat/reply

한 묶음의 내 말에 에이전트가 **뭐라고** 답할지. **언제** 읽고 답할지는 프론트 규칙
(`sim/chat.ts`)이 정하고, 여기서는 말만 짓는다 (ADR-0006).

요청

```json
{ "tier": "small" | "good",
  "agent": { "name": "모모", "traits": ["느긋한"], "likes": ["카페"], "dislikes": [] },
  "situation": { "where": "연남동 카페", "doing": "커피 마시는 중", "hhmm": "16:25",
                 "lateWhy": null | "자느라" | "이동 중이라" | "조용히 해야 하는 데라" | "밥 먹느라",
                 "mood": 70, "fatigue": 20, "worry": null | "work" | "people" | "body" | "money" | "focus" | "blue" | "bored",
                 "crush": null | { "name": "하늘", "stage": "interest" | "like" | "love" } },
  "recent": [ { "from": "me" | "agent", "text": "…" } ],
  "texts": ["야", "어디야", "뭐해"],
  "batch": "b1" }
```

*   `recent`는 이번 묶음을 뺀 최근 대화, 오래된 것부터. 서버는 마지막 12줄만 본다.
*   `texts`는 이번 묶음 — 연달아 보낸 내 말들. 1개 이상, 서버는 마지막 8줄만 본다.
*   `mood`·`fatigue`는 0–100.
*   `situation.crush`는 선택 — 설렘 대상의 이름(1–40자)과 단계(ADR-0023, AFFECTION_SPEC §4). 없으면 생략하거나 null.
    숫자(`crush.v`)는 보내지 않는다 — 단계는 프런트가 AFFECTION_SPEC §1의 띠(`crushStage`)로 고르고, 여럿이면 `v`가 가장 큰 한 사람(`crushTarget`).
    있으면 서버가 프롬프트에 단계 한 줄과 "직접 인정하지 않는다" 규칙을 넣고, 사용자·최근 대화가 꺼낸 적 없는 그 이름이 답장에 나오면 답장을 null로 돌린다.
    이름·단계가 틀린 모양이면 400이 아니라 없는 것으로 친다.
*   `batch`는 묶음 id(선택). 같은 (사용자, batch)의 진행 중 호출은 새 호출이 오면 서버가 취소하고, 취소된 쪽은
    `502 { error: 'reply cancelled: …' }`로 끝난다 — 답은 마지막 묶음에만 필요하다.

응답 (200)

```json
{ "text": "ㅋㅋ 뭐야 한꺼번에. 나 지금 카페야, 커피 마시는 중" | null,
  "worry": null | "work" | …,
  "callMe": false,
  "trip": null | "교토",
  "model": "qwen3.5:9b", "ms": 2310 }
```

*   `text: null`은 읽고 답하지 않는다는 뜻(읽씹). 프론트는 규칙 답장을 지운다 — 단, 규칙이 이미
    전화를 약속한 묶음이면 규칙 답장을 남긴다. `situation.crush`를 실은 요청의 `null`은 서버가 이름을 먼저 꺼낸 답을 버린 것일 수도
    있어(AFFECTION_SPEC §4, `ReplyService.leaksCrushName` — 사람 이름꼴만 본다) 그때도 규칙 답장을 남긴다.
*   `worry`·`callMe`는 규칙이 못 알아들은 것을 모델이 알아들었을 때만 프론트가 뒤처리한다. 상황과 무관하게 세운다 —
    못 받는 상황이면 프론트가 막힌 것이 끝난 뒤로 벨을 예약하고, 둘 다 true면 곧 거는 고민 전화 하나다 (ADR-0013).
*   `trip`은 사용자가 어디로 여행 가자고 했을 때 그 도시 이름(한국어, ≤30자). 프론트는 아는 도시면
    소원만 적고, 모르는 도시면 `/api/trip/plan`을 부른다 (ADR-0009). 답장이 이미 떴어도 유효하다.

오류: `400` 계약 위반, `502` Ollama 오류·제한 시간(`LLM_TIMEOUT_MS`, 기본 25초). 프론트는
어느 쪽이든 규칙 기반 답장을 그대로 쓴다.

### POST /api/sketch/read

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

### POST /api/character/look

사람 사진 한 장을 캐릭터의 **겉모습 옵션**(피부·머리·안경·수염·상의)으로 옮긴다. 비전 모델은 겉모습만 보고 신원은 묻지도 답하지도
않는다. 그림은 프론트가 옵션으로 그린다 — 서버는 이미지를 만들지 않고 저장하지도 않는다.

요청

```json
{ "tier": "small" | "good", "photo": "data:image/jpeg;base64,…" }
```

*   `photo`는 JPEG·PNG·WebP dataURL. 프론트가 긴 변 512px JPEG로 줄여 보낸다. 본문 상한 1.5 MB.
*   **`good`을 기본으로 쓴다.** 2026-09-10 실측: 어두운 피부의 인물 사진을 27B(good)만 `dark/black`으로 읽었고 9B(small)·gemma4:12b는
    `light/gray`라고 답했다. 피부·머리 색은 작은 모델이 자주 틀린다.

응답 (200)

```json
{ "look": { "skin": "dark", "hairColor": "black", "hairStyle": "short", "glasses": "none", "beard": "none", "top": "night" },
  "seen": "검은 정장에 넥타이를 매고 환하게 웃고 있는 짧은 머리 남성",
  "model": "qwen3.8:27b", "ms": 5500 }
```

*   `look`의 값은 정해진 문자열뿐이다: `skin` light|fair|tan|brown|dark · `hairColor` black|dark-brown|brown|blond|red|gray|white ·
    `hairStyle` bowl|short|buzz|bob|long|curly|bald · `glasses` none|round|square · `beard` none|stubble|mustache|full ·
    `top` coral|sun|mint|sky|night|paper|leaf. 모델이 빠뜨리거나 벗어난 칸은 서버가 기본값(fair · dark-brown · bowl · none · none · coral)으로
    메운다 — 응답에 null은 없다.
*   `seen`은 모델이 본 겉모습 한 문장(≤60자, 없으면 ""). 화면에 보여 줄 필요는 없다.

오류: `400` 계약 위반(`tier must be small|good` · `photo must be an image dataURL`), `413` 본문 초과, `502` Ollama 오류·제한 시간.

### POST /api/trip/plan

"교토 가자"의 교토를 웹에서 찾아 **도시 팩**(도시 정보 + 실제 장소들)으로 돌려준다 (ADR-0009).
Ollama Web Search 3회 → 로컬 모델이 JSON으로 추출 → Nominatim 지오코딩 → 조립. 프론트는 팩을
`sim/places.ts`에 등록할 뿐이고, 여행 카드·이동·도착지의 하루는 규칙 엔진이 그대로 만든다.
**1~2분** 걸린다. 같은 도시는 서버가 `trip_pack` 테이블에 캐시해(모든 사용자 공유) 두 번째부터 즉시다. 요청 전체 데드라인은 100초.

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

### POST /api/plan/options

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

오류: `400` 계약 위반, `502` Ollama 오류·제한 시간(블록 하나 20초, 하루 120초), `503 yielded to call` 통화 턴이 와서
모델을 양보했다 (ADR-0011 결정 6 — `/api/trip/plan`도 같다). 프론트는 규칙 카드를 쓴다. 보호 경로다 — `X-User-Id`가 있어야 한다
(Spring 이식, ADR-0012). 서버는 `theworld.plan.one-timeout-ms`·`day-timeout-ms`(환경변수 `PLAN_ONE_TIMEOUT_MS`·`PLAN_DAY_TIMEOUT_MS`).

### POST /api/warm

모델을 미리 올려 둔다 (생성 없음, Ollama `/api/generate`에 빈 프롬프트). 벨이 울릴 때·대화 실을 열 때 프론트가 부른다 — 첫마디가
모델 로드(3~15초)를 기다리지 않게. 요청 `{ "tier": "small" | "good" }`(없거나 이상하면 small), 응답 `{ "ok": true, "model": "…" }`,
Ollama가 없으면 `502`. 답은 기다리지 않아도 된다. 보호 경로다 — `X-User-Id`가 있어야 한다.

### POST /api/call/turn

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

오류: `400` 계약 위반(스트림이 열리기 전이라 보통 JSON), 스트림 중 오류는 `{"error": …}` 한 줄로 끝난다(상태는 이미 200).
프론트는 통화를 이어 간다. 보호 경로다 — `X-User-Id`가 있어야 한다. 통화 턴이 오면 서버가 돌고 있던 하루 계획·여행지
추출을 끊는다(그쪽은 `503 yielded to call`). 한 턴은 20초 안, 문장은 60자 안.

### 음성 서비스 (`voice/`, WebSocket)

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
