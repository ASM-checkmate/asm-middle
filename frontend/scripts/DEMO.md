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
  · `waitUntil{expr,max}` · `hold{expr,max}`(준비될 때까지 프레임을 버린다 — 로딩 안 보이게) · `dropPhoto{url,cell}`(생성 사진 액자 드롭 + 필름 칸 교체) · `wait` · `mark`.
- 목소리는 macOS `say`. 이 맥에서 한국어를 읽는 건 **Yuna뿐**(다른 한국어 목소리는 무음) — 나레이터 165, 모모 205 속도. `VOICE_N`/`VOICE_C`로 바꾼다.
  다른 TTS를 쓰려면 `tts/` 의 aiff를 같은 이름으로 갈아 끼우고 `voices.json` 시각으로 다시 섞는다.
- 시나리오 URL에 `&day=2026-09-15`가 붙어 있다 — 마찰 굴림이 날짜에 묶여 있어 날짜가 바뀌면 밤 활동이 다른 곳으로 샌다. 그대로 둔다.
- 생성 사진은 `public/demo/josaeho.png`·`pocha.png`(오너가 Gemini로 만든 것). 다른 장면 사진이 생기면 같은 이름 규칙으로 두고 `dropPhoto`를 더한다.
- 확인: `ffmpeg -ss <초> -i demo.mp4 -frames:v 1 f.png`로 프레임을 뽑아 본다. 스텝 로그의 `[vt …s]`가 영상 시각이다.
- 도구 뼈대: `scripts/record.mjs`(CDP 스크린캐스트 760×1000@2x, 폰 베젤·자막 패널 주입, 벽시계 기준 싱크, hold 중 프레임 버림).
