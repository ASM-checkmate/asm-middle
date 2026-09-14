# 3D 캐릭터 스파이크 스크립트 (2026-09-14)

랩: `?lab=vrm`(방 + 몸 + 걷기), `?lab=look3d`(열세 칸 → 3D 도형), `?lab=face`(ICT 머리 + 축·표정·색·눈썹·머리카락).
결론과 흐름은 `docs/adr/` 초안 예정. 모델 파일은 전부 gitignore — 아래 순서로 다시 만든다.

## 준비
- Blender 5.x (`brew install --cask blender`), 헤드리스로만 쓴다.
- 피팅용 파이썬: `uv venv fitenv -p 3.12 && uv pip install --python fitenv/bin/python "mediapipe<1" numpy scipy pillow`
  (mediapipe 1.0.x 는 macOS 에서 Metal 크래시). 모델: `face_landmarker.task` (Google 스토리지, float16/1).
- ICT FaceKit(MIT): `FaceXModel/generic_neutral_mesh.obj`, `vertex_indices.json`, `identity000~019.obj`, 표정 obj 16개 → `<ict>/`.
- Quaternius Ultimate Modular Men Pack(CC0, quaternius.com 에서 손으로 다운로드) → `public/quat/Ultimate Modular Men- Feb 2022/`.
- 사진: `<face>/{id}.jpg` (정면, 긴 변 512+). 공개 초상은 Wikimedia Commons.

## 순서
1. `blender -b --python build.py -- <ict> <out>` → `head.glb`, `head-chibi.glb`, `landmarks.json`, 축·표정 확인 렌더.
   재질 skin·sclera·iris·lips·cornea, 셰이프 키 36, 목 자르기·좁히기 포함. → `public/dev-look3d/ict/`
2. `blender -b --python hair.py -- <ict> public/dev-look3d/hair` → 두피 껍질 머리카락 `hair-{buzz,short,bowl,bangs,sidepart}.glb` (머리와 같은 셰이프 키).
3. 랜드마크: 사진마다 MediaPipe 로 `landmarks.json` (fit.py 상단 주석의 스니펫), 그다음 `fitenv/bin/python fit.py` → 축 값·표정, `colors.py` → 피부·홍채·입술·눈썹 → `weights.json` → `public/dev-look3d/ict/`.
4. (선택) `facegen.py`: Qwen-Image-Edit 로 얼굴 초상 생성 (A2A comic venv, 장당 ~5분). 범주 조립보다 닮지만 데칼로 쓰면 왜곡 — 보조 실험.
5. 스크린샷: `node scripts/vrm-still.mjs <url> <out.png> [night 0|1] "[x,z,'pose']"`, `node scripts/vrm-seq.mjs <url> <prefix> "x,z;x,z" [frames] [ms]`.

## 다른 스크립트
- `make-base.py`: Blender Human Base Meshes(CC0) 몸을 치비화 + 셰이프 키 → `base.glb` (look3d 랩의 조각 몸).
- `hair/conv.py`, `hair/extract.py`: Quaternius 머리카락 조각 변환·추출 (전부 불합격, 기록용).
