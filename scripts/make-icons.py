#!/usr/bin/env python3
"""One-command icon build: `npm run icons`. Source of truth: brand/icon/ (final "Summit Red" icon, copied from the PM's brand folder).
Writes the web icons, the iOS AppIcon + splash (via @capacitor/assets) and the Android launcher icons
(adaptive foreground/background/monochrome, legacy square/round). Needs Pillow."""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'brand/icon'
PAPER = (0xF7, 0xF7, 0xF5)
store = Image.open(SRC / 'ridgeline-icon-1024-appstore.png').convert('RGB')
fg, bg, mono = (Image.open(SRC / f'android/ic_launcher_{n}.png') for n in ('foreground', 'background', 'monochrome'))
fg, mono = fg.convert('RGBA'), mono.convert('RGBA')
bg = bg.convert('RGB')

def save(im, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)

# Web / PWA
web = ROOT / 'public/icons'
for s, n in ((192, 'icon-192.png'), (512, 'icon-512.png')):
    save(store, web / n, s)
save(store, ROOT / 'public/apple-touch-icon.png', 180)  # linked from index.html at the site root
save(store, ROOT / 'public/favicon-32.png', 32)
store.resize((48, 48), Image.LANCZOS).save(ROOT / 'public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
mask = bg.convert('RGBA'); mask.alpha_composite(fg)  # adaptive art already keeps its content in the 66% safe zone
save(mask.convert('RGB'), web / 'icon-512-maskable.png', 512)

# iOS (AppIcon 1024 + splash) through @capacitor/assets; the splash is plain paper colour (static, no animation)
assets = ROOT / 'assets'; assets.mkdir(exist_ok=True)
store.save(assets / 'icon-only.png')
Image.new('RGB', (2732, 2732), PAPER).save(assets / 'splash.png')
Image.new('RGB', (2732, 2732), (0x11, 0x11, 0x11)).save(assets / 'splash-dark.png')
subprocess.run(['npx', 'capacitor-assets', 'generate', '--ios', '--android', '--iconBackgroundColor', '#F7F7F5',
                '--splashBackgroundColor', '#F7F7F5', '--splashBackgroundColorDark', '#111111'], cwd=ROOT, check=True)

# Android: replace the generated launcher icons with the adaptive set (with the monochrome layer for themed icons)
res = ROOT / 'android/app/src/main/res'
for d, legacy, layer in (('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)):
    m = res / f'mipmap-{d}'
    save(store, m / 'ic_launcher.png', legacy)
    circ = Image.new('L', (legacy * 4,) * 2, 0); ImageDraw.Draw(circ).ellipse((0, 0, legacy * 4 - 1, legacy * 4 - 1), fill=255)
    rnd = store.resize((legacy, legacy), Image.LANCZOS).convert('RGBA'); rnd.putalpha(circ.resize((legacy, legacy), Image.LANCZOS))
    rnd.save(m / 'ic_launcher_round.png', optimize=True)
    save(fg, m / 'ic_launcher_foreground.png', layer)
    save(bg, m / 'ic_launcher_background.png', layer)
    save(mono, m / 'ic_launcher_monochrome.png', layer)
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    (res / 'mipmap-anydpi-v26' / n).write_text(adaptive)
print('icons done')
