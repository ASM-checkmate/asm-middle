# 캐릭터 그림

방 랩이 쓰는 건 `frames/` 뿐이다. 세트(대기·앞걷기·뒤걷기·앉기)마다 **같은 상자로 잘라야** 프레임 사이에 발 위치가 안 튄다.

| 폴더 | 무엇 | 쓰임 |
|---|---|---|
| `frames/` | 대기 3 · 앞걷기 5 · 뒤걷기 4 · 앉기 1 — 초록 배경을 뺀 투명 PNG | 방 랩 (`src/dev/room/Sprite.tsx`) |
| `poses/` | 뒷모습·눕기·앉기·걷기(옆) 낱장 | 지금은 안 씀 (눕기·앉기는 방 장면 그림으로 대체) |

## 만드는 법
```bash
node scripts/nano-banana.mjs art/gen/manifest.json   # 그림 받기
python3 scripts/frames.py                            # → frames/ + src/dev/room/frames.json
```

앞걷기는 다섯 장(왼발 닿음·밀기·스침·뻗기·오른발 닿음)이고, 뒷반쪽은 밀기·뻗기를 좌우 뒤집어 여덟 칸을 돈다.
그림은 초록 배경(#00FF00)에 **같은 프레이밍·같은 카메라 거리**로 받아야 한다 — 자세한 규칙은 `art/gen/manifest.json` 의 프롬프트.
