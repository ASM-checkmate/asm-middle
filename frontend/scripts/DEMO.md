# 데모 영상 만들기 (부산 시나리오)

```
cd frontend
npm run dev                      # vite 5173이 떠 있어야 한다 (백엔드는 없어도 된다 — 로그인 화면이 뜨면 스크립트가 "오프라인으로 시작"을 누른다)
node scripts/record.mjs /tmp/rec scripts/demo-busan.json
cp /tmp/rec/demo.mp4 ../design/out/nadeuli-demo-busan-$(date +%F).mp4     # design/out/ 은 gitignore
```

- 4~5분 걸린다. 결과: `/tmp/rec/demo.mp4`(1520×1826, 소리 포함), `video.mp4`(무음), `frames/`, `tts/`(문장별 aiff), `voices.json`(섞은 시각).
- **대본은 `scripts/demo-busan.json`** — 자막·대사·순서는 여기만 고친다. 스텝: `goto`(keepHold) · `intro`/`introOff` · `say [나레이터, 모모]`(빈 문자열이면 그쪽 없음)
  · `click`(마우스 좌표 — 방 존·📷 칩·셔터) · `tapClick`(el.click — 크롬 버튼·탭·닫기) · `eval` · `jump "HH:MM"`(건너뛰는 활동은 먼저 정산한다) · `scale n`(배속, 이동은 200)
  · `waitUntil{expr,max}` · `hold{expr,max}`(준비될 때까지 프레임을 버린다 — 로딩 안 보이게) · `dropPhoto{url,cell}`(생성 사진 액자 드롭 + 필름 칸 교체) · `wait` · `mark`
  · `waitVoice: true`(앞 `say`의 목소리가 끝날 때까지 — `say`는 기다리지 않으니 말 끝나고 화면을 바꿀 `eval`·`tapClick` 앞에 둔다).
- **광고/비광고 구분**(2026-09-16): 가게 방문 자체가 광고 지면이다. 시나리오의 조새호·삼진포차는 `sponsored: true`(`dev/scenario.ts`) → 시간표 카드·활동 장소 태그에 `AD`
  알약(`ui/AdTag`, 지도의 동백택시 카드와 같은 것). 저녁·밤 블록은 **카드 3장**(`alts`)이고 광고 카드는 가운데 — 모모는 뷰·자리가 좋아서 고르고, 광고라는 말은 안 한다
  (오너: "광고 중에서 고른다"로 들리면 안 됨, 광고광고 하지 말 것). 광고를 짚는 건 나레이션 한 줄뿐. 부산대 수업은 민수 일정(광고 아님), 귀가 택시는 제휴(광고).
  대본은 지하철에서 `.chrome-tt`로 시간표를 열어 `selectBlock('evening'|'night')`로 카드를 보여 준다. 블록은 `chosenBy: 'agent'`(캐릭터가 골랐어요).
- **말 튼 친구도 사진에**: 카메라(`CameraOverlay`)가 `castAt`의 met·metAlso(루이·클로에)를 뒷줄 양끝에 세운다 — 드론쇼 컷은 넷(`UserShot.mets`에 id 저장).
- 목소리는 macOS `say`. 이 맥에서 한국어를 읽는 건 **Yuna뿐**(다른 한국어 목소리는 무음) — 나레이터 165, 모모 205 속도. `VOICE_N`/`VOICE_C`로 바꾼다.
  다른 TTS를 쓰려면 `tts/` 의 aiff를 같은 이름으로 갈아 끼우고 `voices.json` 시각으로 다시 섞는다.
- 시나리오 URL에 `&day=2026-09-15`가 붙어 있다 — 마찰 굴림이 날짜에 묶여 있어 날짜가 바뀌면 밤 활동이 다른 곳으로 샌다. 그대로 둔다.
- 생성 사진은 `public/demo/josaeho.png`·`pocha.png`(오너가 Gemini로 만든 것). 다른 장면 사진이 생기면 같은 이름 규칙으로 두고 `dropPhoto`를 더한다.
- 확인: `ffmpeg -ss <초> -i demo.mp4 -frames:v 1 f.png`로 프레임을 뽑아 본다. 스텝 로그의 `[vt …s]`가 영상 시각이다.
- 도구 뼈대: `scripts/record.mjs`(CDP 스크린캐스트 760×1000@2x, 폰 베젤·자막 패널 주입, 벽시계 기준 싱크, hold 중 프레임 버림).
