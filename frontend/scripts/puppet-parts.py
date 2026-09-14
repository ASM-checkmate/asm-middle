# 퍼펫 시트(art/gen/char-parts.jpg: 초록 배경에 머리·몸통·팔 2·다리 2가 떨어져 있는 한 장)에서 조각을 떼어 낸다.
#   1) 초록 키잉 → 알파   2) 연결된 섬(component)으로 나눈다   3) 자리로 이름을 붙인다: 맨 위 = head, 가운데 = torso,
#   좌우 바깥 = arm-l / arm-r (화면 왼쪽이 그녀의 오른팔이지만, 이름은 화면 기준 l/r), 아래 둘 = leg-l / leg-r
#   4) 조각마다 딱 맞게 잘라 public/character/puppet/<part>.png 로 저장하고, puppet.json 에 시트 좌표(상자)와
#      관절 후보(머리: 목 꼭지 아래 가운데, 팔·다리: 구슬 쪽 끝 가운데, 몸통: 목 위·어깨 양옆·엉덩이 양옆)를 적는다.
#   관절은 어림값 — 방 랩의 리그 편집으로 다듬어 puppet.json 에 다시 적는다.
# Usage: python3 scripts/puppet-parts.py [art/gen/char-parts.jpg]
import hashlib, json, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src = sys.argv[1] if len(sys.argv) > 1 else 'art/gen/char-parts2.jpg'   # 소매·바지 허리는 몸통에, 팔다리는 맨 구슬부터 (char-parts2)
OUT = 'public/character/puppet'
os.makedirs(OUT, exist_ok=True)

img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
green = g - np.maximum(r, b)
a = np.clip((110 - green) / 70.0, 0, 1)                     # jpeg 라 문턱을 조금 너그럽게
# despill
rgb = img.copy(); edge = (a > 0) & (a < 1)
rgb[..., 1] = np.where(edge, np.minimum(rgb[..., 1], (rgb[..., 0] + rgb[..., 2]) / 2 + 8), rgb[..., 1])

solid = ndimage.binary_opening(a > .5, np.ones((5, 5)))
lab, n = ndimage.label(solid)
sizes = ndimage.sum(solid, lab, range(1, n + 1))
H, W = a.shape
islands = []
for i, s in enumerate(sizes):
    if s < H * W * 0.002: continue                            # 잔조각 버림
    ys, xs = np.nonzero(lab == i + 1)
    islands.append({ 'i': i + 1, 'box': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], 'cx': float(xs.mean()), 'cy': float(ys.mean()), 'area': int(s) })
if len(islands) != 6:
    print(f'섬이 {len(islands)}개 (6개여야 한다: head·torso·arm×2·leg×2) — 시트가 붙었거나 끊겼다. 문턱을 바꾸거나 다시 뽑는다'); print([ (isl['box'], isl['area']) for isl in islands ])
    sys.exit(1)

# 이름 붙이기: 가장 위 = head, 그다음 가운데(cx 가 가운데에 가까운) = torso, 나머지 넷 중 위 둘이 팔, 아래 둘이 다리, 각각 왼쪽/오른쪽
by_y = sorted(islands, key=lambda k: k['cy'])
head = by_y[0]
rest = [k for k in islands if k is not head]
torso = min(rest, key=lambda k: abs(k['cx'] - W / 2) + abs(k['cy'] - H * 0.45) * 0.3)
limbs = sorted([k for k in rest if k is not torso], key=lambda k: k['cy'])
arms, legs = sorted(limbs[:2], key=lambda k: k['cx']), sorted(limbs[2:], key=lambda k: k['cx'])
named = { 'head': head, 'torso': torso, 'arm-l': arms[0], 'arm-r': arms[1], 'leg-l': legs[0], 'leg-r': legs[1] }

pant_top = {}   # 다리 조각: 바지가 시작되는 행 (시트 좌표) — 그 위 구슬은 지운다

def cut(isl, name):
    x0, y0, x1, y1 = isl['box']; pad = 4
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    m = (lab == isl['i'])
    m = ndimage.binary_dilation(m, np.ones((7, 7)))            # 안티앨리어스 가장자리까지 살린다
    alpha = a * m
    if name.startswith('leg'):
        # 구슬은 지운다 (다리 구슬은 바지와 같은 회색이라 색으로는 못 가른다): 행마다 폭을 재서, 구슬 폭(위 15행 중앙값)의 1.3배로
        # 넓어지는 첫 행 = 바지 윗단 (구슬 지름의 1.25배). 그 위는 투명 — 다리를 반바지 위에 그려도 구슬이 안 보이게
        rows = np.arange(isl['box'][1], isl['box'][3])
        widths = np.array([(alpha[y, x0:x1] > .5).sum() for y in rows])
        ball_w = widths[:35].max()                       # 구슬 지름 (위 35행 안에서 제일 넓은 곳)
        k = int(np.argmax(widths > ball_w * 1.25))
        top = int(rows[k]) if widths[k] > ball_w * 1.25 else int(rows[0])
        pant_top[name] = top
        print(f'    {name}: ball_w {ball_w:.0f}, pant top row {top} (piece +{top - isl["box"][1]})')
        fade = np.clip((np.arange(H)[:, None] - top + 2) / 4.0, 0, 1)   # 4px 부드럽게
        alpha = alpha * fade
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255
    piece = np.concatenate([np.clip(rgb, 0, 255), (alpha * 255)[..., None]], axis=2)[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(piece, 'RGBA').save(f'{OUT}/{name}.png', optimize=True)
    return [x0, y0, x1 - x0, y1 - y0]

parts = {}
for name, isl in named.items():
    x, y, w, h = cut(isl, name)
    # 관절 후보 (시트 좌표): 팔·다리는 위쪽 끝(구슬) 가운데, 머리는 아래 끝 가운데(목 꼭지)
    if name == 'head': pivot = [x + w / 2, y + h - 6]
    elif name.startswith('arm'): pivot = [x + (w * (0.78 if name == 'arm-l' else 0.22)), y + 14]
    elif name.startswith('leg'): pivot = [x + (w * (0.62 if name == 'leg-l' else 0.38)), y + 20]   # 구슬(지름 ~40) 가운데
    else: pivot = [x + w / 2, y + 8]
    v = hashlib.md5(open(f'{OUT}/{name}.png', 'rb').read()).hexdigest()[:8]   # 캐시 깨기: 조각이 바뀌면 주소도 바뀐다
    parts[name] = { 'src': f'/character/puppet/{name}.png?v={v}', 'x': x, 'y': y, 'w': w, 'h': h, 'pivot': [round(pivot[0]), round(pivot[1])] }
    print(f'  {name:7s} {w}×{h} at ({x},{y}) pivot {parts[name]["pivot"]}')

# 몸통의 붙일 자리(소켓): 목 = 위 가운데, 어깨 = 위쪽 양옆, 엉덩이 = 아래 양옆 — 어림값
tx, ty, tw, th = parts['torso']['x'], parts['torso']['y'], parts['torso']['w'], parts['torso']['h']
# 엉덩이: 다리는 반바지 '위'에 그리니, 바지 윗단이 반바지 다리 구멍 위(밑단 -48px)까지 올라오도록 소켓을 역산한다: 소켓 = 목표 - (바지윗단 - 축)
target = ty + th - 48
hip = lambda name, fx: [tx + tw * fx, target - (pant_top[name] - parts[name]['pivot'][1])]
sockets = { 'neck': [tx + tw / 2, ty + 10], 'shoulder-l': [tx + tw * 0.12, ty + th * 0.18], 'shoulder-r': [tx + tw * 0.88, ty + th * 0.18], 'hip-l': hip('leg-l', 0.33), 'hip-r': hip('leg-r', 0.67) }   # 어깨 = 소매 안, 좌우 다리는 안쪽으로 붙여 가랑이 틈을 닫는다
JSON_OUT = 'src/dev/puppet/puppet.json'   # 앱이 import 한다 (관절은 퍼펫 랩에서 다듬어 여기 다시 붙여 넣는다)
json.dump({ 'sheet': [W, H], 'parts': parts, 'sockets': { k: [round(v[0]), round(v[1])] for k, v in sockets.items() } }, open(JSON_OUT, 'w'), ensure_ascii=False, indent=1)
print(JSON_OUT)
