#!/usr/bin/env python3
"""
Splice an AI-generated cold open in front of a finished post.

    python3 tools/splice-opener.py --opener /path/veo-01.mp4 --post A1
    python3 tools/splice-opener.py --opener-dir ~/Downloads/openers --post A1

Writes `marketing/posts/<post>-<opener name>.mp4`.

Generated clips arrive in whatever shape the model felt like: 24/30fps, odd
resolutions, often no audio track at all. Concatenating those directly produces
a file that stutters at the join or loses sound for the whole first segment, so
each opener is first *conformed* — scaled and padded to exactly 1080x1920,
resampled to 60fps, and given a silent stereo track if it has none — and only
then concatenated. That means the gameplay half is never re-encoded twice from
a mismatched timebase.

See `marketing/FAL_BRIEF.md` for what to generate in the first place.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS = ROOT / "marketing" / "posts"
WORK = Path("/tmp/e67-splice")

W, H, FPS = 1080, 1920, 60
DIP = 0.14        # seconds of dip through the shared background, each side
CREAM = "0xF5EFE3"  # the game's BG — see src/render/palette.ts


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"ffmpeg failed:\n{' '.join(cmd[:6])}…\n{r.stderr[-1200:]}")
    return r


def has_audio(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True).stdout.strip()
    return bool(out)


def conform(src, dst, trim):
    """Force any generated clip to 1080x1920 / 60fps / stereo 48k AAC.

    `trim` caps the length: most fal video models have a 5s minimum, but an
    opener longer than ~2s pushes the gameplay out of the first three seconds,
    which is the only part that decides whether the post travels.
    """
    # Scale to fit, then pad — never crop, since a model's framing is often
    # tighter than 9:16 and cropping would cut the subject.
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
          f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0xF5EFE3,"
          f"fps={FPS},setsar=1")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if trim:
        # Take the LAST `trim` seconds: generated clips typically build to their
        # strongest frame, and we want to cut into the gameplay on that peak.
        src_dur = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(src)], capture_output=True, text=True).stdout.strip())
        if src_dur > trim:
            cmd += ["-ss", f"{src_dur - trim:.3f}"]
    cmd += ["-i", str(src)]
    if not has_audio(src):
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"]
    cmd += [
        "-vf", vf,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", str(dst),
    ]
    run(cmd)


def duration(path):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip())


def splice(opener, post_file, out, trim):
    WORK.mkdir(parents=True, exist_ok=True)
    conformed = WORK / f"conformed-{opener.stem}.mp4"
    conform(opener, conformed, trim)

    # Transition through the shared cream background, not a cross-dissolve.
    #
    # A dissolve was the obvious choice and it looked wrong: both halves have a
    # balance scale dead centre, so the midpoint is a legible double exposure of
    # two different scales. Dipping through cream avoids that entirely — the
    # background is the same #F5EFE3 in the AI shot and in the game, so it never
    # appears to change. Only the subject leaves and the next one arrives, which
    # reads as one continuous space rather than two clips glued together.
    #
    # Short on purpose: the gameplay has to be on screen well inside the first
    # two seconds.
    op_dur = duration(conformed)
    d = min(DIP, max(0.06, op_dur / 4))
    out_at = max(0.0, op_dur - d)

    run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(conformed), "-i", str(post_file),
        "-filter_complex",
        f"[0:v]fade=t=out:st={out_at:.3f}:d={d:.3f}:color={CREAM}[a];"
        f"[1:v]fade=t=in:st=0:d={d:.3f}:color={CREAM}[b];"
        f"[a][0:a][b][1:a]concat=n=2:v=1:a=1[v][aud]",
        "-map", "[v]", "-map", "[aud]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", str(out),
    ])

    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip()
    print(f"  {out.name}  {float(dur):.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--opener", type=Path, help="one generated clip")
    ap.add_argument("--opener-dir", type=Path, help="a folder of them")
    ap.add_argument("--post", required=True, help="post name, e.g. A1")
    ap.add_argument("--out", help="output name (single opener only)")
    ap.add_argument("--trim", type=float, default=2.0,
                    help="seconds of opener to keep, taken from its end (0 = keep all)")
    a = ap.parse_args()

    post_file = POSTS / f"{a.post}.mp4"
    if not post_file.exists():
        raise SystemExit(f"No such post: {post_file}. Run tools/make-posts.py first.")

    openers = []
    if a.opener:
        openers = [a.opener]
    elif a.opener_dir:
        openers = sorted(p for p in a.opener_dir.iterdir()
                         if p.suffix.lower() in {".mp4", ".mov", ".webm"})
    if not openers:
        raise SystemExit("Pass --opener or --opener-dir")

    print(f"Splicing {len(openers)} opener(s) onto {a.post}")
    for op in openers:
        name = a.out if (a.out and len(openers) == 1) else f"{a.post}-{op.stem}"
        splice(op, post_file, POSTS / f"{name}.mp4", a.trim)

    # Carry the caption over so the variants stay postable without lookup.
    manifest = POSTS / "captions.json"
    if manifest.exists():
        data = json.loads(manifest.read_text())
        cap = next((m["caption"] for m in data if m["name"] == a.post), None)
        if cap:
            print(f"\nCaption for these: {cap}")


if __name__ == "__main__":
    main()
