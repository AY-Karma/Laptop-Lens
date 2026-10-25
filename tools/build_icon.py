"""Rebuild the original Laptop Lens vector mark and Windows icon sizes."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
INK, SHELL, SIGNAL = '#17191f', '#cbd0db', '#929aff'
SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <title>Laptop Lens</title>
  <rect x="10" y="9" width="44" height="36" rx="6" fill="{SHELL}"/>
  <rect x="14" y="13" width="36" height="28" rx="3" fill="{INK}"/>
  <path d="M19 30H25L29 22L34 33L39 25H45" fill="none" stroke="{SIGNAL}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10 43H54L60 51V52L56 55H8L4 52V51Z" fill="{SHELL}"/>
  <rect x="26" y="46" width="12" height="2" rx="1" fill="{INK}"/>
</svg>
'''


def raster(size):
    # Supersampling keeps the exact geometric construction crisp at taskbar size.
    scale = size * 4 / 64
    image = Image.new('RGBA', (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    def box(values): return tuple(round(v * scale) for v in values)
    draw.rounded_rectangle(box((10, 9, 54, 45)), radius=round(6 * scale), fill=SHELL)
    draw.rounded_rectangle(box((14, 13, 50, 41)), radius=round(3 * scale), fill=INK)
    points = [(19, 30), (25, 30), (29, 22), (34, 33), (39, 25), (45, 25)]
    width = round(3.5 * scale)
    draw.line([box(point) for point in points], fill=SIGNAL, width=width, joint='curve')
    radius = width / 2
    for x, y in points:
        draw.ellipse((round(x * scale - radius), round(y * scale - radius), round(x * scale + radius), round(y * scale + radius)), fill=SIGNAL)
    draw.polygon([box(p) for p in ((10, 43), (54, 43), (60, 51), (60, 52), (56, 55), (8, 55), (4, 52), (4, 51))], fill=SHELL)
    draw.rounded_rectangle(box((26, 46, 38, 48)), radius=round(scale), fill=INK)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    (ROOT / 'assets/laptop-lens.svg').write_text(SVG, encoding='utf-8')
    raster(1024).save(ROOT / 'assets/laptop-lens-master.png')
    raster(256).save(ROOT / 'public/laptop-lens.png')
    sizes = (16, 24, 32, 48, 64, 128, 256)
    images = [raster(size) for size in sizes]
    images[-1].save(ROOT / 'assets/laptop-lens.ico', format='ICO',
                    sizes=[(size, size) for size in sizes], append_images=images[:-1])


if __name__ == '__main__':
    main()
