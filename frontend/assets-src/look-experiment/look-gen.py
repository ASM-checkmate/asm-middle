"""사진 → 우리 그림체 캐릭터 실험. FLUX.2 klein 4B edit, 참조 = [사진, 모모]."""
import glob, os, sys, time
from pathlib import Path
from PIL import Image, ImageDraw

T = Path('/Users/foxisdog/.claude/jobs/3974294b/tmp')
OUT = T / 'out'; OUT.mkdir(exist_ok=True)
REF = T / 'momo-ref.png'
src = '/Users/foxisdog/Projects/checkmate/asm-middle/frontend/assets-src/character/friend-idle.png'
im = Image.open(src).convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
bg.convert('RGB').save(REF)
photos = []
for p in sorted(glob.glob(str(T / 'photos' / '*.jpg'))):
    im = Image.open(p).convert('RGB'); w, h = im.size; s = min(w, h)
    im = im.crop(((w - s) // 2, 0, (w - s) // 2 + s, s)).resize((512, 512), Image.LANCZOS)
    q = p.replace('.jpg', '.512.png'); im.save(q); photos.append(q)

KEEP = ("keeping the person's recognizable features: face shape, hairstyle and hair length, hair color, skin tone, "
        "eyebrows, glasses if any, facial hair if any, and the outfit color")
STYLE = ("cute chibi mascot in flat vector cartoon style: a huge round head about two thirds of the whole figure, tiny body, "
         "thick dark brown outline, simple large round dot eyes with white highlights, pink blush circles on the cheeks, "
         "a small smile, soft pastel colors, no gradients")
PROMPTS = {
    'A': f"Redraw the person from the first image as a {STYLE}, {KEEP}, front-facing, whole figure centered, isolated on a plain pure white background",
    'B': (f"Redraw the person from the first image as a character drawn in exactly the same art style, proportions and line quality as the mascot in the second image "
          f"(huge round head, tiny body, thick outline, dot eyes, blush cheeks), {KEEP}, front-facing, whole figure centered, isolated on a plain pure white background"),
}
only = sys.argv[1:] or list(PROMPTS)

from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants.edit.flux2_klein_edit import Flux2KleinEdit
repo = 'mflux-community/flux2-klein-4b-mflux-q8'
t0 = time.perf_counter()
engine = Flux2KleinEdit(model_config=ModelConfig.from_name('flux2-klein-4b'), model_path=repo)
print(f'load {time.perf_counter()-t0:.0f}s', flush=True)
for p in photos:
    name = Path(p).stem.split('.')[0]
    for k in only:
        o = OUT / f'{name}-{k}.png'
        if o.exists(): continue
        t1 = time.perf_counter()
        paths = [p] if k == 'A' else [p, str(REF)]
        out = engine.generate_image(seed=42, prompt=PROMPTS[k], num_inference_steps=4, width=512, height=512, image_paths=paths, guidance=1.0)
        getattr(out, 'image', out).convert('RGB').save(o)
        print(f'{o.name} {time.perf_counter()-t1:.1f}s', flush=True)

# contact sheet: 사진 | A | B
cols = ['photo'] + only; S = 320; pad = 8
sheet = Image.new('RGB', (pad + len(cols) * (S + pad), pad + len(photos) * (S + pad)), 'white')
d = ImageDraw.Draw(sheet)
for r, p in enumerate(photos):
    name = Path(p).stem.split('.')[0]
    for c, k in enumerate(cols):
        f = p if k == 'photo' else OUT / f'{name}-{k}.png'
        if not Path(f).exists(): continue
        im = Image.open(f).convert('RGB').resize((S, S))
        x, y = pad + c * (S + pad), pad + r * (S + pad)
        sheet.paste(im, (x, y)); d.text((x + 6, y + 4), f'{name} {k}', fill='red')
sheet.save(OUT / 'sheet.png'); print('sheet done')
