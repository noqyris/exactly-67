# Batch 01 — the posting plan

Rewritten after the research pass. The reasoning, the sources and the honest
low-confidence list live in [`PRODUCTION_BRIEF.md`](PRODUCTION_BRIEF.md); this is
the executable version.

**What changed from the first draft, and why it mattered:**

- **No CTA card, no Apple marks on screen.** The Apple logo may never appear in
  your artwork, and the App Store badge carries size, clear-space, no-animation
  and credit-line obligations. Dropping the card also lets the clip loop.
- **One level per hook.** Four hooks over one identical clip is the
  unoriginal-content shape that makes posts For-You-ineligible.
- **Original audio, never trending audio.** When someone else uses your sound,
  every video of theirs links back to your profile.
- **The long chain is the primary format**, not the 6-second clip. Median views
  by length are ~7-9× higher at 60–120s than at 1–15s.
- **The "6 7" meme is dead and adult use now reads as try-hard.** It stays in the
  App Store keywords, where it still has ASO value, and comes out of the social copy.

---

## Account setup — once, before anything

| Field | Value |
|---|---|
| Handle | `noqyrisgames` |
| Display name | `Noqyris` |
| Bio | `Exactly 67 — a balance puzzle. free ↓` |
| Link | `https://apps.apple.com/app/id6787536995` |
| Account type | **Business** (bio link works at 0 followers) |
| Avatar | `brand/noqyris-avatar-1024.png` — the `n.` mark |

The `n.` icon is the profile picture on every platform: it's already a rounded
square, it holds up at 40px, and the lime dot is the thing people will recognise
in a feed. `brand/avatar-1024.png` (the blue 67 block) is the **game** mark, not
the studio's — it stays out of the profile so it doesn't have to be replaced when
game #2 ships.

**`free on iOS` is not allowed** — Apple bans `iOS` in marketing copy. Write
`Exactly 67 for iPhone`, or just `free`.

**Post #1 is one-shot: rename the original sound to `Exactly 67 — balance SFX`**
before publishing. It cannot be renamed afterwards, and it is a permanent,
tappable, game-branded search surface.

---

## The posts

`python3 tools/make-posts.py` → [`posts/`](posts/), captions in `posts/README.md`.
All 1080×1920 60fps, game SFX at −18 LUFS, Noqyris signature burned in, no CTA card.

| # | Level | Hook | Length |
|---|---|---|---|
| **`LONG`** | **49–64** | *(none — self-chapters on `Level N`)* | **75.9s** |
| `N1` | 71 | 12 weights. one right answer. | 8.6s |
| `N2` | 72 | the last level | 10.2s |
| `N3` | 70 | the balloons are trying to ruin this | 8.1s |
| `N4` | 68 | two moves. watch the beam. | 5.9s |
| `N5` | 62 | four pieces land on 67 | 5.8s |
| `N6` | 65 | it gets to 242 first | 10.1s |
| `N7` | 67 | four pieces, no more | 6.2s |
| `N8` | 69 | ten weights. keep four. | 6.8s |
| `N9` | 63 | all eight have to go on | 9.8s |
| `N10` | 66 | one balloon does it | 4.8s |
| `N11` | 61 | four moves, hard cap | 5.7s |
| `N12` | 44 | ten weights, five land | 7.1s |
| `N13` | 58 | use every single one | 7.7s |
| `N14` | 60 | two moves | 3.7s |
| `N15` | 56 | no constraints. still hard. | 5.2s |
| `P1-fail` | 71 | lands on 68, never resolves | 8.0s |

Every hook is a fact from [`CINEMATIC_LEVELS.md`](CINEMATIC_LEVELS.md) — the real
peak, the real move count, the real constraint — so nothing on screen can be
contradicted by the footage under it.

**`P1-fail` is paid/Spark only.** A near-miss that never resolves reads as
engagement bait organically: high completion with no payoff is a dissatisfaction
signal. In paid UA the fail tone's CPI advantage is real.

**Branding.** `brand/noqyris-avatar-1024.png` (the `n.` mark) is the profile
picture. `brand/noqyris-wordmark-ink.png` is burned into every video at 55%
opacity just above the tray — and **gated to appear only after the hook plate
clears**, because the plate is centred in the same cream band and was covering
it. The supplied wordmark is white-on-black, so an ink variant was derived for
the game's cream background; the lime dot is untouched. Drop in an official dark
variant and re-run if you have one.

**End card** — `brand/endcard.mp4`, 1.8s, appended to every post
(`python3 tools/make-endcard.py` to change it). Black Noqyris field, the app icon
landing with an overshoot, `Exactly 67`, then **Apple's official "Download on the
App Store" badge**, `link in bio` in lime, the required trademark credit line, and
the wordmark.

The badge is the *only* legitimate way to show the Apple logo — Apple forbids
drawing or approximating it yourself. `make-endcard.py` fetches the current
artwork straight from Apple's marketing toolbox and rasterises it unmodified, so
it is never a redrawn or stale copy. The rules it obeys: **white variant** (this
card is black; the black variant is for light backgrounds), **160px tall** (Apple's
minimum is 40), a **40px keep-out** with nothing inside it, and — unlike every
other element on the card — it **hard-cuts in and holds**, because Apple's artwork
may not be animated. The two-sentence credit line is required whenever the Apple
logo appears. No ® or ™: those are a US-only-distribution requirement and are
wrong on a global feed.

**Transitions.** Gameplay dips to black over 0.28s straight into the card, which
is already black — the two read as one continuous dip and it costs nothing,
since that pass re-encodes anyway. Opener into gameplay goes **through the shared
cream background** (0.14s each side) rather than cross-dissolving: both halves
have a balance scale dead centre, so a dissolve spends its midpoint as a legible
double exposure of two different scales. Dipping through cream never changes the
background, so only the subject leaves and the next arrives.

**A link in a video cannot be tapped.** Video is pixels. The only tappable routes
are the bio link, a pinned comment, and the CTA button on a paid post — so the
card points at the bio rather than pretending to be a button.

**Openers.** `*-opener.mp4` are the AI-cold-open variants (see
[`FAL_BRIEF.md`](FAL_BRIEF.md)). The research view is that they belong on paid
placements, because ~half of viewers disengage from content they read as AI and
seconds 0–2 are the whole decision — but they are built for the posts you want
them on. If you run them organically, **toggle the AI-content label**:
pre-emptive labels are reach-neutral, retroactive auto-labels are not.

## On every upload

1. **Retype the hook as a native text element** for the first ~1s. Burned-in text
   is invisible to the platform's classifier; the burned version is what carries
   the muted watch, the native version is what gets you indexed. Run both.
2. **Caption verbatim** from `posts/README.md`. Every one ends in a question —
   that is worth more comments than the entire hashtag effect.
3. **3–4 hashtags**, not five: `#puzzlegame #satisfying #mobilegame #indiedev`.
   The real keywords go in the caption prose.
4. **Pin a comment** with the App Store link immediately after uploading. That is
   also where the Apple credit line goes if you ever name the App Store on screen.
5. **Original sound.** Never add a trending sound to a gameplay post.
6. **Publish the identical file to TikTok, Reels and Shorts.** Marginal cost is an
   upload; several studies put Shorts and Reels ahead of TikTok on organic reach
   for game content right now.

---

## Cadence

**4–5 posts/week**, evenings. Higher frequency raises the tail, not the median —
so batch-render rather than polish.

- A post is dead at 10 days; ~96% of its reach lands by then.
- Track **0–3s retention** and **rewatch rate**, not views or followers. Follower
  count is near-irrelevant to per-video distribution.
- Cap the fail format at ~1 in 4 organic posts, and **reply to correction
  comments** — threaded replies are a positive signal, silence turns the post
  into pure bait.
- Boost only the 1–2 posts clearing ~1.5× median engagement within 7 days, and
  target **US only**: TikTok US is ~67% iOS, global TikTok is >90% Android and
  worthless while you are iPhone-only.

---

## The evergreen corpus — do this early

TikTok and YouTube both carry standing search demand for individual puzzle-level
solutions ("<game> level 88"). Nobody owns those queries for your game yet.

Batch-render all 72 solves, one post each, on-screen text and caption reading
literally `Exactly 67 — Level N`. Order by
[`CINEMATIC_LEVELS.md`](CINEMATIC_LEVELS.md). **Shorts is the better home** —
YouTube search keeps surfacing them for months, TikTok's tail is short. Rotate
plate position and pacing across the batch so it doesn't read as templated.

---

## The one self-aware post about the name

Make **exactly one**, then never mention it again:

> we shipped a game named after the 2025 meme. in 2026. anyway —

Not a recurring bit.
