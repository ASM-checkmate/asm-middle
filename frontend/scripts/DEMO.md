# 데모 영상 만들기 (부산 시나리오)

```
cd frontend
npm run dev                      # vite 5173이 떠 있어야 한다 (백엔드는 없어도 된다 — 로그인 화면이 뜨면 스크립트가 "오프라인으로 시작"을 누른다)
node scripts/record.mjs /tmp/rec scripts/demo-busan.json
cp /tmp/rec/demo.mp4 ../design/out/nadeuli-demo-busan-$(date +%F)-1-v2.mp4   # design/out/ 은 gitignore. 같은 날 다시 뽑으면 덮어쓰지 말고 -v2, -v3… (오너)
```

- 4~5분 걸린다. 결과: `/tmp/rec/demo.mp4`(1520×1826, 소리 포함), `video.mp4`(무음), `frames/`, `tts/`(문장별 aiff), `voices.json`(섞은 시각).
- **대본은 `scripts/demo-busan.json`** — 자막·대사·순서는 여기만 고친다. 스텝: `goto`(keepHold) · `intro`/`introOff` · `say [나레이터, 모모]`(빈 문자열이면 그쪽 없음)
  · `click`(마우스 좌표 — 방 존·📷 칩·셔터) · `tapClick`(el.click — 크롬 버튼·탭·닫기) · `eval` · `jump "HH:MM"`(건너뛰는 활동은 먼저 정산한다) · `scale n`(배속, 이동은 200)
  · `waitUntil{expr,max}` · `hold{expr,max}`(준비될 때까지 프레임을 버린다 — 로딩 안 보이게) · `dropPhoto{url,cell}`(생성 사진 액자 드롭 + 필름 칸 교체) · `wait` · `mark`
  · `waitVoice: true`(앞 `say`의 목소리가 끝날 때까지 — `say`는 기다리지 않으니 말 끝나고 화면을 바꿀 `eval`·`tapClick` 앞에 둔다).
- **광고/비광고 구분**(2026-09-16): 가게 방문 자체가 광고 지면이다. 시나리오의 조새호·삼진포차는 `sponsored: true`(`dev/scenario.ts`) → **활동 화면 장소 태그에만** `AD`
  알약(`ui/AdTag`, 지도의 동백택시 카드와 같은 것). 시간표 카드에는 안 단다(오너: 고르는 자리에서 광고광고 하지 않기). 저녁·밤 블록은 **카드 3장**(`alts`)이고 광고 카드는 가운데 — 모모는 뷰·자리가 좋아서 고르고, 광고라는 말은 안 한다
  (오너: "광고 중에서 고른다"로 들리면 안 됨, 광고광고 하지 말 것). 광고를 짚는 건 나레이션 한 줄뿐. 부산대 수업은 민수 일정(광고 아님), 귀가 택시는 제휴(광고).
  **일정 바꾸는 장면**(오너 2026-09-16): 부산대 수업 중(`jump 16:20` — 18시 지하철에선 저녁 블록이 시작돼 편집 불가)에 시간표를 열어 **사용자가 저녁 카드를 실제로 바꾼다**.
  앞 상태는 대본의 `eval chooseOption('evening','busan-evening-alt0','agent')`(해운대시장을 모모 선택으로) → `.opt` 조새호 탭 → `.tt-cta` "이걸로 정할래" → "정해졌어요 · 18:00 출발". 밤 블록은 모모 선택 그대로 보여 주기만.
  시나리오(`dev/scenario.ts`)는 안 건드린다. 사용자가 고르면 `review()`가 반대(돈·피로·기분·편도 60분 초과)를 낼 수 있으니 `.tt-verdict`가 뜨면 원인부터 본다.
  이동은 x300(지하철 → 조새호 8~9초). **1편 나레이션은 첫 줄("나들이는 …") 하나뿐** — 1편은 에이전트의 하루를 보여 주는 게 전부(오너). 2편 나레이션은 그대로.
- **말 튼 친구도 사진에**: 카메라(`CameraOverlay`)가 `castAt`의 met·metAlso(루이·클로에)를 뒷줄 양끝에 세운다 — 드론쇼 컷은 넷(`UserShot.mets`에 id 저장).
- 목소리는 macOS `say`. 이 맥에서 한국어를 읽는 건 **Yuna뿐**(다른 한국어 목소리는 무음) — 나레이터 165, 모모 205 속도. `VOICE_N`/`VOICE_C`로 바꾼다.
  **당분간(2026-09-16~) 녹화는 Yuna로만 한다** — 일레븐랩스 파일은 **최종본에만** 쓴다(오너). 즉 `MOMO_TTS_DIR`/`NARR_TTS_DIR` 없이 돌린다.
  **목소리를 일레븐랩스로(최종본만)**: `ELEVENLABS_API_KEY=$(cat ~/.config/elevenlabs.key)`(키는 레포 밖 파일). 목록 `node scripts/demo-voice.mjs --list`.
  모모 `node scripts/demo-voice.mjs 모모 ../design/voice/momo`, 나레이터 `node scripts/demo-voice.mjs Seonguk ../design/voice/narr --who n` — 대사 순서대로 01.mp3…(있는 번호는 건너뜀, 다시 만들려면 지운다).
  녹화는 `MOMO_TTS_DIR=../design/voice/momo NARR_TTS_DIR=../design/voice/narr node scripts/record.mjs …`. 없는 번호는 Yuna로 채운다. `design/voice/`는 gitignore.
  **대사가 바뀌면 번호가 밀린다** — 2026-09-16 대본 개편(부산대 일정 장면·1편 나레이션 삭제)으로 모모·나레이터 번호가 전부 바뀌었으니, 최종본 때 `design/voice/momo`·`narr`를 지우고 새로 만든다.
- **영상 둘로**(오너 2026-09-16): 대본의 `{"cut": true}`가 분할점(조새호 장소 지도 닫은 뒤). `PART=1 …`은 그 앞까지, `PART=2 …`는 goto + 그 뒤(포차→잠).
  결과는 `design/out/nadeuli-demo-busan-<날짜>-1.mp4`·`-2.mp4`. 대사 번호는 전체 대본 기준이라 PART를 나눠도 같은 파일을 쓴다.
- 시나리오 URL에 `&day=2026-09-15`가 붙어 있다 — 마찰 굴림이 날짜에 묶여 있어 날짜가 바뀌면 밤 활동이 다른 곳으로 샌다. 그대로 둔다.
- 생성 사진은 `public/demo/josaeho.png`·`pocha.png`(오너가 Gemini로 만든 것). 다른 장면 사진이 생기면 같은 이름 규칙으로 두고 `dropPhoto`를 더한다.
  **연출**(`__demoDrop`, 오너 2026-09-16): 폰이 아니라 **영상 화면(뷰포트 760×913)** 기준 — 액자의 왼쪽 아래 모서리를 (가로 1/3, 아래에서 1/3) 지점에 두고 오른쪽·위는 24px만 남기고 키운다(모모 말풍선을 덮는 게 맞다).
  위에서 떨어져 ≈2.9초 서 있다가(원래보다 1초 길게) 필름 첫 칸으로 작아져 들어간다. 1·2편 공통.
  📷 칩(`.room-shoot`)은 방 이벤트(결제·리필)로 캐릭터가 잠깐 걸어가면 사라지므로 누르기 직전에 `waitUntil`로 다시 기다린다.
- 확인: `ffmpeg -ss <초> -i demo.mp4 -frames:v 1 f.png`로 프레임을 뽑아 본다. 스텝 로그의 `[vt …s]`가 영상 시각이다.
- 도구 뼈대: `scripts/record.mjs`(CDP 스크린캐스트 760×1000@2x, 폰 베젤·자막 패널 주입, 벽시계 기준 싱크, hold 중 프레임 버림).
