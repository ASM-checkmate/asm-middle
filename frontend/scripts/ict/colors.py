"""사진 + MediaPipe 랜드마크 → 피부·홍채·입술·눈썹 색(중앙값, 조명 보정) → 팔레트 스냅, 눈썹 굵기·각도. weights.json 에 덧붙인다"""
import json, numpy as np
from PIL import Image, ImageDraw
D = 'ict'; W = json.load(open(f'{D}/weights.json')); LM = json.load(open(f'{D}/landmarks.json'))
SKIN = {'light': '#FFE7D6', 'fair': '#FFD9B8', 'tan': '#EDBB8E', 'brown': '#B97D52', 'dark': '#7A4B2E'}
HAIR = {'black': '#1F1A17', 'dark-brown': '#3A2A22', 'brown': '#6E4B2F', 'blond': '#E9C45C', 'red': '#B8512E', 'gray': '#8E8A86', 'white': '#EDE7DE'}
IRIS = {'dark-brown': '#3B2A20', 'brown': '#6B4A2B', 'hazel': '#8A6A3A', 'blue': '#5B8FC7', 'green': '#5E8A5A', 'gray': '#8E9AA0'}
LIPS = {'rose': '#D98C86', 'coral': '#E07A6B', 'plum': '#B25F72', 'nude': '#C99A8A', 'brown': '#8E5A48'}
HAIR_OF = {'trump': 'blond', 'obama': 'black', 'ljm': 'black', 'lmb': 'black'}   # 열세 칸(비전 모델)이 고른 값
def hex2rgb(h): return np.array([int(h[i:i+2], 16) for i in (1, 3, 5)], float)
def rgb2lab(c):
    c = c / 255.0; c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]); xyz = M @ c / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116); return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])
def snap(rgb, pal, lw=1.0):
    lab = rgb2lab(rgb); best = None
    for k, h in pal.items():
        d = rgb2lab(hex2rgb(h)) - lab; d[0] *= lw; s = float(d @ d)
        if best is None or s < best[0]: best = (s, k)
    return best[1]
def median_in(img, poly):
    m = Image.new('L', img.size, 0); ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    a = np.asarray(img); mm = np.asarray(m) > 0
    return np.median(a[mm].reshape(-1, 3), axis=0) if mm.sum() > 10 else None
def square(p, r): return [(p[0]-r, p[1]-r), (p[0]+r, p[1]-r), (p[0]+r, p[1]+r), (p[0]-r, p[1]+r)]
OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
BROW_R_UP, BROW_R_DN = [70, 63, 105, 66, 107], [46, 53, 52, 65, 55]; BROW_L_UP, BROW_L_DN = [300, 293, 334, 296, 336], [276, 283, 282, 295, 285]
for name, d in LM.items():
    img = Image.open(f'face/{name}.jpg').convert('RGB'); P = np.array(d['pts'])[:, :2]
    fw = np.linalg.norm(P[454] - P[234]); r = max(3, int(fw * 0.03))
    skin = np.median([median_in(img, square(P[i], r)) for i in (50, 280, 101, 330)], axis=0)
    iris = []
    for c, ring in ((468, [469, 470, 471, 472]), (473, [474, 475, 476, 477])):
        rr = np.mean([np.linalg.norm(P[j] - P[c]) for j in ring]) * 0.6; v = median_in(img, square(P[c], max(2, int(rr))));
        if v is not None: iris.append(v)
    iris = np.median(iris, axis=0)
    lipmask = Image.new('L', img.size, 0); dr = ImageDraw.Draw(lipmask); dr.polygon([tuple(P[i]) for i in OUTER], fill=255); dr.polygon([tuple(P[i]) for i in INNER], fill=0)
    a = np.asarray(img); mm = np.asarray(lipmask) > 0; lips = np.median(a[mm].reshape(-1, 3), axis=0)
    brow = np.median([median_in(img, [tuple(P[i]) for i in BROW_R_UP + BROW_R_DN[::-1]]), median_in(img, [tuple(P[i]) for i in BROW_L_UP + BROW_L_DN[::-1]])], axis=0)
    # 눈썹 굵기(눈 높이 대비)와 각도(안쪽→바깥쪽 기울기, 위로 갈수록 +)
    eyeh = np.mean([np.linalg.norm(P[159] - P[145]), np.linalg.norm(P[386] - P[374])])
    thick = np.mean([np.linalg.norm(P[u] - P[l]) for u, l in list(zip(BROW_R_UP, BROW_R_DN)) + list(zip(BROW_L_UP, BROW_L_DN))]) / eyeh
    angR = np.degrees(np.arctan2(-(P[70][1] - P[107][1]), abs(P[70][0] - P[107][0]))); angL = np.degrees(np.arctan2(-(P[300][1] - P[336][1]), abs(P[300][0] - P[336][0])))
    ang = (angR + angL) / 2
    kind = 'angled' if ang < -8 else ('thick' if thick > 0.75 else 'thin')
    col = {'skin': snap(skin, SKIN, 0.6), 'iris': snap(iris, IRIS, 0.7), 'lips': snap(lips, LIPS, 0.7), 'hairColor': HAIR_OF[name], 'browColor': snap(brow, HAIR, 0.8),
           'brow': {'kind': kind, 'thick': round(float(thick), 2), 'angle': round(float(ang), 1)}, 'raw': {'skin': skin.tolist(), 'iris': iris.tolist(), 'lips': lips.tolist(), 'brow': brow.tolist()}}
    W[name]['color'] = col
    print(name, {k: v for k, v in col.items() if k != 'raw'}, 'raw skin', np.round(skin), 'iris', np.round(iris))
json.dump(W, open(f'{D}/weights.json', 'w'), indent=1)
