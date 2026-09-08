# theworld 서버 (Spring)

세계 상태 동기화 · 진짜 사람 에이전트(프로필·발행 일정·마주침·친구) · LLM 어댑터. 시뮬레이션(굴림·판정·만화)은 프런트에 남는다(ADR-0006 결정 5).
HTTP 계약은 `docs/CONTRACT.md`, 설계 근거는 `docs/adr/0012-spring-backend.md`. 기존 Node 백엔드(`backend/`)는 참고용 원본이다.

스택: Java 21 LTS · Spring Boot 3.5.16 · Gradle(Kotlin DSL) · Spring MVC + 가상 스레드 · Spring Data JPA + Flyway · H2(dev) / PostgreSQL(prod) · `RestClient`.

## 실행

```sh
cd backend
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home   # Java 21
./gradlew bootRun          # http://localhost:8080
./gradlew test             # JUnit5 + MockMvc, H2 인메모리(test 프로필) — 155개, Ollama·검색·Nominatim은 부르지 않는다
```

JDK가 없으면 Gradle 툴체인이 내려받는다(settings.gradle.kts의 foojay). 프런트 개발 서버(Vite)는 `/api`를 `BACKEND_URL`(기본 `http://localhost:8080`)로 프록시하므로 둘을 같이 띄우면 된다 — `.claude/launch.json`의 `theworld-backend`(8080)·`theworld-dev`(5173).
서버가 없어도 앱은 뜬다(오프라인, 상단 회색 점 "혼자 생각 중").

LLM 기능(답장·그림 읽기·여행·하루 계획·말로 하는 통화의 턴·예열)은 Ollama가 있어야 한다: `brew install ollama && ollama pull qwen3.5:9b` (good 단계는 `qwen3.8:27b`). 여행지 찾기(`/api/trip/plan`)는 Ollama Web Search 키 `OLLAMA_API_KEY`가 있어야 하고, 없으면 503으로 답한다.

확인:

```sh
curl localhost:8080/actuator/health                                   # {"status":"UP"}
curl localhost:8080/api/health                                        # {"ok":true}
curl localhost:8080/api/models                                        # 어느 모델이 설치돼 있나
curl localhost:8080/api/users                                         # 고를 수 있는 아이디 — {"users":[{"id":"guest1","name":"손님1"},…]}
curl -X POST -H 'content-type: application/json' -d '{"userId":"yoongwan"}' localhost:8080/api/auth/login   # {"userId":"yoongwan","name":"윤관"} / 모르면 404
curl -H 'X-User-Id: yoongwan' localhost:8080/api/me                   # {"userId":"yoongwan","name":"윤관","createdAt":…} / 헤더 없으면 401
curl -X PUT -H 'X-User-Id: yoongwan' -H 'content-type: application/json' \
     -d '{"baseVersion":0,"clientTs":0,"body":{"hello":1}}' localhost:8080/api/me/docs/world     # → {"name":"world","version":1,…}
```

인증은 토큰 없는 고정 아이디다(`yoongwan`·`hojun`·`guest1`·`guest2`·`guest3`, ADR-0012 개정): 보호 경로에 `X-User-Id: <id>`만 붙인다.
계약 전체를 순서대로 두드리는 스모크(로그인 → 문서 버전·409·force → 프로필·일정 → 다른 아이디로 겹침 조회(30분 규칙·정렬) → 친구 → LLM 검증 400 → 여행 503 → 413 → 401)는 시드 아이디 둘(예: `yoongwan`·`hojun`)로 돌린다. 개발 DB를 더럽히지 않으려면 `SPRING_DATASOURCE_URL`로 임시 파일을 가리킨다(아래).

## 프로필과 DB

| 프로필 | DB | 용도 |
| --- | --- | --- |
| (기본) | H2 파일 `backend/data/theworld.mv.db` (PostgreSQL 모드) | 개발. `data/`는 gitignore. 지우면 다음 실행에 다시 만든다 |
| `test` | H2 인메모리 `jdbc:h2:mem:test` | `./gradlew test` (src/test/resources/application-test.yml) |
| `prod` | PostgreSQL (`DATABASE_URL`, `DB_USER`, `DB_PASSWORD`) | `SPRING_PROFILES_ACTIVE=prod` |

스키마는 Flyway(`src/main/resources/db/migration/V1__init.sql`, 사용자 시드 `V2__seed_users.sql`)가 만들고 JPA는 `ddl-auto: validate`로 검사만 한다.
2026-09-08 인증 개정으로 `V1`의 `app_user`가 바뀌었다 — 그 전에 만든 `data/`가 있으면 지우고 다시 띄운다(체크섬 불일치).
H2와 PostgreSQL 둘 다 도는 SQL(text · bigint · varchar)만 쓴다 — H2에서 `text`가 CLOB으로 보고돼 검증이 어긋나는 문제는 `common/TheworldH2Dialect`가 흡수한다(prod는 표준 PostgreSQLDialect).

표: `app_user`(고정 아이디 5명, 시드) · `user_doc`(문서 4종, 버전) · `agent_profile` · `published_activity`(창 교체) · `friendship`(정렬된 쌍) · `trip_pack` / `trip_search`(여행 캐시, 모든 사용자 공유).

## 환경변수 (`application.yml` `theworld.*`)

| 변수 | 기본 | 뜻 |
| --- | --- | --- |
| `CORS_ORIGIN` | `http://localhost:5173` | 허용 origin(쉼표로 여러 개). 개발은 Vite 프록시라 same-origin |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 주소 |
| `LLM_TIMEOUT_MS` | `25000` | reply·sketch 모델 호출 타임아웃 |
| `MODEL_SMALL` / `MODEL_GOOD` | `qwen3.5:9b` / `qwen3.8:27b` | 모델 단계 |
| `TRIP_MODEL` | (비움 = tier 모델) | 여행지 추출 모델 고정 |
| `TRIP_MODEL_TIMEOUT_MS` | `90000` | 여행 모델 호출 타임아웃 |
| `TRIP_DEADLINE_MS` | `100000` | /api/trip/plan 요청 전체 데드라인 (지오코딩은 여기까지만) |
| `TRIP_SNIPPETS_MAX_CHARS` | `22000` | 검색 스니펫 예산 (검색어별 라운드로빈) |
| `OLLAMA_API_KEY` | (비움 = /api/trip/plan 503) | Ollama 웹 검색 키 |
| `NOMINATIM_URL` / `NOMINATIM_CONTACT` / `NOMINATIM_MIN_GAP_MS` | osm / (비움) / `1100` | 지오코딩 (전역 1.1초 간격, 8초 타임아웃·1회 재시도) |
| `SPRING_PROFILES_ACTIVE` | (없음) | `prod`면 PostgreSQL |
| `DATABASE_URL` / `DB_USER` / `DB_PASSWORD` | `jdbc:postgresql://localhost:5432/theworld` / `theworld` / (비움) | prod DB |
| `SPRING_DATASOURCE_URL` | (yml의 H2 파일) | dev DB 위치를 바꿀 때, 예: `jdbc:h2:file:/tmp/x;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH` |

문서 본문 상한 `theworld.docs.max-bytes`(4 MB)는 yml 고정값이다. 포트는 `server.port`(8080).

## 구조 (`world.theworld.server`)

- `common` — `{error}` 오류 형식(GlobalExceptionHandler), 본문 상한 필터(BodyLimitFilter: sketch 512 KB · docs 4 MB · 그 외 256 KB), CORS, 설정(TheworldProps), H2 방언.
- `auth` — 토큰 없는 고정 아이디. `GET /api/users`(id 순), `POST /api/auth/login`(있는지 확인·표시 이름, 404/400), `GET /api/me`. `UserIdAuthFilter`가 `X-User-Id`로 `/api/**`를 지키고(공개: `/api/health`, `/api/models`, `/api/users`, `/api/auth/login`, `/actuator/**`) `last_seen_at`은 1분에 한 번만 갱신한다.
- `sync` — `GET/PUT /api/me/docs/{world|memory|book|places}` 버전 규칙(baseVersion · 409에 서버본 동봉 · force). 본문은 해석하지 않는 불투명 JSON.
- `social` — `PUT /api/me/agent`(home을 `home:<userId>`·friend_home으로 강제), `PUT /api/me/schedule`(창 교체), `POST /api/agents/at`(30분 겹침·자기 제외·프로필 없는 사용자 제외·id 정렬·슬롯당 8명), `/api/friends*`(대칭·멱등·403·7일 창).
- `llm` — Ollama 클라이언트(`RestClient`, `format` 스키마는 `Map`/`List`로 만들어 `null`이 살아남는다), `/api/chat/reply`(같은 (user, batch)의 진행 중 호출은 새 호출이 오면 취소)·`/api/sketch/read`·`/api/models`. 프롬프트·파서·검증 문자열은 `backend/src/{reply,sketch}.ts`를 글자 단위로 옮겼다.
- `trip` — `/api/trip/plan`: Ollama Web Search 3회 → 모델 추출 → Nominatim → 조립. Node판의 결함 4개를 고쳤다(도심 80 km 안 후보 선택, 스니펫 예산·라운드로빈, 실제 들어간 번호 집합으로 src 검증, 100초 데드라인). 캐시는 `trip_pack`/`trip_search` 테이블.

## 알려진 한계

- `book`(앨범) 문서가 사진 dataURL을 품어 커진다 — 4 MB 상한에 먼저 닿는 문서이고, `pagehide` keepalive flush는 브라우저의 64 KB 제한 때문에 큰 문서를 못 보낸다.
- `world.journeys`는 정리되지 않아 문서가 자란다.
- Nominatim은 서버 전역 단일 락(1.1초 간격)이라 여러 사용자의 여행 요청이 직렬화된다.
- LLM 취소는 서버 스레드와 Ollama로 가는 HTTP 연결을 끊는다(인터럽트 → JDK HttpClient가 교환을 취소). Ollama가 연결이 끊긴 뒤 생성을 멈추는지는 확인하지 않았다 — 멈추지 않으면 GPU 시간은 쓴다.
