# 데모 영상 만들기 (부산 시나리오)

## v3 (2026-09-17, 오너): 대본 둘 — 1편 광안리(노는 것) · 2편 공시생(기능)

```
cd frontend
npm run dev                      # vite 5173이 떠 있어야 한다 (백엔드는 없어도 된다 — 로그인 화면이 뜨면 스크립트가 "오프라인으로 시작"을 누른다)
node scripts/record.mjs /tmp/rec1 scripts/demo-gwangalli.json   # 1편 — ?scenario=gwangalli
node scripts/record.mjs /tmp/rec2 scripts/demo-gongsi.json      # 2편 — ?scenario=gongsi
cp /tmp/rec1/demo.mp4 ../design/out/nadeuli-demo-busan-$(date +%F)-1-v3.mp4   # design/out/ 은 gitignore. 같은 날 다시 뽑으면 덮어쓰지 말고 -v2, -v3… (오너)
cp /tmp/rec2/demo.mp4 ../design/out/nadeuli-demo-busan-$(date +%F)-2-v3.mp4
```

- **1편 `demo-gwangalli.json`** (에이전트가 잘 노는 것): 첫 화면(모모 손 흔드는 인트로, 말풍선 없이)에서 **나레이션 "나들이는 …"을 화면 중앙 아래 자막으로**(`introShow` 스텝 — 인트로 위에선 `__demoSay`가 옆 패널 대신 인트로 아래 칸에 쓴다, 오너 2026-09-17) → 말풍선 "안녕 나는 모모야" → 부산대(민수) → 지하철 → **삼진포차**(18:37 도착, 저녁·밤 둘 다 포차라 20:00엔 이동 없이 활동만 바뀐다)
  → **"위하여~ 🍻" + 테이블 사진(`pocha-asahi.png`)** → 20:55 드론쇼 → 민수랑 둘이 사진 → "다음에 또 오자"로 끝. **조새호·해변·시간표·친구 마주침·귀가·SNS 없음**(오너 2026-09-17: 학교에서 바로 포차로, 광안리에서 놀고 끝).
  술 광고는 포차 방의 아사히 소품과 **생성 사진**(`public/demo/pocha-asahi.png`)으로만 — 모모는 브랜드를 말하지 않는다. 카메라 배경(`samjin-table.webp`)은 원본(소주병) 그대로.
  생성 사진은 `scripts/shot-gen.mjs`(서버 프롬프트를 옮긴 오프라인 판)로: 배경 원본 + `char-png.mjs`로 뽑은 모모·민수 PNG + 실제 아사히 캔 사진(`art/backdrops/in/`, 위키미디어)을 참고로. 우리가 그린 캔 그림은 참고로 주지 않는다(결과가 그걸 따라간다 — 오너).
- **2편 `demo-gongsi.json`** (기능 소개, 공시생의 하루): **인트로 없이 바로**(오너) 9:40 스타벅스 부산대점(에듀윌 교재·노트북, AD 태그 나레이션) → **시간표**(밤 카드를 집→코인노래방으로 사용자가 바꾼다)
  → 사진(창가 자리 AI 배경 `starbucks-window.webp` + 생성 컷 `public/demo/starbucks.png` 드롭) → 10:40 현이와 친구 → 장소 지도 → 20:01 걸어서 코인노래방(코인 존 → 마이크 존 → '열창 인증샷' 생성 컷 `public/demo/noraebang.png` 드롭, AI 배경 `noraebang-mic.webp`) → 걸어서 귀가(택시 아님 — 걷는 거리면 제휴 택시를 안 부른다, 나레이션 없음) → 잠 화면 → SNS 친구 탭 → 잠. AD 태그 나레이션은 뺐다(오너).
  시나리오 블록: am·lunch·pm 셋 다 스타벅스(같은 곳이라 이동 없음), evening 집, night 코노. 현이는 강제 마주침(10:00–12:00, 10:20 말 틈).
  **귀가 함정**: 코노→집이 걸어서 5분이라 23:48에 닿는다 — 자정 전 도착은 집 방 눕는 장면(HomeNightScreen, `since > until-7h` 조건)이 없고 잔디 대기 화면이 뜬다.
  그래서 귀갓길은 `scale 45`로 짧게 보여 주고 지도가 사라지면(`!document.querySelector('.map-scene')`) 바로 `jump "+1 0:40"`(다음 날)으로 잠 화면에서 대사·SNS를 한다. (v2 1편처럼 택시가 28분이면 00:11 도착이라 집 방 장면이 있다.)
- 두 대본은 `cut`/`PART` 없이 각각 통째로 한 편이다. 일레븐랩스 번호도 대본별로 따로(`design/voice/v3-1/{momo,narr}`·`v3-2/…`처럼 폴더를 나눈다 — `demo-voice.mjs`의 마지막 인자에 대본 파일).
- 아래는 v2 대본(`demo-busan.json`, 조새호 포함) 절차 — 그대로 남긴다.

```
node scripts/record.mjs /tmp/rec scripts/demo-busan.json
cp /tmp/rec/demo.mp4 ../design/out/nadeuli-demo-busan-$(date +%F)-1-v2.mp4
```

- 4~5분 걸린다. 결과: `/tmp/rec/demo.mp4`(1520×1826, 소리 포함), `video.mp4`(무음), `frames/`, `tts/`(문장별 aiff), `voices.json`(섞은 시각).
- **대본은 `scripts/demo-busan.json`** — 자막·대사·순서는 여기만 고친다. 스텝: `goto`(keepHold) · `intro`/`introOff` · `say [나레이터, 모모]`(빈 문자열이면 그쪽 없음)
  · `click`(마우스 좌표 — 방 존·📷 칩·셔터) · `tapClick`(el.click — 크롬 버튼·탭·닫기) · `eval` · `jump "HH:MM"`(건너뛰는 활동은 먼저 정산한다) · `scale n`(배속, 이동은 200)
  · `waitUntil{expr,max}` · `hold{expr,max}`(준비될 때까지 프레임을 버린다 — 로딩 안 보이게) · `dropPhoto{url,cell}`(생성 사진 액자 드롭 + 필름 칸 교체) · `wait` · `mark`
  · `waitVoice: true`(앞 `say`의 목소리가 끝날 때까지 — `say`는 기다리지 않으니 말 끝나고 화면을 바꿀 `eval`·`tapClick` 앞에 둔다).
- **광고/비광고 구분**(2026-09-16): 가게 방문 자체가 광고 지면이다. 시나리오의 조새호·삼진포차는 `sponsored: true`(`dev/scenario.ts`) → **활동 화면 장소 태그에만** `AD`
  알약(`ui/AdTag`, 지도의 동백택시 카드와 같은 것). 시간표 카드에는 안 단다(오너: 고르는 자리에서 광고광고 하지 않기). 저녁·밤 블록은 **카드 3장**(`alts`)이고 광고 카드는 가운데 — 모모는 뷰·자리가 좋아서 고르고, 광고라는 말은 안 한다
  (오너: "광고 중에서 고른다"로 들리면 안 됨, 광고광고 하지 말 것). 광고를 짚는 건 나레이션 한 줄뿐. 부산대 수업은 민수 일정(광고 아님), 귀가 택시는 제휴(광고).
  **일정 장면 나누기**(오너 2026-09-17): 1편 부산대에선 **저녁 카드만** 바꾸고(밤 블록은 안 보여 준다), **밤(삼진포차) 계획은 2편** 조새호(19:33)에서 시간표를 꺼내 모모 선택 카드로 보여 준다 — 나레이션 "일정은 캐릭터의 취향으로 짜여집니다."(광고 문장 대신). 2편이 기능 설명 편.
  **일정 바꾸는 장면**(오너 2026-09-16): 부산대 수업 중(`jump 16:20` — 18시 지하철에선 저녁 블록이 시작돼 편집 불가)에 시간표를 열어 **사용자가 저녁 카드를 실제로 바꾼다**.
  앞 상태는 대본의 `eval chooseOption('evening','busan-evening-alt0','agent')`(해운대시장을 모모 선택으로) → `.opt` 조새호 탭 → `.tt-cta` "이걸로 정할래" → "정해졌어요 · 18:00 출발". 밤 블록은 모모 선택 그대로 보여 주기만.
  시나리오(`dev/scenario.ts`)는 안 건드린다. 사용자가 고르면 `review()`가 반대(돈·피로·기분·편도 60분 초과)를 낼 수 있으니 `.tt-verdict`가 뜨면 원인부터 본다.
  지하철은 설명이 없으니 짧게: `jump 18:10` → 모모 "광안리로 슝~" → x400(6초쯤). 1편 조새호에서도 **생성 사진(dropPhoto)을 크게 보여 준다**(오너 2026-09-17, 한 번 뺐다가 되돌림). **장소 지도 장면은 1편엔 없다**(사진 닫고 말풍선 지우며 끝) — 2편 포차에서만. 드론쇼 단체 사진은 생성 이미지가 없어 dropPhoto 없음. `cut`은 이제 조새호 카메라 닫은 뒤. **1편 나레이션은 첫 줄("나들이는 …") 하나뿐** — 1편은 에이전트의 하루를 보여 주는 게 전부(오너). 1편에서 뺀 기능 설명(광고 카드·사진·장소 지도·이동)은 **2편에 몰았다**: 포차 도착(AD 알약 보이는 화면)·테이블 사진·포차 장소 지도(새 장면)·귀가 택시(이동 → 제휴 광고 두 줄, x150).
- **말 튼 친구도 사진에**: 카메라(`CameraOverlay`)가 `castAt`의 met·metAlso(루이·클로에)를 뒷줄 양끝에 세운다 — 드론쇼 컷은 넷(`UserShot.mets`에 id 저장).
  **단, 말 트는 시각(21:05)이 지나야** 선다(`castAt`: talked && t ≥ at) — 대본은 드론쇼를 20:55에 들어가 단체 사진 전에 `waitUntil`로 21:05를 기다린다(21:01에 찍으면 둘만 나온다).
- 목소리는 macOS `say`. 이 맥에서 한국어를 읽는 건 **Yuna뿐**(다른 한국어 목소리는 무음) — 나레이터 165, 모모 205 속도. `VOICE_N`/`VOICE_C`로 바꾼다.
  **2026-09-17부터 최종본은 일레븐랩스**(오너) — 대본을 고치는 동안은 Yuna(환경변수 없이), 최종 녹화는 아래 두 폴더를 새로 만들어 `MOMO_TTS_DIR`/`NARR_TTS_DIR`로 돌린다.
  **목소리를 일레븐랩스로**: `ELEVENLABS_API_KEY=$(cat ~/.config/elevenlabs.key)`(키는 레포 밖 파일). 목록 `node scripts/demo-voice.mjs --list`.
  모모 `node scripts/demo-voice.mjs 모모 ../design/voice/momo`, 나레이터 `node scripts/demo-voice.mjs 나들이나래이터 ../design/voice/narr --who n`(오너가 만든 계정 목소리, xusxi6twcXZi5EZnda2k) — 대사 순서대로 01.mp3…(있는 번호는 건너뜀, 다시 만들려면 지운다).
  녹화는 `MOMO_TTS_DIR=../design/voice/momo NARR_TTS_DIR=../design/voice/narr PART=1 node scripts/record.mjs …`(PART=2도). 없는 번호는 Yuna로 채우고 로그에 `없음`이 찍힌다 — 최종본에선 그 줄이 없어야 한다. `design/voice/`는 gitignore, 옛 번호 파일은 `design/voice/old-<날짜>/`로 치운다.
  **대사가 바뀌면 번호가 밀린다** — 2026-09-16 대본 개편(부산대 일정 장면·1편 나레이션 삭제)으로 모모·나레이터 번호가 전부 바뀌었으니, 최종본 때 `design/voice/momo`·`narr`를 지우고 새로 만든다.
- **영상 둘로**(오너 2026-09-16): 대본의 `{"cut": true}`가 분할점(조새호 장소 지도 닫은 뒤). `PART=1 …`은 그 앞까지, `PART=2 …`는 goto + 그 뒤(**조새호 식사 끝→걸어서 포차**→잠, 오너 2026-09-16 저녁).
  결과는 `design/out/nadeuli-demo-busan-<날짜>-1.mp4`·`-2.mp4`.
  **걷기 장면 요령**: 짧은 이동(2~3분)은 `jump`로 이동 **도중**(20:01)에 들어간다 — jump의 hold가 지도·타일까지 기다려 로딩·빈 화면이 안 보인다(출발 시각에 맞추면 문으로 나가는 동안 빈 화면이 잡힌다).
  jump의 hold 동안에도 시계가 달리므로 **건너뛰기 전에 `scale 5`로 늦추고** 건너뛴 뒤 `scale 15`(스텝 안 순서는 jump → scale). 도착 뒤 `scale 30`으로 되돌린다. 대사 번호는 전체 대본 기준이라 PART를 나눠도 같은 파일을 쓴다.
- 시나리오 URL에 `&day=2026-09-15`가 붙어 있다 — 마찰 굴림이 날짜에 묶여 있어 날짜가 바뀌면 밤 활동이 다른 곳으로 샌다. 그대로 둔다.
- 생성 사진은 `public/demo/josaeho.png`·`pocha.png`(오너가 Gemini로 만든 것). 다른 장면 사진이 생기면 같은 이름 규칙으로 두고 `dropPhoto`를 더한다.
  **연출**(`__demoDrop`, 오너 2026-09-16): 폰이 아니라 **영상 화면(뷰포트 760×913)** 기준 — 액자의 왼쪽 아래 모서리를 (가로 1/3, 아래에서 1/3) 지점에 두고 오른쪽·위는 24px만 남기고 키운다(모모 말풍선을 덮는 게 맞다).
  위에서 떨어져 ≈3.3초 서 있다가 필름 첫 칸으로 0.3초 만에 작아져 들어간다(총 5.8초 — 오너: 더 오래 보여 주고 빨리 들어가기). 1·2편 공통.
  📷 칩(`.room-shoot`)은 방 이벤트(결제·리필)로 캐릭터가 잠깐 걸어가면 사라지므로 누르기 직전에 `waitUntil`로 다시 기다린다.
- 확인: `ffmpeg -ss <초> -i demo.mp4 -frames:v 1 f.png`로 프레임을 뽑아 본다. 스텝 로그의 `[vt …s]`가 영상 시각이다.
- 자막 패널의 모모 얼굴(`.dc-face svg`)은 50px — 84px로 두면 원 밖으로 넘쳐 머리 위만 보인다.
- **인트로**(오너 2026-09-17): 얼굴만이 아니라 몸 전체가 손을 흔든다 — `App.tsx`의 dev 훅 `window.__demoCharacter(el, 'wave', 340)`이 React로 그린다(DOM 복제는 그 시각 포즈·책을 끌고 와 실패). 말풍선은 오른쪽.
- 도구 뼈대: `scripts/record.mjs`(CDP 스크린캐스트 760×1000@2x, 폰 베젤·자막 패널 주입, 벽시계 기준 싱크, hold 중 프레임 버림).
- **AI 배경·생성 컷 만들기(2026-09-17 저녁)**: 배경은 `art/backdrops/manifest.json`에 job(참고 사진 없으면 글로만) → `node scripts/nano-banana.mjs art/backdrops/manifest.json --only <name>` → `cwebp -q 82 -resize 720 0` → `public/backdrops/busan/` + 두 manifest(`public/backdrops/manifest.json`·`src/sim/backdrops.demo.json`)에 자리·존 등록.
  생성 컷은 `node scripts/shot-gen.mjs --bg <배경> --me <모모.png> [--friend <동행.png>] --place … --spot … [--sit] --me-pos x,y,scale --me-pose … [--ref <참고>] --extra "…" --out art/backdrops/gen/shot-<name>.png` — 한 장씩 뽑아 오너가 검토한다.
  **한글 글자가 들어가는 컷(에듀윌 표지)은 `--model gemini-3-pro-image`** — flash는 한글을 뭉갠다; 글자는 깨끗이 찍은 제목 이미지(`art/backdrops/in/eduwill-title.png`)를 `--ref`로 준다. 캐릭터 PNG: `node scripts/char-png.mjs <out> idle friend '#5FC9A6' short`(민수).
