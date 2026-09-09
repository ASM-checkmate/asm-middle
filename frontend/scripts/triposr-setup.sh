#!/usr/bin/env bash
# TripoSR(MIT, Tripo·Stability) 로컬 설치 — Apple 실리콘에서 이미지→3D (ADR-0014 개정 8).
# frontend/.triposr/ 아래에 venv(uv, Python 3.12)와 TripoSR 소스를 둔다. 재실행하면 있는 것은 건너뛴다.
# Usage: scripts/triposr-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=.triposr
TRIPOSR_REF=${TRIPOSR_REF:-main}
mkdir -p "$ROOT"
command -v uv >/dev/null || { echo "uv가 필요하다: brew install uv"; exit 1; }
[ -d "$ROOT/venv" ] || uv venv --python 3.12 "$ROOT/venv"
[ -d "$ROOT/TripoSR" ] || git clone --depth 1 --branch "$TRIPOSR_REF" https://github.com/VAST-AI-Research/TripoSR.git "$ROOT/TripoSR"
# torchmcubes(C++ 빌드)는 안 깐다 — scripts/triposr.py가 scikit-image의 marching cubes로 바꿔 끼운다. rembg도 안 깐다(입력 PNG는 이미 투명 배경).
VIRTUAL_ENV="$PWD/$ROOT/venv" uv pip install torch torchvision "numpy<2" omegaconf==2.3.0 Pillow einops==0.7.0 \
  transformers==4.35.0 trimesh huggingface-hub scikit-image scipy fast-simplification
echo "ok: $ROOT/venv ($("$ROOT/venv/bin/python" -c 'import torch;print("torch",torch.__version__,"mps",torch.backends.mps.is_available())'))"
