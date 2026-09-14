# 방 하나를 그림 한 장 + 걸을 수 있는 바닥 + 트리거존으로 만든다 → public/rooms/<방>/{back.jpg, scenes/*.jpg, room.json}
#
# 예전에는 소품을 낱개로 떼어 내 바닥 접점으로 앞뒤를 정했다 (침대 뒤로 걸어가면 가려지게). 그런데 그러면 침대 쪽으로 가다가
# 사람이 가구 뒤로 사라진다. 어차피 가구 뒤를 걸어 다닐 일이 없으니, 가구는 배경에 그대로 두고 **걸을 수 있는 바닥(walk)**만
# 정해 그 밖으로는 못 나가게 한다. 그러면 사람은 늘 배경 위에 그려지고 가려질 일이 없다.
#
# 제자리 동작은 '물건 + 사람'을 그린 방 전체 그림이라, 조각낼 것 없이 **배경을 통째로 갈아 끼우면** 된다.
# 그래서 -empty·-no-bed·-no-dresser 같은 편집본도 이제 필요 없다 (소품을 안 떼니까).
#
# Usage: python3 scripts/room-build.py [anime|bedroom]
import hashlib, json, os, sys
from PIL import Image

W, H = 390, 600
S = 2   # 저장 해상도 배수

ROOMS = {
  # 애니메이션풍 침실 (anime2-room). walk 는 침대·서랍장 앞의 빈 바닥, zone 은 그 앞에 서면 동작이 걸리는 칸
  'anime': {
    'room': 'anime2-room', 'scene': 'anime2-scene',
    'walk': [(62, 400), (300, 400), (390, 570), (390, 600), (0, 600), (0, 490)],
    'bed': 'anime2',
    'zones': [
      { 'id': 'bed',    'ko': '침대',   'scene': 'sleep',  'rect': [100, 398, 290, 444], 'stand': [195, 430] },
      { 'id': 'makeup', 'ko': '화장대', 'scene': 'makeup', 'rect': [300, 400, 390, 474], 'stand': [332, 446] },
    ],
    'home': [60, 556],
  },
  # 클레이 침실 (room)
  'bedroom': {
    'room': 'room', 'scene': 'scene',
    'walk': [(60, 400), (315, 400), (390, 540), (390, 600), (0, 600), (0, 520)],
    'bed': '',
    'zones': [
      { 'id': 'bed',    'ko': '침대',   'scene': 'sleep',  'rect': [110, 398, 290, 444], 'stand': [195, 428] },
      { 'id': 'makeup', 'ko': '화장대', 'scene': 'makeup', 'rect': [308, 400, 390, 464], 'stand': [338, 436] },
    ],
    'home': [70, 556],
  },
}
# 장면 = 방 전체 그림 몇 장 (그 물건 + 사람이 함께 그려져 있다).
#   enter  들어가는 길 — 서 있다가 바로 누우면 어색하니 걸터앉기 → 이불 위에 눕기를 거친다. 나올 땐 거꾸로 되짚는다.
#   frames 그 자리에서 도는 칸 (숨쉬기·화장 동작)
SCENES = {
  'sleep':  { 'ko': '자기', 'enter': ['{bed}-sit', '{bed}-lie'], 'enterMs': 520,
              'frames': ['{room}-sleeping', '{scene}-sleep-2'], 'interval': 1400 },
  'makeup': { 'ko': '화장', 'frames': ['{scene}-makeup-1', '{scene}-makeup-2', '{scene}-makeup-3'], 'interval': 800 },
}

RID = sys.argv[1] if len(sys.argv) > 1 else 'anime'
CFG = ROOMS[RID]
GEN, OUT = 'art/gen', f'public/rooms/{RID}'
os.makedirs(f'{OUT}/scenes', exist_ok=True)

def src(name):
    return next(f'{GEN}/{name}.{e}' for e in ('jpg', 'png') if os.path.exists(f'{GEN}/{name}.{e}'))
def have(name):
    return any(os.path.exists(f'{GEN}/{name}.{e}') for e in ('jpg', 'png'))

def save(name, out):
    """그림을 방 비율(13:20)로 가운데 잘라 저장하고, 내용 해시를 붙인 주소를 돌려준다 (덮어써도 브라우저가 새로 받게)"""
    im = Image.open(src(name)).convert('RGB')
    w, h = im.size; nw = int(h * W / H)
    im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h)).resize((W * S, H * S), Image.LANCZOS).save(out, quality=92)
    return hashlib.md5(open(out, 'rb').read()).hexdigest()[:8]

v = save(CFG['room'], f'{OUT}/back.jpg')
print(f'  back.jpg  ← {CFG["room"]}')

scenes = {}
for sid, sc in SCENES.items():
    bed = CFG['bed'] + '-bed' if CFG['bed'] else 'bed'
    fmt = lambda f: f.format(room=CFG['room'], scene=CFG['scene'], bed=bed)
    names = [fmt(f) for f in sc['frames']]
    missing = [n for n in names if not have(n)]
    if missing:
        print(f'  ! {sid} 건너뜀 — 없는 그림: {", ".join(missing)}'); continue
    def cut_all(src_names, tag):
        outs = []
        for i, n in enumerate(src_names):
            p = f'{OUT}/scenes/{sid}-{tag}{i + 1}.jpg'
            outs.append(f'/rooms/{RID}/scenes/{sid}-{tag}{i + 1}.jpg?v={save(n, p)}')
        return outs
    frames = cut_all(names, '')
    enter_names = [fmt(f) for f in sc.get('enter', [])]
    enter = cut_all(enter_names, 'in') if enter_names and all(have(n) for n in enter_names) else []
    scenes[sid] = { 'ko': sc['ko'], 'frames': frames, 'interval': sc['interval'], **({ 'enter': enter, 'enterMs': sc.get('enterMs', 520) } if enter else {}) }
    print(f'  scenes/{sid}-*.jpg  ← {", ".join(enter_names + names)}')

room = {
  'id': RID, 'w': W, 'h': H,
  'back': f'/rooms/{RID}/back.jpg?v={v}',
  'vanishY': 150,
  'walk': [list(p) for p in CFG['walk']],
  'home': CFG['home'],
  'zones': [z for z in CFG['zones'] if z['scene'] in scenes],
  'scenes': scenes,
}
json.dump(room, open(f'{OUT}/room.json', 'w'), ensure_ascii=False, indent=1)
print(f'{OUT}/room.json: 존 {len(room["zones"])} · 장면 {len(scenes)}')
