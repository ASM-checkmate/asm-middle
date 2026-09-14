# 프레임 세트: 같은 프레이밍으로 편집된 전신 그림들의 초록을 빼고, 세트마다 **같은 상자**로 잘라 public/character/frames/<name>.png 로 저장.
# (낱장마다 제 상자로 자르면 발 위치가 프레임마다 튄다.) src/dev/room/frames.json 에 세트별 src(해시 붙음)·발 위치를 적는다.
# 프레임끼리 색을 맞춘다: AI 가 매번 새로 렌더해 실루엣은 맞아도 전체 음영이 조금씩 다르다. 그대로 돌리면 프레임이 바뀔
# 때마다 몸 전체가 번쩍인다 → 첫 장을 기준으로, 겹치는 부분의 색을 채널마다 직선(gain·offset)으로 맞춘다. 자세가 바뀐
# 부분(다리)은 겹치지 않으니 기준에서 빠진다.
# 세트: idle(char-front·idle-2·idle-3) · walk-front(5: 왼발 닿음·밀기·스침·뻗기·오른발 닿음 — 뒷반쪽은 밀기·뻗기를 좌우 뒤집어 씀) · walk-back(pose-back·1·2·3) · sit(pose-sit). 앞/뒤 세트는 프레이밍이 조금 달라 따로 잰다.
# Usage: python3 scripts/frames.py
import hashlib, json, os
import numpy as np
from PIL import Image
from scipy import ndimage

GEN, OUT, JSON_OUT = 'art/gen', 'public/character/frames', 'src/dev/room/frames.json'
os.makedirs(OUT, exist_ok=True)
SETS = {
  'idle': ['char-front', 'idle-2', 'idle-3'],
  'walk-front': ['walk-front-1', 'walk-front-push', 'walk-front-2', 'walk-front-reach', 'walk-front-3'],   # 닿음·밀기·스침·뻗기·닿음
  'walk-back': ['pose-back', 'walk-back-1', 'walk-back-2', 'walk-back-3'],
  'sit': ['pose-sit'],
}

def key(name):
    img = np.asarray(Image.open(f'{GEN}/{name}.jpg').convert('RGB')).astype(np.float32)
    g = img[..., 1] - np.maximum(img[..., 0], img[..., 2])
    a = np.clip((110 - g) / 70.0, 0, 1)
    rgb = img.copy(); e = (a > 0) & (a < 1)
    rgb[..., 1] = np.where(e, np.minimum(rgb[..., 1], (rgb[..., 0] + rgb[..., 2]) / 2 + 8), rgb[..., 1])
    h, w = a.shape; a[int(h * .86):, int(w * .84):] = 0          # 워터마크
    return rgb, a

def match_color(rgb, a, ref_rgb, ref_a):
    """첫 장(ref)의 색에 맞춘다 — 둘 다 불투명한 곳만 보고 채널마다 rgb*g+o 로"""
    both = (a > .9) & (ref_a > .9)
    if both.sum() < 500: return rgb
    out = rgb.copy()
    for c in range(3):
        x, y = rgb[..., c][both], ref_rgb[..., c][both]
        sx = x.std()
        if sx < 1e-3: continue
        g = min(1.25, max(0.8, y.std() / sx))          # 너무 세게 당기지 않게 죈다
        o = y.mean() - g * x.mean()
        out[..., c] = rgb[..., c] * g + o
    return np.clip(out, 0, 255)

out = {}
for sname, names in SETS.items():
    keyed = [key(n) for n in names]
    ref_rgb, ref_a = keyed[0]
    keyed = [keyed[0]] + [(match_color(r, a, ref_rgb, ref_a), a) for r, a in keyed[1:]]
    solid = np.zeros(keyed[0][1].shape, bool)
    for _, a in keyed: solid |= ndimage.binary_opening(a > .5, np.ones((5, 5)))
    ys, xs = np.nonzero(solid); pad = 6
    x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + pad, ys.max() + pad
    frames = []
    for n, (rgb, a) in zip(names, keyed):
        piece = np.concatenate([np.clip(rgb, 0, 255), (a * 255)[..., None]], axis=2)[y0:y1, x0:x1].astype(np.uint8)
        path = f'{OUT}/{n}.png'; Image.fromarray(piece, 'RGBA').save(path, optimize=True)
        v = hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]
        frames.append(f'/character/frames/{n}.png?v={v}')
    # 발 위치: 세트 실루엣의 맨 아래 가운데 (상자 기준 비율)
    out[sname] = { 'frames': frames, 'w': int(x1 - x0), 'h': int(y1 - y0), 'feetX': float((xs.mean() - x0) / (x1 - x0)) }
    print(f'  {sname}: {len(frames)} frames, {x1 - x0}×{y1 - y0}')
json.dump(out, open(JSON_OUT, 'w'), ensure_ascii=False, indent=1)
print(JSON_OUT)
