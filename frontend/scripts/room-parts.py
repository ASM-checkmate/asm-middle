# 방 편집본 차분으로 소품을 잘라낸다 → public/rooms/bedroom/{back.jpg, props/*.png, room.json}, 자세 그림은 초록을 빼서 public/character/poses/*.png
#   room(전체) 과 room-no-X(X 만 뺀 것) 의 색 차이가 큰 곳 = X. 열고 닫아 잔조각을 버리고, 섬이 여럿이면(협탁 둘, 서랍장+거울) 따로 저장한다.
#   back = room-empty (가구 없는 방). 소품 조각은 room 의 픽셀로, base(바닥 접점) 는 조각 상자의 아래 끝.
#   방 좌표는 390×600 (그림은 2:3 이라 양옆을 조금 잘라 13:20 으로 맞춘 뒤 2배로 저장).
# Usage: python3 scripts/room-parts.py [bedroom|anime]   — ROOMS 에 방마다 그림 이름 접두어·자리(spot)를 적는다
import hashlib, json, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOMS = {
  # 클레이 침실 (나노바나나가 캐릭터 화풍으로 그린 것)
  'bedroom': { 'prefix': 'room', 'scene': 'scene', 'rug': True,
               'spots': { 'door': (70, 560), 'center': (195, 500), 'bedside': (150, 420), 'dresser': (300, 450), 'makeup': (330, 470) } },
  # 애니메이션풍 침실: 처음 그림(art/character/bedroom.png)을 참고로 모델이 다시 그린 anime2-room — 외부 그림을 직접 편집시키면 구도를
  # 다시 잡아 버려 차분이 안 되고, 모델이 그린 방은 편집본이 제자리에 온다. 빈 방에 러그·커튼이 남아 있다
  'anime':   { 'prefix': 'anime2-room', 'scene': 'anime2-scene', 'rug': False,
               'spots': { 'door': (60, 556), 'center': (200, 490), 'bedside': (150, 420), 'dresser': (300, 440), 'makeup': (322, 462) } },
}
RID = sys.argv[1] if len(sys.argv) > 1 else 'bedroom'
CFG = ROOMS[RID]; P, SP = CFG['prefix'], CFG['scene']
GEN, OUT, W, H, S = 'art/gen', f'public/rooms/{RID}', 390, 600, 2
os.makedirs(f'{OUT}/props', exist_ok=True)

def load_room(name):
    path = next(f'{GEN}/{name}.{ext}' for ext in ('jpg', 'png') if os.path.exists(f'{GEN}/{name}.{ext}'))
    im = Image.open(path).convert('RGB')
    w, h = im.size; nw = int(h * W / H)
    im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h)).resize((W * S, H * S), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)
def have(name): return any(os.path.exists(f'{GEN}/{name}.{ext}') for ext in ('jpg', 'png'))

room = load_room(P)
Image.fromarray(load_room(f'{P}-empty').astype(np.uint8)).save(f'{OUT}/back.jpg', quality=90)
Image.fromarray(room.astype(np.uint8)).save(f'{OUT}/full.jpg', quality=90)   # 비교용

def islands(mask, min_area):
    lab, n = ndimage.label(mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(ys) < min_area: continue
        out.append((lab == i, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]))
    return sorted(out, key=lambda t: t[1][0])   # 왼쪽부터
def largest(isl): return max(isl, key=lambda t: t[0].sum())

props = []
def cut(name, mask, box, base=None, src=None, hidden=False):
    x0, y0, x1, y1 = box
    m = ndimage.binary_dilation(mask, np.ones((5, 5)))
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    piece = np.concatenate([room if src is None else src, (alpha * 255)[..., None]], axis=2)[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(piece, 'RGBA').save(f'{OUT}/props/{name}.png', optimize=True)
    v = hashlib.md5(open(f'{OUT}/props/{name}.png', 'rb').read()).hexdigest()[:8]
    props.append({ 'id': name, 'src': f'/rooms/{RID}/props/{name}.png?v={v}', 'x': x0 / S, 'y': y0 / S, 'w': (x1 - x0) / S, 'h': (y1 - y0) / S, 'base': (base if base is not None else y1) / S, **({ 'hidden': True } if hidden else {}) })
    print(f'  {name:14s} {(x1-x0)//S}×{(y1-y0)//S} at ({x0//S},{y0//S}) base {props[-1]["base"]:.0f}')

def diff(name, hi=45, lo=22, open_r=3, close_r=9):
    """편집본과 달라진 곳. 이력 문턱: 높은 문턱(hi)으로 확실한 자리를 잡고, 낮은 문턱(lo)의 덩어리 중 그 자리에 닿는 것만 가져온다.
    한 문턱만 쓰면 침대가 틀·이불 경계에서 두 섬으로 갈려 사이에 구멍이 남는다 (뒤 그림이 비친다)."""
    d = np.sqrt(((room - load_room(name)) ** 2).sum(axis=2))
    strong = ndimage.binary_opening(d > hi, np.ones((2 * open_r + 1,) * 2))
    weak = ndimage.binary_closing(ndimage.binary_opening(d > lo, np.ones((5, 5))), np.ones((2 * close_r + 1,) * 2))
    lab, n = ndimage.label(weak)
    keep = np.unique(lab[strong & weak]); keep = keep[keep > 0]
    return ndimage.binary_fill_holes(np.isin(lab, keep))

# 침대(이불·베개 포함) / 이불 / 협탁 둘 / 서랍장(+거울) / 열린 문
used = np.zeros(room.shape[:2], bool)
prop_mask = {}
def take(name, mask, box, base=None):
    global used; used |= mask; prop_mask[name] = mask; cut(name, mask, box, base)

bm, bb = largest(islands(diff(f'{P}-no-bed'), 6000)); take('bed', bm, bb)
# 이불: '이불 없는 방' 편집본은 침대 전체를 다시 그려서 차분이 안 된다 → 침대 조각 안의 분홍 픽셀로 잡는다 (틀보다 앞 — 누운 사람이 그 사이에 든다)
r_, g_, b_ = room[..., 0], room[..., 1], room[..., 2]
pink = bm & (r_ - g_ > 40) & (g_ - b_ < 14) & (r_ > 120)   # 분홍(176,108,98)은 G≈B, 나무(163,110,77)는 G≫B
pink = ndimage.binary_fill_holes(ndimage.binary_closing(ndimage.binary_opening(pink, np.ones((5, 5))), np.ones((21, 21))))
km, kb = largest(islands(pink, 3000)); take('blanket', km, kb, base=bb[3] + 8)   # 틀(+0) < 누운 사람(+2) < 이불(+4)
for i, (m, b) in enumerate(islands(diff(f'{P}-no-nightstands'), 1200)[:2]): take(f'nightstand-{"lr"[i]}', m, b)   # 오른쪽 협탁은 침대에 가려 작다
dm, db = largest(islands(diff(f'{P}-no-dresser'), 2000)); take('dresser', dm, db)   # 거울까지 한 덩어리
# 열린 문은 빈 방 그림에 이미 있다. '닫힌 문'은 닫힌 편집본의 픽셀로 떼어 두고 평소엔 숨긴다 (문 닫기 연출용, 벽에 붙어 있으니 맨 뒤)
if have(f'{P}-door-closed'):
    closed = load_room(f'{P}-door-closed'); door = diff(f'{P}-door-closed'); m = np.zeros_like(door)
    for mm, b in islands(door, 3000): m |= mm
    ys, xs = np.nonzero(m); cut('door-closed', m, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], base=3, src=closed, hidden=True)
    used |= m
# 남은 것(커튼): 빈 방과의 차이에서 위 소품을 뺀 섬 — 벽에 붙은 장식이라 맨 뒤(base 1)
rest = diff(f'{P}-empty') & ~ndimage.binary_dilation(used, np.ones((15, 15)))
for (m, b) in islands(rest, 6000):
    if b[1] < H * S * 0.5: take('curtains', m, b, base=1)
# 러그: 빈 방과 색 차이가 작아 침대 아래 띠(침대 아래 끝 ±)에서 낮은 문턱으로 잡는다 — 침대 뒤·바닥 위(base = 침대 - 1)
yy, xx = np.mgrid[0:H * S, 0:W * S]
band = (yy > bb[3] - 60) & (yy < bb[3] + 90) & (xx > bb[0] - 90) & (xx < bb[2] + 90) & ~ndimage.binary_dilation(bm, np.ones((3, 3)))
rug = diff(f'{P}-empty', hi=22, lo=12, open_r=4, close_r=12) & band
rug = ndimage.binary_fill_holes(rug)
if CFG['rug'] and rug.sum() > 3000:
    ys, xs = np.nonzero(rug); take('rug', rug, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], base=bb[3] - 2)

# ── 장면: 제자리 동작은 "그 물건 + 사람" 프레임 2~3장을 같은 마스크로 잘라 반복한다 (이동만 퍼펫). 마스크 = 갈아 끼우는 소품 ∪ 프레임들이 달라진 곳
SCENES = {
  'sleep':  { 'frames': [f'{P}-sleeping', f'{SP}-sleep-2'], 'replaces': ['bed', 'blanket'], 'interval': 1400 },
  'makeup': { 'frames': [f'{SP}-makeup-1', f'{SP}-makeup-2', f'{SP}-makeup-3'], 'replaces': ['dresser'], 'interval': 800 },
}
scenes = {}
for sname, sc in SCENES.items():
    frames = [load_room(f) for f in sc['frames']]
    m = np.zeros(room.shape[:2], bool)
    for pid in sc['replaces']: m |= prop_mask[pid]
    near = ndimage.binary_dilation(m, np.ones((61, 61)))
    for fr in frames:
        # 문턱을 낮게(살색·크림색 옷이 벽과 비슷해서) 잡고, 소품 곁에 닿은 덩어리는 통째로 가져간다 (사람·의자가 벽 쪽으로 이어져도)
        d = np.sqrt(((room - fr) ** 2).sum(axis=2)) > 26
        d = ndimage.binary_closing(ndimage.binary_opening(d, np.ones((3, 3))), np.ones((9, 9)))
        lab_, n_ = ndimage.label(d)
        touching = np.unique(lab_[near & d]); touching = touching[touching > 0]
        m |= np.isin(lab_, touching)
    m = ndimage.binary_fill_holes(ndimage.binary_closing(m, np.ones((15, 15))))
    # 바닥은 편집본마다 살짝 달리 그려져 덩어리에 끌려온다 → 소품·강한 변화(사람·의자)의 아래 끝보다 아래는 잘라 낸다
    strong = np.zeros_like(m)
    for pid in sc['replaces']: strong |= prop_mask[pid]
    for fr in frames:
        ds = np.sqrt(((room - fr) ** 2).sum(axis=2)) > 70
        strong |= ndimage.binary_opening(ds, np.ones((5, 5))) & near
    ymax = int(np.nonzero(strong.any(axis=1))[0].max()) + 12
    m[ymax:] = False
    ys, xs = np.nonzero(m); box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    base = max(p['base'] for p in props if p['id'] in sc['replaces']) * S + 12
    ids = []
    for i, fr in enumerate(frames):
        cut(f'scene-{sname}-{i + 1}', m, box, base=base, src=fr, hidden=True); ids.append(f'scene-{sname}-{i + 1}')
    scenes[sname] = { 'frames': ids, 'replaces': sc['replaces'], 'interval': sc['interval'] }

bed_base = bb[3] / S
sp = CFG['spots']
spots = {
  'door':    { 'x': sp['door'][0], 'y': sp['door'][1], 'pose': 'idle' },
  'center':  { 'x': sp['center'][0], 'y': sp['center'][1], 'pose': 'idle' },
  'bedside': { 'x': sp['bedside'][0], 'y': sp['bedside'][1], 'pose': 'idle' },
  'dresser': { 'x': sp['dresser'][0], 'y': sp['dresser'][1], 'pose': 'idle' },
  'makeup':  { 'x': sp['makeup'][0], 'y': sp['makeup'][1], 'pose': 'scene', 'scene': 'makeup' },
  'bed-edge': { 'x': int(bb[0] / S + 65), 'y': bed_base + 8, 'pose': 'sit', 'z': bed_base + 5, 'size': 150 },   # 이불(+4)보다 앞
  'bed':     { 'x': 195, 'y': bed_base + 6, 'pose': 'scene', 'scene': 'sleep' },
}
bv = hashlib.md5(open(f'{OUT}/back.jpg', 'rb').read()).hexdigest()[:8]
json.dump({ 'id': RID, 'w': W, 'h': H, 'back': f'/rooms/{RID}/back.jpg?v={bv}', 'vanishY': 150, 'props': props, 'spots': spots, 'scenes': scenes }, open(f'{OUT}/room.json', 'w'), ensure_ascii=False, indent=1)
print(f'{OUT}/room.json: {len(props)} props')

# 자세 그림: 초록 → 알파
os.makedirs('public/character/poses', exist_ok=True)
for name in ['back', 'lie', 'sit', 'walk']:
    img = np.asarray(Image.open(f'{GEN}/pose-{name}.jpg').convert('RGB')).astype(np.float32)
    g = img[..., 1] - np.maximum(img[..., 0], img[..., 2])
    a = np.clip((110 - g) / 70.0, 0, 1)
    rgb = img.copy(); e = (a > 0) & (a < 1); rgb[..., 1] = np.where(e, np.minimum(rgb[..., 1], (rgb[..., 0] + rgb[..., 2]) / 2 + 8), rgb[..., 1])
    solid = ndimage.binary_opening(a > .5, np.ones((5, 5)))
    ys, xs = np.nonzero(solid); pad = 6
    x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + pad, ys.max() + pad
    out = np.concatenate([np.clip(rgb, 0, 255), (a * 255)[..., None]], axis=2)[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(f'public/character/poses/{name}.png', optimize=True)
    print(f'  poses/{name}.png {x1-x0}×{y1-y0}')
