"""2차: 얼굴 타이트 크롭 + 스타일을 약하게 준 캐리커처(C) → 2단계 모모화(D), 그리고 8스텝 치비(E)."""
import glob, time
from pathlib import Path
from PIL import Image, ImageDraw
T = Path('/Users/foxisdog/.claude/jobs/3974294b/tmp'); OUT = T / 'out2'; OUT.mkdir(exist_ok=True); REF = T / 'momo-ref.png'
photos = []
for p in sorted(glob.glob(str(T / 'photos' / '*.jpg'))):
    im = Image.open(p).convert('RGB'); w, h = im.size
    # 얼굴 타이트 크롭: 가로 가운데 60%, 세로 위 8%~53%  (공식 초상은 얼굴이 위쪽 가운데)
    s = int(min(w, h) * 0.55); cx = w // 2; y0 = int(h * 0.06)
    im = im.crop((cx - s // 2, y0, cx + s // 2, y0 + s)).resize((512, 512), Image.LANCZOS)
    q = str(OUT / (Path(p).stem + '.face.png')); im.save(q); photos.append(q)
KEEP = "keep the likeness: the same face shape, hairstyle and hair length, hair color, skin tone, eyewear exactly as in the photo (no glasses if the photo has none), facial hair exactly as in the photo, and the outfit color"
P_C = f"Turn the photo into a flat cartoon caricature portrait of the same person, head and shoulders, thick dark outline, simple shapes, soft pastel colors, no shading, plain white background. {KEEP}."
P_D = ("Redraw the cartoon person from the first image as a mascot in exactly the art style and body proportions of the second image (huge round head, tiny body, thick outline, big round dot eyes with highlights, pink blush cheeks), "
       "keeping the first image's hairstyle, hair length, hair color, skin tone, eyewear, facial hair and outfit color, front-facing, whole figure centered, plain white background")
P_E = (f"Redraw the person from the photo as a cute chibi mascot in flat vector cartoon style: huge round head, tiny body, thick dark outline, big round dot eyes with highlights, pink blush cheeks, small smile, pastel colors. {KEEP}. "
       "front-facing, whole figure centered, plain white background")
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants.edit.flux2_klein_edit import Flux2KleinEdit
engine = Flux2KleinEdit(model_config=ModelConfig.from_name('flux2-klein-4b'), model_path='mflux-community/flux2-klein-4b-mflux-q8')
def gen(prompt, paths, out, steps=4):
    if out.exists(): return
    t = time.perf_counter()
    o = engine.generate_image(seed=7, prompt=prompt, num_inference_steps=steps, width=512, height=512, image_paths=[str(x) for x in paths], guidance=1.0)
    getattr(o, 'image', o).convert('RGB').save(out); print(f'{out.name} {time.perf_counter()-t:.1f}s', flush=True)
for p in photos:
    n = Path(p).stem.split('.')[0]
    gen(P_C, [p], OUT / f'{n}-C.png')
    gen(P_D, [OUT / f'{n}-C.png', REF], OUT / f'{n}-D.png')
    gen(P_E, [p], OUT / f'{n}-E.png', steps=8)
cols = ['face', 'C', 'D', 'E']; S = 300; pad = 8
sheet = Image.new('RGB', (pad + len(cols) * (S + pad), pad + len(photos) * (S + pad)), 'white'); d = ImageDraw.Draw(sheet)
for r, p in enumerate(photos):
    n = Path(p).stem.split('.')[0]
    for c, k in enumerate(cols):
        f = p if k == 'face' else OUT / f'{n}-{k}.png'
        if not Path(f).exists(): continue
        x, y = pad + c * (S + pad), pad + r * (S + pad)
        sheet.paste(Image.open(f).convert('RGB').resize((S, S)), (x, y)); d.text((x + 6, y + 4), f'{n} {k}', fill='red')
sheet.save(OUT / 'sheet2.png'); print('sheet done', flush=True)
