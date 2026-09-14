"""사진 → 우리 그림체 얼굴 초상 (Qwen-Image-Edit-2511 q4, mflux). 얼굴 데칼용: 정면, 머리카락 포함 머리만, 초록 배경."""
import sys, time
from pathlib import Path
from PIL import Image
import numpy as np
SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(exist_ok=True, parents=True)
STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 20; SIZE = int(sys.argv[4]) if len(sys.argv) > 4 else 768
KEEP = "Keep the likeness so the person is instantly recognizable: the same face shape, hairline and hairstyle, hair color, skin tone, eyebrows, eye shape, nose, mouth, wrinkles, glasses only if worn. Add nothing that is not in the photo."
PROMPT = (f"Turn the photo into a flat cartoon caricature of the same person's head, front-facing, looking straight at the camera, centered, the head with hair filling most of the frame, no neck below the chin, no shoulders, "
          f"thick dark brown outline, flat soft pastel colors, no shading, small pink blush on the cheeks, on a flat solid pure green background (#00FF00). {KEEP}")
from mflux.models.common.config import ModelConfig
from mflux.models.qwen.variants.edit.qwen_image_edit import QwenImageEdit
t0 = time.perf_counter()
engine = QwenImageEdit(model_config=ModelConfig.from_name('qwen-edit-2511'), model_path='mflux-community/qwen-image-edit-2511-mflux-q4')
print(f'load {time.perf_counter()-t0:.0f}s', flush=True)
def key(img):
    a = np.asarray(img.convert('RGB')).astype(np.float32); g = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    alpha = np.clip((110 - g) / 70.0, 0, 1); rgb = a.copy(); e = (alpha > 0) & (alpha < 1)
    rgb[..., 1] = np.where(e, np.minimum(rgb[..., 1], (rgb[..., 0] + rgb[..., 2]) / 2 + 8), rgb[..., 1])
    return Image.fromarray(np.concatenate([np.clip(rgb, 0, 255), (alpha * 255)[..., None]], axis=2).astype(np.uint8), 'RGBA')
for p in sorted(SRC.glob('*.jpg')):
    out = OUT / f'{p.stem}.png'
    if out.exists(): continue
    t = time.perf_counter()
    o = engine.generate_image(seed=7, prompt=PROMPT, num_inference_steps=STEPS, width=SIZE, height=SIZE, image_paths=[str(p)], guidance=4.0, negative_prompt="blurry, photo, realistic, text, watermark, shoulders, body")
    img = getattr(o, 'image', o).convert('RGB'); img.save(OUT / f'{p.stem}.raw.png'); key(img).save(out)
    print(f'{out.name} {time.perf_counter()-t:.0f}s', flush=True)
print('DONE', flush=True)
