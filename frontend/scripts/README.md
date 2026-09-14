# 스크립트

그림을 **받고 → 자르고 → 방으로 굽는** 세 단계. 전부 `frontend/` 에서 돌린다.

| 스크립트 | 하는 일 |
|---|---|
| `art.mjs` | **레시피**. 프롬프트와 참고 그림 순서가 여기 다 있다. `art/gen/manifest.json` 을 찍고 받는 것까지 시킨다 |
| `nano-banana.mjs` | 매니페스트를 보고 Gemini 이미지 API 를 부르는 **심부름꾼**. 재시도·건너뛰기·기록 |
| `frames.py` | 캐릭터 그림에서 초록을 빼고 세트마다 **같은 상자**로 잘라 `public/character/frames` + `src/dev/room/frames.json` |
| `room-build.py` | 방 그림을 잘라 `public/rooms/<방>` + `room.json` (바닥·존·장면) |

```bash
node scripts/art.mjs                  # 무엇이 있고 무엇이 없는지
node scripts/art.mjs char             # 캐릭터 프레임 받기 (한 번만)
node scripts/art.mjs room anime       # 방 그림 받기
python3 scripts/frames.py             # 캐릭터 자르기
python3 scripts/room-build.py anime   # 방 굽기
```

키는 `frontend/.env.local` 에 `GEMINI_API_KEY=...` (gitignore 됨). 새 방을 더하는 순서는 `art/README.md`.
`sim-*.test.mjs` 는 이것과 무관한 시뮬레이션 테스트다 (`npm test`).
