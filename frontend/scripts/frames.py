# 프레임 세트: 같은 프레이밍으로 편집된 전신 그림들의 초록을 빼고, 세트마다 **같은 상자**로 잘라 public/character/frames/<name>.png 로 저장.
# (낱장마다 제 상자로 자르면 발 위치가 프레임마다 튄다.) src/dev/room/frames.json 에 세트별 src(해시 붙음)·발 위치를 적는다.
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

out = {}
for sname, names in SETS.items():
    keyed = [key(n) for n in names]
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
