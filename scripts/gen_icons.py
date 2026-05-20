"""Generate PWA icons (PNG) for the poker helper app.

Run from repo root:  python3 scripts/gen_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"
ICON_DIR.mkdir(exist_ok=True)

BG = (15, 84, 56)        # deep poker-table green
FG = (245, 240, 225)     # warm off-white

def make_icon(size: int, path: Path) -> None:
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # outer rounded border
    pad = size // 14
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=size // 8,
        outline=FG,
        width=max(2, size // 64),
    )

    # spade glyph centered
    glyph = "♠"  # ♠
    # find largest font size that fits
    target_h = int(size * 0.62)
    font = None
    for candidate in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(candidate).exists():
            font = ImageFont.truetype(candidate, target_h)
            break
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), glyph, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) // 2 - bbox[0]
    y = (size - h) // 2 - bbox[1]
    draw.text((x, y), glyph, fill=FG, font=font)

    img.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)}  ({size}x{size})")


def main() -> None:
    make_icon(192, ICON_DIR / "icon-192.png")
    make_icon(512, ICON_DIR / "icon-512.png")
    make_icon(180, ICON_DIR / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
