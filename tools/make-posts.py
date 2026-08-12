#!/usr/bin/env python3
"""
Turn the rendered gameplay clips into finished, upload-ready posts — the job
CapCut would otherwise do by hand.

    python3 tools/make-posts.py

Reads `marketing/clips/*.mp4` (see `tools/render-clip.mjs`) and writes
`marketing/posts/*.mp4`: same 1080x1920 60fps footage with the hook text, the
beat text and a CTA tail burned in, ready to post as-is or to have an AI cold
open concatenated in front (see `marketing/FAL_BRIEF.md`).

## Why PIL and not drawtext

This machine's ffmpeg is built without libfreetype, so `drawtext` does not
exist. Text is instead rendered to transparent PNGs with PIL and composited by
ffmpeg's `overlay` filter, gated per-overlay with `enable='between(t,a,b)'`.
That is also more controllable: real stroke, real wrapping, real kerning.

## Placement

Every overlay sits in the empty cream band between the scale and the tray —
roughly 42%-61% of frame height, which is the only large clear area and is
clear of TikTok's own right-hand button rail. The timings below are taken from
the actual audio events in each clip, not guessed: text appears while the board
is still untouched and the beat lands after the deciding piece.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CLIPS = ROOT / "marketing" / "clips"
POSTS = ROOT / "marketing" / "posts"
WORK = Path("/tmp/e67-overlays")

W, H = 1080, 1920
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"

INK = (46, 38, 64, 255)        # matches the game's INK
CREAM = (250, 246, 237, 255)
ORANGE = (232, 89, 12, 255)

# size, fill, stroke, stroke width, centre-y fraction, plate colour
# A "plate" is a rounded ink slab behind the text. Cream-on-ink reads far
# harder in a feed than ink-on-cream, and it survives whatever the viewer's
# screen brightness is doing — the hook has one second to land.
STYLES = {
    "hook": (78, CREAM, None, 0, 0.50, INK),
    "beat": (168, ORANGE, CREAM, 16, 0.50, None),
    "cta":  (62, CREAM, None, 0, 0.50, INK),
}

# Fraction of a second the text spends oversized when it appears. Reads as a
# punch rather than a fade — motion at the cut is what stops a thumb.
PUNCH = 0.10
PUNCH_SCALE = 1.10

# name, source clip, trim (seconds, None = whole clip), overlays, caption, tags
# Overlay = (text, start, end, style)
#
# One level per hook, never the same footage twice. Four hooks over one identical
# clip is the unoriginal-content shape that makes posts For-You-ineligible — and
# there are 72 levels and a scriptable renderer, so there is no reason for it.
# The hook is the controlled variable; the footage is genuinely different.
#
# Every caption ends in a question: that is worth more comments than the entire
# hashtag effect. Hook windows end at 1.6s — the 3-second retention gate is what
# decides distribution, so nothing static may sit in front of it.
QUESTION_TAGS = "#puzzlegame #satisfying #mobilegame #indiedev"
ASMR_TAGS = "#asmr #satisfying #puzzlegame #mobilegame"
DECOY_TAGS = "#gamedev #indiedev #puzzlegame #mobilegame"

# Every hook is a fact pulled from marketing/CINEMATIC_LEVELS.md — the peak the
# pan actually reaches, the real move count, the real constraint. Nothing here is
# invented, so nothing can be contradicted by the footage playing underneath it.
SPEC = [
    ("N1", "B1-l71-solve.mp4", None,
     [("Exactly 67 — Level 71\n12 weights. one right answer.", 0.0, 1.6, "hook"),
      ("58 over", 2.9, 3.7, "beat")],
     "it climbs to 125 before three balloons drag it back. how long would this take you?",
     QUESTION_TAGS),
    ("N2", "B2-l72-solve.mp4", None,
     [("Exactly 67 — Level 72\nthe last level", 0.0, 3.4, "hook")],
     "72 of 72. it peaks at 181 and four balloons bring it home. would you have found it?",
     QUESTION_TAGS),
    ("N3", "D2-l70-insert.mp4", None,
     [("Exactly 67 — Level 70\nthe balloons are trying to ruin this", 0.0, 1.6, "hook")],
     "129 down to 67 in three moves. spot the one that fixes it?",
     QUESTION_TAGS),
    ("N4", "B3-l68-solve.mp4", None,
     [("Exactly 67 — Level 68\ntwo moves. watch the beam.", 0.0, 1.6, "hook")],
     "two pieces. 142 down to 67. faster than you?",
     QUESTION_TAGS),
    ("N5", "D1-l62-insert.mp4", None,
     [("Exactly 67 — Level 62\nfour pieces land on 67", 0.0, 1.6, "hook")],
     "the blocks are the easy part. which balloons finish it?",
     QUESTION_TAGS),
    ("N6", "level-65.mp4", None,
     [("Exactly 67 — Level 65\nit gets to 242 first", 0.0, 1.8, "hook")],
     "every single weight has to go on. it peaks at 242 before it lands on 67. would you trust that?",
     QUESTION_TAGS),
    ("N7", "level-67.mp4", None,
     [("Exactly 67 — Level 67\nfour pieces, no more", 0.0, 1.6, "hook")],
     "a four-piece budget and it still overshoots to 135. which four?",
     QUESTION_TAGS),
    ("N8", "level-69.mp4", None,
     [("Exactly 67 — Level 69\nten weights. keep four.", 0.0, 1.6, "hook")],
     "ten on the tray, only four may land. 131 down to 67. your pick?",
     QUESTION_TAGS),
    ("N9", "level-63.mp4", None,
     [("Exactly 67 — Level 63\nall eight have to go on", 0.0, 1.6, "hook")],
     "no leaving anything out. it hits 211 on the way. does that look solvable to you?",
     QUESTION_TAGS),
    ("N10", "level-66.mp4", None,
     [("Exactly 67 — Level 66\none balloon does it", 0.0, 1.6, "hook")],
     "115, then a single balloon. can you see which one before it drops?",
     QUESTION_TAGS),
    ("N11", "level-61.mp4", None,
     [("Exactly 67 — Level 61\nfour moves, hard cap", 0.0, 1.6, "hook")],
     "120 over the line and only four pieces allowed. where would you start?",
     QUESTION_TAGS),
    ("N12", "level-44.mp4", None,
     [("Exactly 67 — Level 44\nten weights, five land", 0.0, 1.6, "hook")],
     "halfway through the game and it already needs five. how many would you have used?",
     QUESTION_TAGS),
    ("N13", "level-58.mp4", None,
     [("Exactly 67 — Level 58\nuse every single one", 0.0, 1.6, "hook")],
     "seven weights, all compulsory, peaking at 183. which order would you go in?",
     QUESTION_TAGS),
    ("N14", "level-60.mp4", None,
     [("Exactly 67 — Level 60\ntwo moves", 0.0, 1.4, "hook")],
     "the shortest solve in the pack. did you get it before the second piece landed?",
     ASMR_TAGS),
    ("N15", "level-56.mp4", None,
     [("Exactly 67 — Level 56\nno constraints. still hard.", 0.0, 1.6, "hook")],
     "nothing locked, nothing capped, and it is still four exact pieces. yours?",
     QUESTION_TAGS),

    # --- The refusal. A proper subset of a `useAll` level totals exactly 67, the
    # beam locks dead level, the HUD reads 67 — and the game refuses the win.
    # Captions ASSERT here; they never ask. There is nothing to solve, so a
    # question would be rhetorical and the disagreement is the point.
    ("D1", "decoy-65.mp4", None,
     [("this is a bug right", 0.0, 1.9, "hook")],
     "it says 67. i think i broke my own game.",
     DECOY_TAGS),
    ("D2", "decoy-63.mp4", None,
     [("67 is 67", 0.0, 1.9, "hook")],
     "the beam is level. the number is right. it still says no.",
     DECOY_TAGS),
    ("D3", "decoy-55.mp4", None,
     [("my own game is gaslighting me", 0.0, 1.9, "hook")],
     "i wrote this rule and i still think it is wrong.",
     DECOY_TAGS),
    ("D4", "decoy-46.mp4", None,
     [("i solved it. it disagreed.", 0.0, 1.9, "hook")],
     "five pieces, dead level, exactly 67. rejected.",
     DECOY_TAGS),
    ("D5", "decoy-22.mp4", None,
     [("two pieces. exactly 67. no.", 0.0, 1.9, "hook")],
     "the scale is balanced and the game still will not take it.",
     DECOY_TAGS),
    ("D6", "decoy-17.mp4", None,
     [("watch it refuse", 0.0, 1.9, "hook")],
     "three blocks land on 67 and it just sits there.",
     DECOY_TAGS),

    # --- Formats other than "one level, one hook". Same director, different
    # shape: a difficulty ramp across the whole game, and a speedrun of a level
    # people may already have seen. Both are new footage, not a re-hook.
    ("RAMP", "RAMP-1-72.mp4", None,
     [("Exactly 67\nlevel 1 vs level 72", 0.0, 2.0, "hook")],
     "one level from every stretch of the game, in order. where would you tap out?",
     QUESTION_TAGS),
    ("SPEED", "speed-71.mp4", None,
     [("Exactly 67 — Level 71\nthe hardest board, full speed", 0.0, 1.3, "hook")],
     "twelve weights, five moves, five seconds. could you even read it that fast?",
     QUESTION_TAGS),

    ("N16", "level-52.mp4", None,
     [("Exactly 67 — Level 52\nevery weight, no exceptions", 0.0, 1.6, "hook")],
     "it climbs to 155 and all five have to stay on. which one lands it?",
     QUESTION_TAGS),
    ("N17", "level-55.mp4", None,
     [("Exactly 67 — Level 55\nsix weights, all compulsory", 0.0, 1.6, "hook")],
     "133 over the line with nothing you can leave out. what is your first move?",
     QUESTION_TAGS),
    ("N18", "level-45.mp4", None,
     [("Exactly 67 — Level 45\nno balloons at all", 0.0, 1.6, "hook")],
     "three blocks, no overshoot, no rescue. sounds easy until you try it. yours?",
     QUESTION_TAGS),
    ("N19", "level-47.mp4", None,
     [("Exactly 67 — Level 47\nfour pieces, hard cap", 0.0, 1.6, "hook")],
     "86 down to 67 and only four may land. can you see them?",
     QUESTION_TAGS),
    ("N20", "level-40.mp4", None,
     [("Exactly 67 — Level 40\nsix on, none off", 0.0, 1.6, "hook")],
     "every weight compulsory, peaking at 115. does the order matter to you?",
     QUESTION_TAGS),
    ("N21", "level-32.mp4", None,
     [("Exactly 67 — Level 32\nuse all five", 0.0, 1.6, "hook")],
     "109 on the way down to 67. how many balloons did you count?",
     QUESTION_TAGS),
    ("N22", "level-23.mp4", None,
     [("Exactly 67 — Level 23\nthree pieces, hard cap", 0.0, 1.6, "hook")],
     "97 over the target with a three-piece budget. which three?",
     ASMR_TAGS),

    # Paid / Spark only. The near-miss never resolves, which reads as engagement
    # bait organically — but the fail tone's CPI advantage is real in paid UA.
    ("P1-fail", "A-l71-fail.mp4", 8.0,
     [("Exactly 67 — Level 71\n12 weights. one right answer.", 0.0, 1.6, "hook"),
      ("68", 5.6, 8.0, "beat")],
     "PAID/SPARK ONLY — do not post organically",
     QUESTION_TAGS),
]

# Organic posts carry NO Apple marks and no CTA card: it removes every Apple
# obligation, lets the clip loop (rewatch is the strongest distribution signal),
# and returns ~1.4s of a short video. The CTA lives in the caption and a pinned
# comment instead. `--cta` restores the card for paid builds.
# The Noqyris signature. It sits in the gap between the scale and the tray, low
# enough to clear the hook plate and far above TikTok's caption rail (which eats
# the bottom ~20%) and its button rail (the right ~12%). The ink variant is used
# because the game's background is cream — the supplied wordmark is white-on-black
# and would be invisible here.
SIGNATURE = ROOT / "marketing" / "brand" / "noqyris-wordmark-ink.png"
SIG_WIDTH = 190          # px on a 1080-wide frame
SIG_MARGIN = 64
SIG_BASELINE = 1128      # just above the tray
SIG_OPACITY = 0.55

# The animated brand card appended to every post (tools/make-endcard.py). It is a
# separate pre-rendered clip rather than an overlay so it can hold on black —
# and so appending it costs a stream copy instead of a re-encode.
# Which end card to append. `endcard.mp4` says "link in bio" and needs a working
# bio link (Business account on TikTok); `endcard-search.mp4` says
# search "Exactly 67" and needs nothing. Override with E67_ENDCARD.
import os
_ec = os.environ.get("E67_ENDCARD", "endcard.mp4")
# "none" ships the post with no card at all. The refusal format wants that: the
# clip has to loop back to the untouched board, and a black plate with an App
# Store badge at the point of peak attention is the ad-skip trigger the whole
# format exists to avoid.
ENDCARD = ROOT / "marketing" / "brand" / _ec if _ec != "none" else ROOT / "nonexistent"
ENDCARD_SECONDS = 1.35

CTA_TEXT = "Exactly 67\nfree on the App Store"
CTA_SECONDS = 1.4


def wrap(draw, text, font, max_w):
    """Wrap on spaces to fit max_w, honouring explicit newlines."""
    out = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if draw.textlength(trial, font=font) <= max_w or not line:
                line = trial
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def render_overlay(text, style, path, scale=1.0):
    size, fill, stroke, sw, cy, plate = STYLES[style]
    size = int(size * scale)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, size)

    lines = wrap(draw, text, font, W * 0.80)
    line_h = size * 1.16
    total_h = line_h * len(lines)
    y0 = H * cy - total_h / 2

    if plate:
        pad_x, pad_y = size * 0.42, size * 0.30
        widest = max(draw.textlength(l, font=font) for l in lines)
        box = [(W - widest) / 2 - pad_x, y0 - pad_y,
               (W + widest) / 2 + pad_x, y0 + total_h + pad_y * 0.7]
        draw.rounded_rectangle(box, radius=size * 0.34, fill=plate)

    y = y0
    for line in lines:
        x = (W - draw.textlength(line, font=font)) / 2
        draw.text((x, y), line, font=font, fill=fill,
                  stroke_width=sw, stroke_fill=stroke)
        y += line_h

    img.save(path)


def signature_png(path):
    """Compose the wordmark onto a full-frame transparent plate, once per run."""
    if path.exists():
        return path
    mark = Image.open(SIGNATURE).convert("RGBA")
    scale = SIG_WIDTH / mark.width
    mark = mark.resize((SIG_WIDTH, max(1, int(mark.height * scale))), Image.LANCZOS)
    if SIG_OPACITY < 1.0:
        alpha = mark.getchannel("A").point(lambda a: int(a * SIG_OPACITY))
        mark.putalpha(alpha)
    plate = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    plate.paste(mark, (SIG_MARGIN, SIG_BASELINE - mark.height), mark)
    plate.save(path)
    return path


def build(name, src, trim, overlays, caption, tags, want_cta):
    clip = CLIPS / src
    if not clip.exists():
        print(f"  ! missing {clip}", file=sys.stderr)
        return None

    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(clip)],
        capture_output=True, text=True).stdout.strip())
    body = trim if trim else dur
    total = body + (CTA_SECONDS if want_cta else 0.0)

    sig = signature_png(WORK / "signature.png") if SIGNATURE.exists() else None

    # Each overlay becomes two images: an oversized one for the punch frame and
    # the settled one. Two gated overlays are cheaper and steadier than
    # animating a scale expression, and read the same on a phone.
    pngs, gates = [], []
    for i, (text, start, end, style) in enumerate(overlays):
        big = WORK / f"{name}-{i}-punch.png"
        norm = WORK / f"{name}-{i}.png"
        render_overlay(text, style, big, PUNCH_SCALE)
        render_overlay(text, style, norm)
        pngs += [big, norm]
        gates += [f"between(t,{start},{start + PUNCH})",
                  f"between(t,{start + PUNCH},{end})"]

    if want_cta:
        cta_big = WORK / f"{name}-cta-punch.png"
        cta_png = WORK / f"{name}-cta.png"
        render_overlay(CTA_TEXT, "cta", cta_big, PUNCH_SCALE)
        render_overlay(CTA_TEXT, "cta", cta_png)
        pngs += [cta_big, cta_png]
        gates += [f"between(t,{body},{body + PUNCH})", f"gte(t,{body + PUNCH})"]

    # The signature waits for the hook plate to clear. The plate is centred in the
    # same cream band and its bottom edge reaches the mark, so an always-on
    # signature sits half-covered for the first two seconds.
    if sig:
        after = max((end for _t, _s, end, style in overlays if style == "hook"),
                    default=0.0)
        pngs.insert(0, sig)
        gates.insert(0, f"gte(t,{after + 0.15})")

    # Freeze the last frame for the CTA tail, then gate every overlay in time.
    steps = [f"[0:v]trim=0:{body},setpts=PTS-STARTPTS,"
             f"tpad=stop_mode=clone:stop_duration={CTA_SECONDS if want_cta else 0.04}[v0]"]
    for i, gate in enumerate(gates):
        steps.append(f"[v{i}][{i+1}:v]overlay=enable='{gate}'[v{i+1}]")
    if ENDCARD.exists():
        dip = 0.28
        steps.append(f"[v{len(gates)}]fade=t=out:st={max(0.0, body - dip):.2f}:"
                     f"d={dip}:color=black[vf]")
        steps[-2] = steps[-2].rsplit("[", 1)[0] + f"[v{len(gates)}]"
        steps[-1] = steps[-1].rsplit("[", 1)[0] + "[v]"
    else:
        steps[-1] = steps[-1].rsplit("[", 1)[0] + "[v]"

    out = POSTS / f"{name}.mp4"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(clip)]
    for p in pngs:
        cmd += ["-i", str(p)]
    cmd += [
        "-filter_complex", ";".join(steps),
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        # Audio is already peak-normalised by the renderer — copy it rather than
        # spending another AAC generation on it.
        "-c:a", "copy", "-t", f"{total}",
        "-movflags", "+faststart", str(out),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ! ffmpeg failed for {name}:\n{r.stderr[-800:]}", file=sys.stderr)
        return None

    # The end card is pre-rendered with identical stream parameters, so appending
    # it is a stream copy — the gameplay is never re-encoded a second time.
    if ENDCARD.exists():
        listing = WORK / f"{name}-concat.txt"
        listing.write_text(f"file '{out}'\nfile '{ENDCARD}'\n")
        joined = WORK / f"{name}-joined.mp4"
        j = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
             "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(joined)],
            capture_output=True, text=True)
        if j.returncode == 0:
            joined.replace(out)
            total += ENDCARD_SECONDS
        else:
            print(f"  ! end card concat failed for {name}", file=sys.stderr)

    print(f"  {name}.mp4  {total:.1f}s")
    return {"name": name, "file": f"{name}.mp4", "source": src,
            "seconds": round(total, 2), "caption": caption, "hashtags": tags}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--cta", action="store_true",
                    help="burn the App Store CTA card on the tail (paid builds only — "
                         "organic posts must carry no Apple marks and must loop)")
    args = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    POSTS.mkdir(parents=True, exist_ok=True)
    print(f"Building {len(SPEC)} posts into {POSTS}"
          f"{' (with CTA card)' if args.cta else ' (no CTA — organic)'}")

    made = [m for m in (build(*s, args.cta) for s in SPEC) if m]

    # A manifest so the captions travel with the files instead of living only
    # in a doc you have to cross-reference while uploading.
    (POSTS / "captions.json").write_text(json.dumps(made, indent=2))
    lines = [
        "# Finished posts", "",
        "Generated by `tools/make-posts.py`. See `../PRODUCTION_BRIEF.md` for why",
        "these carry no on-screen CTA and why every hook is on a different level.", "",
        "**On upload:** retype the hook line as a *native* text element for the first",
        "~1s (burned-in text is invisible to the platform classifier), put the caption",
        "in verbatim, and pin a comment with the App Store link. Original audio —",
        "name the sound `Exactly 67 — balance SFX` on the very first post; it cannot",
        "be renamed later.", ""]
    for m in made:
        lines += [f"## {m['name']} · {m['seconds']}s  \n`{m['source']}`", "",
                  "```", m["caption"], "```", "", m["hashtags"], ""]
    (POSTS / "README.md").write_text("\n".join(lines))
    print(f"\n{len(made)}/{len(SPEC)} built · captions in posts/README.md")


if __name__ == "__main__":
    main()
