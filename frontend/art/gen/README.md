# 나노바나나로 받은 그림

`manifest.json` 의 job 하나 = 그림 한 장 (`<name>.png`). 받는 법:

```bash
cd frontend && node scripts/nano-banana.mjs art/gen/manifest.json
```

- 키는 `frontend/.env.local` 에 `GEMINI_API_KEY=...` (gitignore 됨) 또는 환경변수.
- 있는 파일은 건너뛴다. 다시 받으려면 `--force`, 몇 개만 받으려면 `--only room,room-empty`, 계획만 보려면 `--dry`.
- `refs` 가 다른 job 이름이면 그 출력을 참고 그림으로 같이 보낸다 → base 를 먼저 받고 옷·자세·방이 그걸 참고한다. 순서는 매니페스트 순.
- 실패한 job 은 `_log.txt` 에 이유가 남는다 (거절·429 등). 마음에 안 드는 장은 지우고 다시 돌리면 그것만 다시 받는다.

## 목록 (20장)
- 캐릭터 (옷 한 세트: 크림 브이넥·회색 와이드·샌들, 가방 없음): `char-front` 전신 → `char-parts` 컷아웃 퍼펫 시트(머리·몸통·팔 2·다리 2를 떼어 놓은 한 장, 관절 끝 둥글게) · `part-*` 부위별 낱장 6(시트가 엉키면 대신) · 큰 자세 `pose-back`·`pose-lie`(3:2)·`pose-sit`·`pose-walk`
- 방 (캐릭터 화풍): `room` → `room-empty`·`room-no-bed`·`room-no-blanket`·`room-no-nightstands`·`room-no-dresser`·`room-door-closed`·`room-night` — 같은 카메라의 편집본이라 차분으로 소품을 정확히 잘라낼 수 있다

사람은 파이썬으로 통짜를 자르지 않는다 — 조각은 모델이 그린 걸 초록 배경에서 섬 단위로 떼어 쓰고, 관절 축만 손으로 찍는다.
`art/character/base.png` 는 "이 캐릭터" 기준 참고 그림.
