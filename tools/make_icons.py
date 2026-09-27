# Draws the app icons in icons/ (a Trinity-style panel: green LCD strip over a keyboard). Needs Pillow.
# Usage: python3 tools/make_icons.py
import os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL, LCD, INK, WHITE, BLACK = (42, 46, 50), (164, 227, 205), (23, 48, 41), (236, 238, 234), (17, 19, 21)

def icon(size, pad, rounded):
    S = size * 4  # draw large, then scale down for smooth edges
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.2 if rounded else 0, fill=PANEL)
    x0, x1 = S * pad, S * (1 - pad); w = x1 - x0
    d.rounded_rectangle([x0, S * (pad + 0.02), x1, S * (pad + 0.2)], radius=S * 0.03, fill=LCD)  # LCD
    d.rectangle([x0 + w * 0.08, S * (pad + 0.09), x0 + w * 0.6, S * (pad + 0.12)], fill=INK)
    top, bot, n = S * (pad + 0.28), S * (1 - pad), 7  # keyboard: 7 white keys, 5 black
    kw = w / n
    for i in range(n): d.rectangle([x0 + i * kw + S * 0.004, top, x0 + (i + 1) * kw - S * 0.004, bot], fill=WHITE)
    for i in [1, 2, 4, 5, 6]: d.rectangle([x0 + i * kw - kw * 0.3, top, x0 + i * kw + kw * 0.3, top + (bot - top) * 0.6], fill=BLACK)
    return im.resize((size, size), Image.LANCZOS)

for name, size, pad, rounded in [('icon-192.png', 192, 0.14, True), ('icon-512.png', 512, 0.14, True),
                                 ('icon-maskable-512.png', 512, 0.22, False), ('apple-touch-icon.png', 180, 0.14, False)]:
    icon(size, pad, rounded).save(os.path.join(ROOT, 'icons', name), optimize=True)
    print('icons/' + name)
