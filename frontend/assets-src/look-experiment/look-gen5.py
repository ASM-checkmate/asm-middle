"""4차: Qwen-Image-Edit-2511(q4)로 같은 사진. C2(캐리커처) · F(머리 반 비율) · G(모모 참조로 우리 그림체)."""
import glob, time, sys
from pathlib import Path
from PIL import Image, ImageDraw
T = Path('/Users/foxisdog/.claude/jobs/3974294b/tmp'); OUT = T / 'out5'; OUT.mkdir(exist_ok=True); REF = T / 'momo-ref.png'
photos = [p for p in sorted(glob.glob(str(T / 'out2' / '*.face.png'))) if any(k in p for k in ('barrett','sanders','obama'))]
KEEP = "Keep the likeness: the same face shape, hairstyle and hair length, hair color, skin tone, eyebrows, nose, mouth and outfit color. Add nothing that is not in the photo."
P = {
 'C2': f"Turn the photo into a flat cartoon caricature portrait of the same person, head and shoulders, thick dark outline, simple shapes, soft pastel colors, no shading, plain white background. {KEEP}",
 'F': (f"Turn the photo into a cute cartoon character of the same person: full body, the head about half of the figure's height, thick dark brown outline, flat pastel colors, no shading, small pink blush on the cheeks, "
       f"but the face is still the person's own face simplified (their real eye shape, eyebrows, nose, mouth). {KEEP} Front-facing, whole figure centered, plain white background"),
 'G': (f"Redraw the person in image 1 as a mascot in exactly the art style and body proportions of the character in image 2 (huge round head, tiny body, thick dark outline, big round dot eyes with white highlights, pink blush cheeks, flat colors). "
       f"The mascot must still be recognizably this person: same hairstyle and hair length, hair color, skin tone, eyebrows, glasses only if the person wears them, facial hair only if the person has it, and outfit color. Front-facing, whole figure centered, plain white background"),
}
STEPS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
from mflux.models.common.config import ModelConfig
from mflux.models.qwen.variants.edit.qwen_image_edit import QwenImageEdit
t0 = time.perf_counter()
engine = QwenImageEdit(model_config=ModelConfig.from_name('qwen-edit-2511'), model_path='mflux-community/qwen-image-edit-2511-mflux-q4')
print(f'load {time.perf_counter()-t0:.0f}s', flush=True)
def gen(prompt, paths, out):
    if out.exists(): return
    t = time.perf_counter()
    o = engine.generate_image(seed=7, prompt=prompt, num_inference_steps=STEPS, width=1024, height=1024, image_paths=[str(x) for x in paths], guidance=4.0,
                              negative_prompt="blurry, photo, realistic, text, watermark")
    getattr(o, 'image', o).convert('RGB').save(out); print(f'{out.name} {time.perf_counter()-t:.0f}s', flush=True)
for p in photos:
    n = Path(p).stem.split('.')[0]
    gen(P['C2'], [p], OUT / f'{n}-C2.png'); gen(P['F'], [p], OUT / f'{n}-F.png'); 
cols = ['face', 'C2', 'F']; S = 300; pad = 8
sheet = Image.new('RGB', (pad + len(cols) * (S + pad), pad + len(photos) * (S + pad)), 'white'); d = ImageDraw.Draw(sheet)
for r, p in enumerate(photos):
    n = Path(p).stem.split('.')[0]
    for c, k in enumerate(cols):
        f = p if k == 'face' else OUT / f'{n}-{k}.png'
        if not Path(f).exists(): continue
        x, y = pad + c * (S + pad), pad + r * (S + pad)
        sheet.paste(Image.open(f).convert('RGB').resize((S, S)), (x, y)); d.text((x + 6, y + 4), f'{n} {k}', fill='red')
sheet.save(OUT / 'sheet5.png'); print('sheet done', flush=True)
