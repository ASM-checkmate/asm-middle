"""사진 랜드마크(MediaPipe 478) → ICT 생김새 축 20개 값. 약원근 + MediaPipe 얼굴 회전으로 정합, 릿지 최소제곱. 결과: weights.json"""
import json, numpy as np
D = 'ict'
def read_obj(p):
    return np.array([[float(x) for x in l.split()[1:4]] for l in open(p) if l.startswith('v ')])
neutral = read_obj(f'{D}/generic_neutral_mesh.obj')
IDS = [f'identity{i:03d}' for i in range(20)]
deltas = np.stack([read_obj(f'{D}/{n}.obj') - neutral for n in IDS])          # K×N×3
lmv = json.load(open(f'{D}/vertex_indices.json'))['idx_to_landmark_verts']    # dlib 68 → 정점
# dlib 68 ↔ MediaPipe 468 대응 (얼굴 윤곽·눈썹·코·눈·입 32점)
MAP = {0: 234, 16: 454, 8: 152, 17: 70, 18: 63, 19: 105, 20: 66, 21: 107, 22: 336, 23: 296, 24: 334, 25: 293, 26: 300,
       27: 168, 30: 1, 31: 98, 33: 2, 35: 327, 36: 33, 37: 160, 38: 158, 39: 133, 40: 153, 41: 144, 42: 362, 43: 385, 44: 387, 45: 263, 46: 373, 47: 380,
       48: 61, 54: 291, 51: 0, 57: 17, 62: 13, 66: 14}
dl = np.array(list(MAP.keys())); mp = np.array(list(MAP.values()))
V = np.array([lmv[i] for i in dl])                       # 모델 정점 번호
L0 = neutral[V]; DK = deltas[:, V, :]                     # 정점별 기본 위치와 축 차이값
lm = json.load(open(f'{D}/landmarks.json'))
def norm2d(P):   # 두 눈 바깥 꼬리 거리로 정규화, 원점은 두 눈 중심
    a, b = P[list(dl).index(36)], P[list(dl).index(45)]; c = (a + b) / 2; s = np.linalg.norm(b - a); return (P - c) / s, c, s
out = {}
for name, d in lm.items():
    pts = np.array(d['pts'])[mp][:, :2]; pts[:, 1] *= -1          # 이미지 y는 아래가 +, 모델은 위가 +
    # MediaPipe 얼굴 회전: 모델을 사진 속 머리 방향으로 돌린다
    M = np.array(d['M']) if 'M' in d else None
    yaw = np.radians(d['yaw']); Ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    P2, _, _ = norm2d(pts)
    w = np.zeros(len(IDS))
    Lr0 = (L0 @ Ry.T); Q0, _, _ = norm2d(Lr0[:, :2]); res0 = float(np.sqrt(((P2 - Q0) ** 2).sum(1).mean()))
    for it in range(4):
        L = L0 + np.tensordot(w, DK, 1)                              # 현재 3D 랜드마크
        Lr = L @ Ry.T; Q2, _, _ = norm2d(Lr[:, :2])
        # 2D 유사변환(회전·스케일·이동)으로 정합
        A = np.c_[Q2, np.ones(len(Q2))]; sol, *_ = np.linalg.lstsq(np.kron(np.eye(2), A), P2.T.ravel(), rcond=None)
        # 잔차를 축으로 설명: 선형 항 (근사: 유사변환은 고정)
        Bk = np.stack([(DK[k] @ Ry.T)[:, :2] for k in range(len(IDS))])   # K×n×2
        _, c, s = norm2d(Lr[:, :2]); Bk = Bk / s
        R = P2 - Q2
        Xm = Bk.reshape(len(IDS), -1).T                                    # (2n)×K
        G = Xm.T @ Xm; lam = 0.08 * np.trace(G) / len(IDS)                        # 축 크기에 비례한 릿지
        w = np.linalg.solve(G + lam * np.eye(len(IDS)), Xm.T @ R.ravel())
        w = np.clip(w, -2.5, 2.5)
    res = float(np.sqrt(((P2 - norm2d(((L0 + np.tensordot(w, DK, 1)) @ Ry.T)[:, :2])[0]) ** 2).sum(1).mean()))
    bs = d['bs']; ex = {'mouthSmile_L': bs.get('mouthSmileLeft', 0), 'mouthSmile_R': bs.get('mouthSmileRight', 0), 'browDown_L': bs.get('browDownLeft', 0), 'browDown_R': bs.get('browDownRight', 0), 'browInnerUp_L': bs.get('browInnerUp', 0), 'browInnerUp_R': bs.get('browInnerUp', 0), 'jawOpen': bs.get('jawOpen', 0), 'eyeBlink_L': min(0.6, bs.get('eyeBlinkLeft', 0)), 'eyeBlink_R': min(0.6, bs.get('eyeBlinkRight', 0)), 'mouthFrown_L': bs.get('mouthFrownLeft', 0), 'mouthFrown_R': bs.get('mouthFrownRight', 0), 'mouthPucker': bs.get('mouthPucker', 0), 'cheekPuff_L': 0, 'cheekPuff_R': 0, 'eyeWide_L': bs.get('eyeWideLeft', 0), 'eyeWide_R': bs.get('eyeWideRight', 0)}
    out[name] = {'identity': {n: round(float(x), 3) for n, x in zip(IDS, w)}, 'expression': {k: round(float(v), 3) for k, v in ex.items()}, 'residual': round(res, 3), 'yaw': d['yaw']}
    print(name, 'yaw %.0f' % d['yaw'], 'residual %.3f → %.3f' % (res0, res), 'axis rms %.4f' % float(np.sqrt((Bk**2).mean())), 'w', np.round(w[:8], 2), '|w|max %.2f' % float(np.abs(w).max()))
json.dump(out, open(f'{D}/weights.json', 'w'), indent=1)
