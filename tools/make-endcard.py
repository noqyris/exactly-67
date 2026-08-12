#!/usr/bin/env python3
"""
Render the animated Noqyris end card to `marketing/brand/endcard.mp4`.

    python3 tools/make-endcard.py

Built in code rather than generated: an end card is *brand*, not atmosphere. It
has to render an app icon and four exact strings legibly, which is the one thing
video models are unreliable at — and putting AI frames in a post costs an
AI-content label for a shot that plays after the viewer has already decided to
stay. Animating it here is deterministic, free, and re-renders identically.

Output matches what `tools/render-clip.mjs` produces exactly — 1080x1920, 60fps,
H.264 yuv420p, silent AAC 48k stereo — so it concatenates onto a finished post
with `-c copy` and never re-encodes the gameplay.

## The Apple badge

The Apple logo may never be drawn, redrawn or approximated in your own artwork.
The **only** compliant way to show it is Apple's official "Download on the App
Store" badge, fetched from Apple's marketing toolbox — which is what
`fetch_badge()` does, straight from
`toolbox.marketingtools.apple.com`, rasterised unmodified from Apple's own SVG.

The rules that shape this layout:
- **Never animated.** Everything else on the card fades and scales in; the badge
  hard-cuts to full opacity in a single frame and then holds.
- **Never recoloured, angled or distorted.** It is rasterised at the artwork's
  own aspect ratio and composited as-is. The *white* variant is used because this
  card is black — the black variant is the one for light backgrounds.
- **Clear space** of at least a quarter of the badge height is kept empty on all
  sides; nothing is placed inside `BADGE_KEEPOUT`.
- **Minimum size** is 40px; this renders at 160px tall on a 1080-wide frame.
- **Credit line** is required whenever an Apple mark appears, and uses the
  two-sentence form because the badge contains the Apple logo. No (R) or (TM)
  symbols — those are a US-only-distribution requirement and are wrong on a
  global feed.

`App Store` is a **service** mark, not a trademark, and only ever appears
capitalised and preceded by "the". See `marketing/PRODUCTION_BRIEF.md` §1.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "marketing" / "brand"
WORK = Path("/tmp/e67-endcard")

W, H, FPS = 1080, 1920, 60
SECONDS = 1.8
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"

BLACK = (10, 10, 10)
WHITE = (245, 245, 245)
LIME = (198, 255, 26)
MUTED = (150, 150, 150)

ICON_PX = 300
ICON_Y = 480

BADGE_H = 160            # well above Apple's 40px minimum
BADGE_Y = 1010
BADGE_KEEPOUT = BADGE_H // 4     # Apple requires >= 1/4 badge height of clear space

CREDIT = ("Apple and the Apple logo are trademarks of Apple Inc., registered in the "
          "U.S. and other countries. App Store is a service mark of Apple Inc., "
          "registered in the U.S. and other countries.")

# What the card tells people to do. "bio" is the low-friction route (two taps:
# profile, then the link) but it needs a working bio link, which on TikTok means
# a Business account. "search" needs nothing at all and is never a lie — the app
# name is unique, so the store search finds it. Never print "link in bio" when
# there is no link: a dead instruction loses the viewer completely.
CTA_MODE = "bio"          # "bio" | "search"
CTA_LINES = {
    "bio": "link in bio",
    "search": 'search "Exactly 67"',
}

BADGE_URL = ("https://toolbox.marketingtools.apple.com/api/v2/badges/"
             "download-on-the-app-store/white/en-us")


def fetch_badge(dst_png):
    """Rasterise Apple's official badge SVG, unmodified, via headless Chrome.

    Downloading it every time is deliberate: the badge must be Apple's current
    artwork, never a redrawn or stale copy.
    """
    if dst_png.exists():
        return dst_png
    import urllib.request
    svg = urllib.request.urlopen(BADGE_URL, timeout=30).read().decode()
    width = round(119.66407 / 40 * BADGE_H)
    html = WORK / "badge.html"
    WORK.mkdir(parents=True, exist_ok=True)
    html.write_text(
        "<!doctype html><meta charset=utf-8>"
        "<style>html,body{margin:0;padding:0;background:transparent}"
        f"svg{{display:block;width:{width}px;height:{BADGE_H}px}}</style>{svg}")
    raw = WORK / "badge-raw.png"
    subprocess.run([
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "--headless", "--disable-gpu", "--default-background-color=00000000",
        "--hide-scrollbars", f"--screenshot={raw}",
        f"--window-size={width},{BADGE_H}", str(html),
    ], capture_output=True)
    im = Image.open(raw).convert("RGBA")
    im.crop(im.getbbox()).save(dst_png)
    return dst_png


def wrap_text(draw, text, font, max_w):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def ease_out_back(t):
    """Overshoot then settle — the icon should land, not glide."""
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def fade(frame, start, end):
    """0 before `start`, 1 after `end`, smooth between (times in frames)."""
    if frame <= start:
        return 0.0
    if frame >= end:
        return 1.0
    t = (frame - start) / (end - start)
    return t * t * (3 - 2 * t)


def draw_text(canvas, text, y, size, colour, alpha):
    if alpha <= 0.01:
        return
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    font = ImageFont.truetype(FONT, size)
    x = (W - d.textlength(text, font=font)) / 2
    # Text rises a few pixels as it fades in — static fades read as a glitch.
    d.text((x, y + (1 - alpha) * 14), text, font=font, fill=(*colour, int(255 * alpha)))
    canvas.alpha_composite(layer)


def render_frames():
    WORK.mkdir(parents=True, exist_ok=True)
    for p in WORK.glob("*.png"):
        p.unlink()

    icon_src = Image.open(BRAND / "avatar-1024.png").convert("RGBA")
    wordmark = Image.open(BRAND / "noqyris-wordmark-alpha.png").convert("RGBA")
    wordmark = wordmark.resize((260, max(1, int(wordmark.height * 260 / wordmark.width))),
                               Image.LANCZOS)

    badge = Image.open(fetch_badge(BRAND / "appstore-badge-white.png")).convert("RGBA")
    badge_x = (W - badge.width) // 2

    total = int(SECONDS * FPS)
    for f in range(total):
        canvas = Image.new("RGBA", (W, H), (*BLACK, 255))

        # Icon: scales in with an overshoot, presented as a rounded app tile.
        a_icon = fade(f, 0, 14)
        if a_icon > 0:
            scale = 0.72 + 0.28 * ease_out_back(min(1.0, f / 14)) if f < 14 else 1.0
            px = max(8, int(ICON_PX * scale))
            tile = icon_src.resize((px, px), Image.LANCZOS)
            mask = Image.new("L", (px, px), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1],
                                                   radius=int(px * 0.225), fill=255)
            tile.putalpha(Image.composite(tile.getchannel("A"),
                                          Image.new("L", (px, px), 0), mask))
            canvas.alpha_composite(tile, ((W - px) // 2, ICON_Y + (ICON_PX - px) // 2))

        draw_text(canvas, "Exactly 67", 850, 86, WHITE, fade(f, 8, 26))

        # The badge hard-cuts to full opacity and holds: Apple's artwork may not
        # be animated, so it does not fade or scale like everything else here.
        if f >= 24:
            canvas.alpha_composite(badge, (badge_x, BADGE_Y))

        # Below the badge's keep-out box. This is the only tappable route there
        # actually is — a badge in a video cannot be clicked.
        draw_text(canvas, CTA_LINES[CTA_MODE],
                  BADGE_Y + BADGE_H + BADGE_KEEPOUT + 26, 46, LIME, fade(f, 34, 52))

        a_credit = fade(f, 44, 62)
        if a_credit > 0:
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            font = ImageFont.truetype(FONT, 22)
            y = 1560
            for line in wrap_text(d, CREDIT, font, W * 0.80):
                d.text(((W - d.textlength(line, font=font)) / 2, y), line,
                       font=font, fill=(110, 110, 110, int(255 * a_credit)))
                y += 30
            canvas.alpha_composite(layer)

        a_wm = fade(f, 40, 58)
        if a_wm > 0:
            wm = wordmark.copy()
            wm.putalpha(wm.getchannel("A").point(lambda v: int(v * a_wm)))
            canvas.alpha_composite(wm, ((W - wm.width) // 2, 1720))

        canvas.convert("RGB").save(WORK / f"f{f:04d}.png")
    return total


def encode(out):
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-framerate", str(FPS), "-i", str(WORK / "f%04d.png"),
        # A silent track so the concat onto a post has matching stream layout.
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", str(out),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"ffmpeg failed:\n{r.stderr[-1200:]}")


def main():
    global CTA_MODE
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--cta", choices=list(CTA_LINES), default="bio",
                    help='"bio" needs a working bio link; "search" needs nothing')
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    CTA_MODE = a.cta

    if not (BRAND / "avatar-1024.png").exists():
        sys.exit("Missing marketing/brand/avatar-1024.png")
    n = render_frames()
    out = BRAND / (a.out or ("endcard.mp4" if a.cta == "bio" else f"endcard-{a.cta}.mp4"))
    encode(out)
    print(f"{out}  {n} frames  {n / FPS:.2f}s  cta={a.cta!r}")


if __name__ == "__main__":
    main()
