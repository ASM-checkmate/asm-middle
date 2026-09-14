# PNG 레이어 방 (나노바나나)

`bedroom/room.json` — 방 랩(`?lab=room`)이 읽는다: `back`(가구 없는 방) 위에 `props`(base = 바닥 접점 y, 앞뒤 순서)와 인물(발 y 또는 spot 의 z)을 섞어 쌓는다.
만드는 법: `art/gen/` 의 room·room-empty·room-no-* 편집본을 받아 두고 `python3 scripts/room-parts.py`. 침대·협탁·서랍장(+거울)·문·커튼은 "그것만 뺀 편집본"과의 차분, 이불은 침대 조각 안의 분홍색(편집본이 침대를 통째로 다시 그려서).
자리(spot): door·center·bedside·dresser(서서), bed-edge(걸터앉기, z = 틀+1), bed(눕기, z = 틀+2 < 이불 +4 → 이불 아래).
러그는 빈 방과 색 차이가 작아 아직 못 뗐다 (뒤 그림에 없음).
