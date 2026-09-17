# 아사히 슈퍼드라이 캔을 그려(PIL) 데모 1편의 생성 사진·카메라 배경의 소주병 자리에 얹는다 (ADR-0032 제품 배치).
#   uv run --with pillow scripts/asahi-asset.py
# 만드는 것: public/demo/asahi-can.png(캔 하나, 투명 배경) · public/demo/pocha-asahi.png(pocha.png의 소주병 → 아사히 캔)
#          · public/backdrops/busan/samjin-table.webp(카메라 배경의 소주병 → 아사히 캔 둘) — 원본은 art/backdrops/samjin-table.orig.webp에서 읽는다 (여러 번 돌려도 겹치지 않게)
# 소주병 자리는 두 그림에서 손으로 잰 값 — 그림이 바뀌면 BOTTLE을 다시 잰다.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RED = (200, 16, 46, 255)
FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'
FONT_REG = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', size)


def draw_can(w: int, h: int) -> Image.Image:
    """은색 캔 한 개. 세로 그라데이션 + 흰 로고 띠 + 빨간 Asahi + SUPER DRY. 4배 크기로 그려 줄여서 선이 곱다."""
    S = 4
    W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(W * 0.18)
    # 몸통: 좌우로 밝기 변화(원통 느낌)
    body = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for x in range(W):
        t = x / (W - 1)
        # 왼쪽 어둡게 → 1/3 지점 가장 밝게 → 오른쪽 어둡게
        k = 1 - abs(t - 0.35) * 1.6
        g = int(150 + 95 * max(0.0, min(1.0, k)))
        bd.line([(x, 0), (x, H)], fill=(g, g + 4, g + 10, 255))
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=r, fill=255)
    im.paste(body, (0, 0), mask)
    # 윗단·아랫단 (어두운 띠)
    d.rounded_rectangle([0, 0, W - 1, int(H * 0.06)], radius=r // 2, fill=(120, 126, 136, 255))
    d.rectangle([0, int(H * 0.04), W - 1, int(H * 0.075)], fill=(165, 172, 182, 255))
    d.rectangle([0, int(H * 0.93), W - 1, H - 1], fill=(120, 126, 136, 255))
    # 흰 로고 띠 (가운데)
    top, bot = int(H * 0.30), int(H * 0.62)
    d.rectangle([0, top, W - 1, bot], fill=(250, 251, 253, 255))
    d.rectangle([0, top, W - 1, top + S], fill=(200, 205, 212, 255))
    d.rectangle([0, bot - S, W - 1, bot], fill=(200, 205, 212, 255))
    # Asahi 글자 — 캔 너비의 88% 안에 들어가게 크기를 줄인다 (기울인 글자라 폭이 넓다)
    size = int(W * 0.40)
    txt = 'Asahi'
    while True:
        f = font(FONT_BOLD, size)
        bb = d.textbbox((0, 0), txt, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= W * 0.88 or size < 8: break
        size -= 2
    d.text(((W - tw) / 2 - bb[0], top + (bot - top - th) / 2 - bb[1] - S * 2), txt, font=f, fill=RED)
    f2 = font(FONT_REG, int(W * 0.13))
    txt2 = 'SUPER DRY'
    bb2 = d.textbbox((0, 0), txt2, font=f2)
    d.text(((W - (bb2[2] - bb2[0])) / 2 - bb2[0], bot - (bb2[3] - bb2[1]) - S * 5 - bb2[1]), txt2, font=f2, fill=(40, 44, 52, 255))
    # 아래 은색 부분에 작은 빨간 줄 (실제 캔의 빨간 띠 느낌)
    d.rectangle([0, int(H * 0.66), W - 1, int(H * 0.675)], fill=RED)
    # 하이라이트 선
    d.line([(int(W * 0.22), int(H * 0.09)), (int(W * 0.22), int(H * 0.91))], fill=(255, 255, 255, 120), width=S * 2)
    # 잉크 테두리 (배경 그림의 선 두께와 맞춘다)
    outline = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(outline).rounded_rectangle([0, 0, W - 1, H - 1], radius=r, outline=(34, 30, 40, 255), width=S * 2)
    im.alpha_composite(outline)
    return im.resize((w, h), Image.LANCZOS)


def paste_can(im: Image.Image, box: tuple[int, int, int, int], shadow: bool = True) -> None:
    """box=(left, top, right, bottom)에 캔을 얹는다. 아래엔 옅은 그림자."""
    l, t, r, b = box
    can = draw_can(r - l, b - t)
    if shadow:
        sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([l - 6, b - 8, r + 6, b + 8], fill=(0, 0, 0, 110))
        sh = sh.filter(ImageFilter.GaussianBlur(4))
        im.alpha_composite(sh)
    im.alpha_composite(can, (l, t))


def main() -> None:
    demo = ROOT / 'public' / 'demo'
    # 1) 캔 한 개 (투명) — 다른 데서 쓸 수 있게
    draw_can(180, 440).save(demo / 'asahi-can.png')

    # 2) 생성 사진: 소주병(가운데, 두 손 사이) → 아사히 캔 하나. 병 목까지 덮이게 캔을 병보다 키운다
    src = Image.open(demo / 'pocha.png').convert('RGBA')
    paste_can(src, (312, 552, 358, 664))
    src.save(demo / 'pocha-asahi.png')

    # 3) 카메라 배경: 소주병 → 아사히 캔 둘 (나란히). 잔은 그대로
    bd_path = ROOT / 'public' / 'backdrops' / 'busan' / 'samjin-table.webp'
    bd = Image.open(ROOT / 'art' / 'backdrops' / 'samjin-table.orig.webp').convert('RGBA')
    paste_can(bd, (314, 556, 356, 664))
    paste_can(bd, (352, 572, 388, 664))
    bd.convert('RGB').save(bd_path, 'WEBP', quality=90)
    print('ok:', demo / 'asahi-can.png', demo / 'pocha-asahi.png', bd_path)


if __name__ == '__main__':
    main()
