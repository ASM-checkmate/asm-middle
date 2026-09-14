# 그림 원본

앱이 쓰는 그림(`public/character`, `public/rooms`)은 여기 원본에서 스크립트로 잘라 낸 것이다. 원본 → 조각 순서:

```bash
node scripts/nano-banana.mjs art/gen/manifest.json   # 1) 그림 받기 (GEMINI_API_KEY 필요)
python3 scripts/frames.py                            # 2) 캐릭터 프레임 → public/character/frames
python3 scripts/room-parts.py anime                  # 3) 방 조각 → public/rooms/anime
python3 scripts/room-parts.py bedroom                #    클레이 방
```

## 폴더
- **`gen/`** — 나노바나나(Gemini 이미지 API)로 받은 그림. `manifest.json` 이 job 목록이고, 파일 하나 = job 하나. `_log.txt` 는 받은 기록.
- **`character/`** — 맨 처음 손으로 만들어 넣은 원본. 지금은 `base.png`(캐릭터 기준 참고 그림)와 `bedroom.png`(애니풍 방의 화풍 참고)만 쓴다.

## 알아 둘 것
- 방 편집본은 **모델이 그린 방**을 고쳐야 구도가 유지된다. 외부 그림(`bedroom.png`)을 직접 "침대만 빼" 로 고치면 구도를 다시 잡아 버려 차분이 안 된다 — 그래서 화풍 참고로만 주고 모델이 다시 그린 게 `anime2-room`.
- 새 방식으로 여러 장을 받을 땐 **1~2장 먼저 받아 정렬을 확인**하고 나머지를 받는다 (한 번에 9장 받았다가 통째로 버린 적 있음).
- 캐릭터 그림은 초록 배경(#00FF00), 방 그림은 13:20 세로. 자세한 규칙은 `manifest.json` 의 프롬프트 참고.
