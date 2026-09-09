"""TripoSR로 소품 PNG 한 장을 glb로 (ADR-0014 개정 8). 설치는 scripts/triposr-setup.sh.

Usage:
  .triposr/venv/bin/python scripts/triposr.py assets-src/cafe/4.r.png --name cafe-4 [--out public/assets/models]
      [--mc-resolution 256] [--foreground-ratio 0.85] [--device mps|cpu] [--preview]
  .triposr/venv/bin/python scripts/triposr.py --scene cafe [--src assets-src]    # <src>/cafe/<n>.r.png 전부 → cafe-<n>.glb, 끝에 매니페스트 조각

입력은 export-props.mjs가 뽑은 투명 배경 PNG(RGBA)라 배경 제거(rembg)는 하지 않는다. 결과는 정점색 glb —
톤 패스(src/stage/tone.ts)가 팔레트로 누른다. --preview는 같은 자리에 <name>.preview.png(정면·옆·위 렌더, trimesh)를 함께 쓴다.
torchmcubes(C++ 빌드)는 scikit-image의 marching cubes로 바꿔 끼운다.
"""
import argparse
import os
import sys
import time
import types

import numpy as np
import torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".triposr", "TripoSR"))


def _fake_torchmcubes():
    """tsr.models.isosurface가 import하는 torchmcubes를 scikit-image로 대신한다.
    torchmcubes는 정점을 (x=마지막 축) 순서로 주고 helper가 [2,1,0]으로 뒤집으니, 여기서도 같은 순서로 준다."""
    from skimage import measure

    def marching_cubes(vol, thresh):
        v, f, _, _ = measure.marching_cubes(vol.cpu().numpy(), float(thresh))
        v = np.ascontiguousarray(v[:, [2, 1, 0]])
        return torch.from_numpy(v.astype(np.float32)), torch.from_numpy(f.astype(np.int64))

    m = types.ModuleType("torchmcubes")
    m.marching_cubes = marching_cubes
    sys.modules["torchmcubes"] = m


_fake_torchmcubes()
from tsr.system import TSR  # noqa: E402
from tsr.utils import resize_foreground  # noqa: E402


def load_input(path, ratio):
    """투명 배경 PNG → 앞면을 ratio 크기로 가운데 둔 정사각형, 배경은 회색 0.5 (TripoSR run.py와 같은 전처리)."""
    img = Image.open(path).convert("RGBA")
    if img.getextrema()[3][0] == 255:
        sys.exit(f"{path}: 알파가 없다 — export-props.mjs가 뽑은 투명 배경 PNG를 넣어라")
    img = resize_foreground(img, ratio)
    a = np.array(img).astype(np.float32) / 255.0
    rgb = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?")
    ap.add_argument("--scene", help="장소 이름: <src>/<scene>/<n>.r.png 전부를 돌린다")
    ap.add_argument("--src", default="assets-src")
    ap.add_argument("--name", help="결과 파일 이름 (기본: 입력 파일 이름)")
    ap.add_argument("--out", default="public/assets/models")
    ap.add_argument("--mc-resolution", type=int, default=256)
    ap.add_argument("--foreground-ratio", type=float, default=0.85)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    ap.add_argument("--chunk-size", type=int, default=8192)
    ap.add_argument("--pitch", type=float, default=22, help="입력 렌더의 카메라 내려다본 각(°, export-props.mjs --pitch). 결과가 그만큼 기울어 나오니 되돌린다")
    ap.add_argument("--yaw", type=float, default=35, help="입력 렌더의 카메라 방향(°, export-props.mjs --yaw). 앞이 무대 정면을 보게 되돌린다")
    ap.add_argument("--smooth", type=int, default=8, help="타우빈 스무딩 반복 (marching cubes의 계단·잡음을 편다). 0이면 안 한다")
    ap.add_argument("--faces", type=int, default=6000, help="면 수 상한 (quadric 데시메이션). 0이면 안 한다")
    ap.add_argument("--color-smooth", type=int, default=6, help="정점색을 이웃 평균으로 펴는 반복 — 팔레트 스냅이 두 색 사이에서 떨리며 빗금이 되는 것을 막는다")
    ap.add_argument("--preview", action="store_true", help="<name>.preview.png(정면·옆·위 렌더)도 쓴다")
    args = ap.parse_args()
    if args.scene:
        d = os.path.join(args.src, args.scene)
        jobs = sorted((os.path.join(d, f), f"{args.scene}-{f.split('.')[0]}") for f in os.listdir(d) if f.endswith(".r.png"))
    elif args.image:
        jobs = [(args.image, args.name or os.path.splitext(os.path.basename(args.image))[0])]
    else:
        ap.error("image 또는 --scene")
    os.makedirs(args.out, exist_ok=True)

    t = time.time()
    model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(args.chunk_size)
    model.to(args.device)
    print(f"model ready ({args.device}) {time.time() - t:.1f}s")

    entries = {}
    for image_path, name in jobs:
        print(f"▶ {name} ← {image_path}")
        image = load_input(image_path, args.foreground_ratio)
        t = time.time()
        with torch.no_grad():
            codes = model([image], device=args.device)
        mesh = model.extract_mesh(codes, True, resolution=args.mc_resolution)[0]
        # 면 방향: 부피가 음수면 안팎이 뒤집힌 것 — three.js FrontSide에서 속이 보인다
        if mesh.volume < 0:
            mesh.invert()
        raw = len(mesh.faces)
        mesh = tidy(mesh, args.smooth, args.faces, args.color_smooth)
        mesh = to_stage(mesh, args.pitch, args.yaw)
        out = os.path.join(args.out, f"{name}.glb")
        mesh.export(out)
        print(f"✓ {out} ({os.path.getsize(out) // 1024} KB, {raw} → {len(mesh.faces)} tris, {time.time() - t:.1f}s)")
        if args.preview:
            preview(mesh, os.path.join(args.out, f"{name}.preview.png"))
        entries[name.split("-")[-1]] = {"url": f"/assets/models/{name}.glb"}
    if args.scene:
        import json
        print(json.dumps({"props": {args.scene: entries}}, ensure_ascii=False))


def to_stage(mesh, pitch, yaw):
    """TripoSR 좌표(x 카메라 쪽·y 오른쪽·z 위, 입력 카메라 기준 프레임)를 무대 좌표(y 위·+z 앞)로.
    출력은 입력 카메라의 프레임이라 카메라가 pitch만큼 내려다봤으면 물체가 그만큼 카메라 쪽으로 기울어 있고(Tripo 웹에서
    '상판이 기울어져' 나온 그것), yaw만큼 돌아 있다. 둘을 되돌린 뒤 축을 (x,y,z) → (y,z,x)로 바꾼다(회전, 거울 아님)."""
    import trimesh

    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-pitch), [0, 1, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-yaw), [0, 0, 1]))
    P = np.eye(4)
    P[:3, :3] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
    mesh.apply_transform(P)
    return mesh


def tidy(mesh, smooth, faces, color_smooth):
    """생성 메시 정리: 부스러기 제거 → 타우빈 스무딩 → quadric 데시메이션 → 정점색 펴기.
    데시메이션은 정점색을 버리니 원본에서 가장 가까운 정점의 색을 다시 입힌다(잉크 외곽선과 팔레트 양자화가 뒤에 오니 충분하다).
    색 펴기는 데시메이션 뒤(정점이 적어 빠르다): 이웃 평균을 반복해 TripoSR의 얼룩진 색 필드를 넓은 단색 영역으로 만든다."""
    import trimesh
    from scipy.spatial import cKDTree
    from scipy import sparse

    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        big = max(parts, key=lambda m: len(m.faces))
        # 큰 덩어리의 1 % 미만인 조각만 버린다 (컵·접시처럼 떨어진 부품은 남긴다)
        keep = [m for m in parts if len(m.faces) >= len(big.faces) * 0.01]
        mesh = trimesh.util.concatenate(keep)
    colors = mesh.visual.vertex_colors.copy()
    verts0 = mesh.vertices.copy()
    if smooth > 0:
        trimesh.smoothing.filter_taubin(mesh, iterations=smooth)
    if faces and len(mesh.faces) > faces:
        import fast_simplification

        v, f = fast_simplification.simplify(mesh.vertices, mesh.faces, target_count=faces)
        _, idx = cKDTree(verts0).query(v)
        mesh = trimesh.Trimesh(vertices=v, faces=f, vertex_colors=colors[idx], process=False)
    if color_smooth > 0:
        n = len(mesh.vertices)
        e = mesh.edges_unique
        A = sparse.coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
        A = A + sparse.eye(n)
        A = sparse.diags(1.0 / np.asarray(A.sum(axis=1)).ravel()) @ A
        c = mesh.visual.vertex_colors[:, :3].astype(np.float64)
        for _ in range(color_smooth):
            c = A @ c
        mesh.visual.vertex_colors = np.c_[c, np.full(n, 255)].astype(np.uint8)
    return mesh


def preview(mesh, path):
    """정면(+z에서)·옆(+x에서)·위(+y에서) 세 장을 한 줄로 — 회전 보정(assets.json rotate)을 정할 때 본다."""
    import trimesh

    tiles = []
    for name, rot in (("front", (0, 0)), ("side", (0, 90)), ("top", (-90, 0))):   # y 위 기준: 정면(+z에서)·옆·위
        m = mesh.copy()
        m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rot[1]), [0, 1, 0]))
        m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(rot[0]), [1, 0, 0]))
        tiles.append(np.array(render_flat(m)))
    Image.fromarray(np.concatenate(tiles, axis=1)).save(path)
    print(f"✓ {path}")


def render_flat(mesh, size=256):
    """카메라 없이 정점색을 정사영으로 뿌린 싼 렌더 (깊이 정렬만) — 모양·방향 확인용."""
    v = mesh.vertices
    c = mesh.visual.vertex_colors[:, :3] if mesh.visual.kind == "vertex" else np.full((len(v), 3), 200)
    lo, hi = v.min(0), v.max(0)
    s = (size - 8) / max(hi - lo)
    p = (v - (lo + hi) / 2) * s + size / 2
    img = np.full((size, size, 3), 255, np.uint8)
    order = np.argsort(p[:, 2])  # 먼 것부터
    for i in order:
        x, y = int(p[i, 0]), int(size - p[i, 1])
        if 0 <= x < size and 0 <= y < size:
            img[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = c[i]
    return Image.fromarray(img)


if __name__ == "__main__":
    main()
