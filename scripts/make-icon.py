"""
waxyct's app icon, drawn procedurally (no images in, no AI): "the wheel".
EDENA's sibling. Its icon (edena/scripts/make-icon.py, "the eye of the deep")
is rings stepping down into an abyss with one warm light; waxyct's is the
Loupedeck CT seen from above: three touch keys over the wheel. Same tile, same
gradient, same abyss disc and INK colours, so the two sit together in a
taskbar; the wheel is one flat ring (a control, not a descent) and the warm
peach is its pointer notch instead of a light.

    python scripts/make-icon.py   -> waxyct.ico (16-256), build/icon.png (512),
                                     build/icon-sheet.png, and the favicon
                                     inlined in ui/index.html

Each size is drawn at 4x and reduced, so edges are smooth; below 48 px the
keys and the ring grow, so it still reads at 16 px.
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

NIGHT = (20, 18, 29)        # INK.night, EDENA's tile top
DEEP = (11, 16, 22)         # its tile bottom
ABYSS_EDGE = (22, 52, 60)
ABYSS_CORE = (6, 8, 12)
SKY = (159, 212, 207)       # INK.sky: the wheel
PEACH = (239, 180, 154)     # INK.peach: the wheel's pointer
BONE = (241, 233, 218)      # INK.bone: the keys

ROOT = Path(__file__).resolve().parent.parent


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def draw(size: int) -> Image.Image:
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # the tile: EDENA's, a rounded square, night at the top, deeper at the bottom
    tile = Image.new("RGBA", (S, S))
    td = ImageDraw.Draw(tile)
    for y in range(S):
        td.line([(0, y), (S, y)], fill=lerp(NIGHT, DEEP, y / S) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=round(S * 0.22), fill=255)
    img.paste(tile, (0, 0), mask)
    d = ImageDraw.Draw(img)
    small = size < 48

    # the keys: three across the top, the CT's touch screen
    kw, gap, ky = S * (0.20 if small else 0.17), S * (0.05 if small else 0.055), S * (0.13 if small else 0.15)
    x0 = (S - (3 * kw + 2 * gap)) / 2
    for i in range(3):
        x = x0 + i * (kw + gap)
        d.rounded_rectangle([x, ky, x + kw, ky + kw], radius=round(S * 0.035), fill=BONE + (255,))

    # the wheel: the abyss disc (EDENA's), one flat ring round it
    cx, cy, R = S * 0.5, S * (0.66 if small else 0.64), S * (0.25 if small else 0.245)
    for i in range(40):
        t = i / 39
        r = R * (1 - t)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=lerp(ABYSS_EDGE, ABYSS_CORE, t ** 0.7) + (255,))
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=SKY + (255,), width=round(S * (0.075 if small else 0.05)))

    # the pointer: a warm notch inside the ring, with EDENA's soft glow
    pr, py = S * (0.05 if small else 0.036), cy - R * 0.55
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - pr * 2.2, py - pr * 2.2, cx + pr * 2.2, py + pr * 2.2], fill=PEACH + (90,))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.03)))
    ImageDraw.Draw(img).ellipse([cx - pr, py - pr, cx + pr, py + pr], fill=PEACH + (255,))

    # keep the tile's corners clean after the glow
    clip = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    clip.paste(img, (0, 0), mask)
    return clip.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    (ROOT / "build").mkdir(exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = {s: draw(s) for s in sizes}
    frames[256].save(ROOT / "waxyct.ico", sizes=[(s, s) for s in sizes], append_images=[frames[s] for s in sizes[:-1]])
    draw(512).save(ROOT / "build" / "icon.png")
    # the favicon: the window and its taskbar button; inline, so it needs no request and works offline
    buf = io.BytesIO()
    frames[64].save(buf, "PNG")
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    html = ROOT / "ui" / "index.html"
    text = re.sub(r'<link rel="icon"[^>]*>', f'<link rel="icon" type="image/png" href="{uri}">', html.read_text(encoding="utf-8"))
    with open(html, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    # a contact sheet, every size side by side (EDENA keeps one too)
    sheet = Image.new("RGBA", (sum(sizes) + 20 * len(sizes) + 532, 532), NIGHT + (255,))
    x = 10
    for s in sizes + [512]:
        im = frames.get(s) or draw(s)
        sheet.paste(im, (x, 266 - s // 2), im)
        x += s + 20
    sheet.save(ROOT / "build" / "icon-sheet.png")
    print("wrote waxyct.ico, build/icon.png, build/icon-sheet.png, favicon in ui/index.html")
