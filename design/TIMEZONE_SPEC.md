# TIMEZONE_SPEC — 캐릭터의 하루는 캐릭터가 있는 곳의 시간을 따른다

오너 결정 (2026-09-03):
1. 다른 나라로 이동 중에는 **출발지 시간대**의 7블록을 그대로 따른다. 비행기·기차·배 안에서도 수면 블록이면 자고, 식사 블록이면 먹는다.
2. **도착하는 순간부터** 수면 블록을 포함한 7블록이 **도착지 시간대**로 돌아간다.
3. 도착 후 하루 정도는 캐릭터가 뭔가를 할 때 "시차 적응 중" 표시를 띄운다 (시차 3시간 이상일 때).
4. 시계는 캐릭터의 현지 시간을 크게, 오너 시간(기기 시간대, 보통 서울)을 작게 병기한다. 같은 시간대면 병기하지 않는다.
5. 돌아올 때도 똑같이 동작한다 (출발지 = 그 나라, 도착 = 집 시간대).
6. 도착하면 그 도시의 장소로 활동을 제안한다. 여행 옵션은 체류 일수를 가지고, 마지막 날엔 "집으로 돌아가기" 이동이 자동으로 잡힌다 (사용자가 더 일찍 돌아가기를 고를 수도 있다).

## 모델

### 시간대
- `CITY_TZ: Record<city, IANA>` — seoul/busan/gangneung/gyeongju/jeonju/yeosu/jeju/udo → `Asia/Seoul`, fukuoka/tokyo/osaka → `Asia/Tokyo`, taipei → `Asia/Taipei`, newyork → `America/New_York`.
- `tzOf(place)`, `ownerTz = Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `src/sim/tz.ts`: `localParts(t, tz)` (y,m,d,hour,minute,weekday via Intl.DateTimeFormat parts), `dayStartIn(t, tz)` (t − 현지 자정 이후 경과 ms; DST는 무시 가능), `dateKeyIn(t, tz)`, `hhmmIn(t, tz)`, `weekdayKoIn(t, tz)`, `offsetMinutes(tz, t)`.
- `blocks.ts`의 `blockAt / startOfDay / dateKeyOf / hhmm / weekdayKo`는 tz 인자를 받는 버전으로 바꾼다 (`blockAtIn(t, tz)` 등). tz 없는 기존 이름은 오너 tz 기준으로 남겨 호환.

### 시대(era)
- 캐릭터의 시간대는 **도착**할 때만 바뀐다. 이동 중에는 출발지 시간대.
- `tzAt(t)` = `arriveAt <= t`인 마지막 활동의 `tz`(도착지 시간대), 없으면 anchor.tz.
- `ScheduledActivity`에 `originTz`(출발 시 시간대)와 `tz`(도착지 시간대) 필드를 추가한다.

### 날짜와 계획
- 계획은 `days: Record<dayKey, Plans>`로 보관한다. `dayKey = ${dateKeyIn(t, tz)}@${tz}` (예: `2026-09-04@America/New_York`). 같은 달력 날짜라도 시간대가 다르면 다른 하루다.
- `anchor: { placeId, t, tz }` — 타임라인의 시작 상태. 최초는 집·설치일 현지 자정·집 시간대. 5일보다 오래된 day는 지우고 anchor를 그 day의 끝 상태로 옮긴다.
- 스토어의 `today` = `dayKey(now, tzAt(now))`; `plans` = `days[today]` (없으면 생성). 날짜가 넘어가면(현지 자정) 새 day가 생긴다. **더 이상 자정에 집으로 순간이동하지 않는다** — 캐릭터는 마지막 활동 장소에 남아 있고 다음 날도 거기서 시작한다.

### 타임라인 빌드 (`buildTimeline(anchor, days, memory, journeys, horizon)`)
```
cursor = { place: anchor.place, free: anchor.t, tz: anchor.tz }; t = anchor.t
loop (≤ 80 슬롯, slotStart ≤ horizon까지):
  tz = cursor.tz; dayStart = dayStartIn(t, tz); id = blockAtIn(t, tz)
  slotStart/slotEnd = 그 블록의 경계
  if id == 'sleep' or cursor.free >= slotEnd: t = slotEnd; continue     // 잠은 지금 있는 곳에서, 이미 소비된 슬롯은 건너뜀
  plan = days[dayKey(t, tz)]?.[id]; opt = 선택된 옵션; 없으면 t = slotEnd; continue
  place = opt의 장소; journey = 캐시 or estimateJourney(cursor.place, place)
  departAt = max(slotStart, cursor.free); arriveAt = departAt + journey.totalMin
  destTz = tzOf(place)
  endAt = destTz == tz
        ? max(arriveAt + 20분, blockEnd(마지막 span 블록, tz) − 25분)
        : max(arriveAt + 20분, blockEnd(arriveAt가 속한 블록, destTz) − 25분)   // 도착지 시간대의 그 블록 끝까지 그 장소에서
  comicUntil = endAt + 8분
  acts.push({ …, originTz: tz, tz: destTz, jetlagUntil: |offset(destTz) − offset(tz)| ≥ 180분 ? arriveAt + 24h : null })
  cursor = { place, free: comicUntil, tz: destTz }
  t = blockEnd(comicUntil가 속한 블록, destTz)   // 그 블록의 나머지는 대기
```
- `phaseAt(t)`:
  - 이동 중(departAt ≤ t < arriveAt): `moving` + `onboard: 'sleep' | 'meal' | null` = `blockAtIn(t, originTz)`이 sleep이면 'sleep', morning/lunch/evening이면 'meal'. (탈것 안에서 자고 먹는다)
  - 활동 중/만화: 기존과 같음. `jetlag: boolean` = 시대의 마지막 활동 `jetlagUntil > t`.
  - 그 외: `blockAtIn(t, tzAt(t)) == 'sleep'` → sleeping(at = 마지막 장소), 아니면 waiting(at, currentBlockId, nextBlockId, nextStartAt — 모두 tzAt(t) 기준). waiting에도 `jetlag`.
  - 모든 Phase에 `tz: string` 추가 (화면이 시계·블록 시간을 그릴 때 사용).
- `isBlockEditable(t, id, timeline, tz)`: 오늘(dayKey) 기준 아직 시작 안 했고, 어떤 활동의 [departAt, comicUntil)에도 덮이지 않은 블록만.
- `blocksNeedingAutoPick`: 오늘 dayKey의 블록 중 시작됐고 선택 없고 덮이지 않은 것.

### 여행 옵션과 귀환
- `ActivityOption.stayDays?: number` — 여행 옵션에 체류 일수. 국내 먼 곳(부산·강릉·경주·전주·여수·제주·우도) 1, 해외 2 (뉴욕 3). 제목에 "(1박)" "(2박)"을 붙인다. `spanBlocks`는 유지 (출발일의 남은 블록을 묶음; 자정 넘김은 타임라인이 처리).
- 집 도시가 아닌 곳에 있을 때 `travel` 범주의 첫 옵션은 항상 "집으로 돌아가기" (placeId = home, emoji 🏠, reason "슬슬 집이 그리움"). 다른 범주의 제안은 그 도시의 장소로만 (`from.city` 기준 — 이미 그렇게 동작).
- 자동 귀환: 도착 활동의 현지 날짜 + stayDays 되는 날, 그 날의 첫 편집 가능 블록(보통 morning 또는 am)이 비어 있으면 에이전트가 travel 범주 + "집으로 돌아가기"를 대신 고른다. 사용자가 미리 다른 걸 정했으면 존중한다.
- 뉴욕→서울처럼 국경을 넘는 귀환도 estimateJourney가 공항 허브로 잡는다 (JFK → 인천).

### 시계와 화면
- TopChrome: 큰 시계 = `hhmmIn(now, phase.tz)`, 그 아래 Jua 서브라인 = `요일 · 상태` 앞에 현지 도시 이름을 붙인다 (`뉴욕 · 목요일 · 활동 중`; 서울이면 도시 생략). `phase.tz !== ownerTz`이면 작은 pill로 `서울 09:12`(오너 tz의 도시명은 CITY_NAME_KO에서 오너 tz에 해당하는 첫 도시, 못 찾으면 '내 시간').
- 시간표 화면·시트: 블록 시간 범위, 링의 현재 시각 바늘, "09:00 출발" 같은 문구 모두 `phase.tz` 기준. 다른 시대의 활동(예: 비행)이 덮은 블록은 "비행 중 · 도착하면 뉴욕 시간으로" 같은 note.
- 시차 적응: active/waiting/comic 화면과 시간표 시트 상단에 작은 칩 `😴 시차 적응 중` (jetlag일 때). 만화 대본에도 jetlag 전용 twist 3개 이상.
- 이동 중 카드: onboard가 'sleep'이면 부제 "기내에서 자는 중" / "열차에서 자는 중" / "선실에서 자는 중", 'meal'이면 "기내식 먹는 중" / "도시락 먹는 중" / "배 위에서 우동" (walk/car/subway는 표시 없음). 마커의 Rider는 onboard 'sleep'이면 sleeping, 'meal'이면 작은 🍱 말풍선(SVG) — 지도 모듈 담당.

### 저장
- localStorage 키를 v3로 올린다: `theworld.days.v3` (days + anchor), `theworld.seen.v3`. 이전 키는 무시.
