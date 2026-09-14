# 그림

앱이 쓰는 그림(`public/character`, `public/rooms`)은 전부 여기서 받아 굽는다. 손으로 옮기는 그림은 하나도 없다.

```
art/
  in/        사용자가 준 방 사진 (화풍을 바꿀 밑그림)
  character/ 캐릭터 기준 그림 (base.png — 이 사람이 누구인지의 기준)
  gen/       나노바나나로 받은 그림 + manifest.json (scripts/art.mjs 가 찍는다) + _log.txt
  rooms.json 방 목록 — 그림 이름·바닥·존을 한 군데
```

## 사용자가 방 사진을 주면

```bash
cd frontend
# 1. 사진을 art/in/<방>.png 로 두고 art/rooms.json 에 방을 적는다 (photo·names·scenes·walk·zones·home)
node scripts/art.mjs                         # 무엇이 있고 무엇이 없는지
node scripts/art.mjs room <방> --step style   # 2. 화풍 바꾼 방 한 장만 — 마음에 들 때까지 --force 로 다시
node scripts/art.mjs room <방>                # 3. 그 방의 장면 그림 다 받기
python3 scripts/room-build.py <방>            # 4. public/rooms/<방> 로 굽기
# 5. 방 랩(`?lab=room`) 에서 "디버그" 를 켜고 walk·zones 좌표를 맞춘 뒤 4 를 다시
```

캐릭터 프레임은 방과 무관해 한 번만 받으면 모든 방이 같이 쓴다: `node scripts/art.mjs char` → `python3 scripts/frames.py`.

## 왜 이 순서인가 (여기까지 오며 깨진 것들)

- **사진을 직접 고치면 안 된다.** 바깥에서 받은 사진에 "침대만 빼" 같은 주문을 하면 모델이 구도를 다시 잡아 버려 전혀 다른 방이 나온다.
  그래서 먼저 화풍만 바꿔 **모델이 그린 방**을 만들고, 그 방을 고친다. (이걸 모르고 9장을 한 번에 받았다가 통째로 버렸다)
- **바꿀 곳을 좁힐수록 나머지가 안 흔들린다.** 참고 그림은 늘 **가장 가까운 좋은 장**을 준다 —
  이불 당기는 칸은 방이 아니라 '이불 덮고 눈 뜬 칸'에서 손과 이불 높이만 바꾼다. 방을 참고로 주면 얼굴까지 다시 그린다.
- **사람이 나오는 칸엔 `char-front` 를 같이 준다.** 눈 모양·눈동자 자리·하이라이트까지 짚어 줘야 같은 사람으로 남는다.
- **"침대 위에 머물 것"** 을 늘 조건으로 붙인다. 안 그러면 다리가 침대 밖으로 나오고 이불이 바닥까지 흐른다.
- 새 방식으로 여러 장을 받을 땐 **한두 장 먼저 받아 보고** 나머지를 받는다.

프롬프트와 참고 그림 순서는 전부 `scripts/art.mjs` 안에 있다 — 고칠 일이 있으면 거기만 고치면 된다.
