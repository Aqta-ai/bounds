#!/usr/bin/env python3
"""Render synthetic clinical-note PNGs (clean + noisy) + ground-truth.txt
for the OCR accuracy harness. Mirrors the Calmara demo PDF content.

Output:
  /tmp/bounds-ocr-test/test-clean.png
  /tmp/bounds-ocr-test/test-noisy.png  (rotated 2deg + gaussian noise + jpeg compression)
  /tmp/bounds-ocr-test/ground-truth.txt
Run: python3 scripts/test-ocr-render.py
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = '/tmp/bounds-ocr-test'
os.makedirs(OUT_DIR, exist_ok=True)

LINES = [
    ('PATIENT CONSULTATION REPORT', 28),
    ('Calmara Mental Wellness Clinic', 22),
    ('', 0),
    ('Full name: Sophie Laurent', 20),
    ('Date of birth: 14.03.1982', 20),
    ('Email: sophie.laurent@gmail.com', 20),
    ('Mobile: +41 79 123 45 67', 20),
    ('IBAN: CH56 0483 5012 3456 7800 9', 20),
    ('', 0),
    ('Patient presents with generalised anxiety disorder.', 20),
    ('Sertraline 50 mg daily.', 20),
    ('Follow-up: 2026-04-12', 20),
]

def find_font(size):
    candidates = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/HelveticaNeue.ttc',
        '/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def render_clean():
    W, H = 1400, 900
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)
    y = 60
    for text, size in LINES:
        if not text:
            y += int(size * 0.6) if size else 18
            continue
        font = find_font(size)
        draw.text((80, y), text, font=font, fill=(20, 20, 20))
        y += int(size * 1.5)
    return img

def degrade(img):
    """Simulate a real-world phone photo: slight rotation, gaussian noise,
    JPEG compression at ~60% quality, and a small contrast hit."""
    # Rotate 2 degrees with white fill
    img = img.rotate(2, fillcolor='white', resample=Image.BICUBIC)
    # Gaussian noise
    pixels = img.load()
    W, H = img.size
    for _ in range(W * H // 30):
        x = random.randint(0, W - 1)
        y = random.randint(0, H - 1)
        n = random.randint(-30, 30)
        r, g, b = pixels[x, y]
        pixels[x, y] = (max(0, min(255, r + n)),
                         max(0, min(255, g + n)),
                         max(0, min(255, b + n)))
    # Slight blur (mimics out-of-focus camera)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
    # JPEG round-trip at quality 55 (typical messaging-app compression)
    tmp = os.path.join(OUT_DIR, '_tmp.jpg')
    img.convert('RGB').save(tmp, 'JPEG', quality=55)
    img = Image.open(tmp).convert('RGB')
    return img

random.seed(42)  # reproducible noise
clean = render_clean()
clean.save(os.path.join(OUT_DIR, 'test-clean.png'))
noisy = degrade(clean)
noisy.save(os.path.join(OUT_DIR, 'test-noisy.png'))

ground = ' '.join(t for t, _ in LINES if t)
with open(os.path.join(OUT_DIR, 'ground-truth.txt'), 'w') as f:
    f.write(ground)

print(f'Wrote test-clean.png + test-noisy.png ({clean.size}) and ground-truth.txt')
print(f'Ground truth tokens: {len(ground.split())}')
