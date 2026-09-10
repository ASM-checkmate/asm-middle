import glob, time
from pathlib import Path
from PIL import Image, ImageDraw
T = Path('/Users/foxisdog/.claude/jobs/3974294b/tmp'); OUT = T / 'out3'; OUT.mkdir(exist_ok=True)
photos = [p for p in sorted(glob.glob(str(T / 'out2' / '*.face.png'))) if 'jackson' not in p]
KEEP = "Keep the likeness: the same face shape, hairstyle and hair length, hair color, skin tone, eyebrows, nose, mouth and outfit color. Add nothing that is not in the photo."
P_C2 = f"Turn the photo into a flat cartoon caricature portrait of the same person, head and shoulders, thick dark outline, simple shapes, soft pastel colors, no shading, plain white background. {KEEP}"
P_F = (f"Turn the photo into a cute cartoon character of the same person: full body, the head about half of the figure's height, thick dark brown outline, flat pastel colors, no shading, small pink blush on the cheeks, "
       f"but the face is still the person's own face simplified (their real eye shape, eyebrows, nose, mouth). {KEEP} Front-facing, whole figure centered, plain white background")
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants.edit.flux2_klein_edit import Flux2KleinEdit
engine = Flux2KleinEdit(model_config=ModelConfig.from_name('flux2-klein-4b'), model_path='mflux-community/flux2-klein-4b-mflux-q8')
def gen(prompt, paths, out, seed=7):
    if out.exists(): return
    t = time.perf_counter()
    o = engine.generate_image(seed=seed, prompt=prompt, num_inference_steps=4, width=512, height=512, image_paths=[str(x) for x in paths], guidance=1.0)
    getattr(o, 'image', o).convert('RGB').save(out); print(f'{out.name} {time.perf_counter()-t:.1f}s', flush=True)
for p in photos:
    n = Path(p).stem.split('.')[0]
    gen(P_C2, [p], OUT / f'{n}-C2.png'); gen(P_F, [p], OUT / f'{n}-F.png'); gen(P_F, [p], OUT / f'{n}-F2.png', seed=99)
cols = ['face', 'C2', 'F', 'F2']; S = 300; pad = 8
sheet = Image.new('RGB', (pad + len(cols) * (S + pad), pad + len(photos) * (S + pad)), 'white'); d = ImageDraw.Draw(sheet)
for r, p in enumerate(photos):
    n = Path(p).stem.split('.')[0]
    for c, k in enumerate(cols):
        f = p if k == 'face' else OUT / f'{n}-{k}.png'
        x, y = pad + c * (S + pad), pad + r * (S + pad)
        sheet.paste(Image.open(f).convert('RGB').resize((S, S)), (x, y)); d.text((x + 6, y + 4), f'{n} {k}', fill='red')
sheet.save(OUT / 'sheet3.png'); print('sheet done', flush=True)
