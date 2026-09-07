# 낙서 인식 평가 (ADR-0007)

Quick, Draw! 낙서를 앱 스타일로 다시 그려 로컬 비전 모델이 얼마나 알아보는지 잰다. Ollama가 떠 있어야 한다.

```bash
# 1. 카테고리별 앞부분만 받는다 (한 파일에 수십만 장이라 전부 받을 필요 없다)
mkdir -p /tmp/qd && cd /tmp/qd
for c in "coffee cup" book bicycle; do curl -s -r 0-200000 "https://storage.googleapis.com/quickdraw_dataset/full/simplified/${c// /%20}.ndjson" -o "${c// /_}.ndjson"; done
# 2. 앱 스타일(코랄 붓, 종이 바탕, 240px)로 렌더 — 헤드리스 크롬을 쓴다 (CHROME 환경변수)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/sketch-eval/qd-render.mjs /tmp/qd /tmp/qd-png 10
# 3. 모델별 정확도·시간 (PROMPT=ko 로 한국어 프롬프트, LIMIT=40 으로 맛보기)
node scripts/sketch-eval/qd-eval.mjs /tmp/qd-png qwen3.5:9b qwen3.8:27b
```

2026-09-07 결과는 `docs/adr/0007-sketch-vision.md`의 표.
