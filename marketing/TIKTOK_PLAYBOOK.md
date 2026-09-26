# TikTok playbook — Exactly 67

> **Partly superseded.** A research pass (July 2026) overturned several calls
> below — the account is now studio-branded, the "6 7" meme angle is dropped, the
> CTA card is gone, trending audio is out, and the long chain replaced the short
> clip as the primary format. Read
> [`PRODUCTION_BRIEF.md`](PRODUCTION_BRIEF.md) first; §2 and §5 here are the
> parts most affected. The recording and rendering sections remain accurate.

How to turn this repo into short-form video. Everything here is executable today:
the capture director ships in the dev build, and the level picks are computed, not
guessed — see [`CINEMATIC_LEVELS.md`](CINEMATIC_LEVELS.md).

---

## 0. Scope and the link

**This campaign is iOS-only.** The App Store listing is live; Google Play is not
public (the store URL 404s), so every CTA points at one place and nothing has to
sniff the platform.

| | |
|---|---|
| **App** | Exactly 67: Number Puzzle |
| **Apple ID** | `6787536995` |
| **Live since** | 9 July 2026 |
| **Link for bio** | `https://apps.apple.com/app/id6787536995` |

Use that short form, **not** the `/us/app/…?uo=4` URL the lookup API returns. The
short one redirects to the viewer's own storefront, so traffic from outside the US
still lands on a buyable page instead of a "not available in your region" wall.

Short-form traffic is a spike, not a stream: a video that lands sends most of its
installs within about six hours, and you only get that spike once per clip. So before
the first post:

- [ ] Open the bio link from a phone, in an incognito tab. It must land on the product
      page, not a redirect chain.
- [ ] Search "67" and "six seven" in the App Store. If the app doesn't come back, the
      keyword field is the problem, not the video. (Keyword field only — those words
      no longer belong in the social copy.)
- [ ] **The listing has zero ratings.** A cold product page with no reviews converts
      badly, so a share of your first spike is wasted no matter how good the video is.
      The in-app rate prompt already fires at the win overlay (`services/review.ts`) —
      get the count off zero before you spend the good clips.
- [ ] Consider an App Store **custom product page** for the TikTok link: its own URL,
      its own screenshots ordered for someone who just watched a balloon rescue, and
      its own conversion numbers in App Analytics. It is the only honest way to tell
      whether a flat day was the video or the store page.

---

## 1. The positioning

> Superseded — see [`PRODUCTION_BRIEF.md`](PRODUCTION_BRIEF.md) §2. Summary of
> what changed: the "6 7" meme is **dead**, and adult/brand use of it now reads
> as try-hard (a major political account's "6-7" rebrand was reverted within a
> day; the phrase topped a banished-words list). It stays in the **App Store
> keyword field**, where ASO value is unrelated to social credibility, and comes
> out of the display name, the hooks and the hashtags.
>
> Per-game discovery moves into the video instead: the platform OCRs on-screen
> text, so `Exactly 67 — Level N` goes in the burned-in plate within the first
> three seconds and verbatim in the caption. Make **exactly one** self-aware post
> about the name, then never mention it again.

**What to never say:** "brain teaser", "IQ test", "logic puzzle", "train your brain".
That vocabulary is dead on TikTok and it screams app-store-listing. You are selling a
satisfying object, not cognitive improvement.

**And never say `iOS`** — Apple bans the term in marketing copy. `Exactly 67 for
iPhone`, or just "free".

## 2. Recording setup

### The capture director

`src/dev/capture.ts` plays levels for you — deterministically, on a schedule, with
the placement order tuned for video. It drives the same `placeWeight` path a real tap
uses, so sound, haptics, the beam spring and the win overlay all fire exactly as they
do for a player. Nothing is faked or re-rendered.

```bash
npm run capture                      # dev server on a fixed port (5199)
open "http://localhost:5199/?rec=71" # level 71, clean solve
```

**The flow is: open the URL → start your screen recorder → click once.** The page
shows an "armed" curtain and waits for that click, because browsers refuse to start
an AudioContext until the page has seen a user gesture — an auto-starting capture
records **completely silent**. The curtain removes itself on the click and is never in
frame. (`auto=1` skips the wait; only use it together with `mute=1`.)

| Param | Default | Meaning |
|---|---|---|
| `rec` | — | Global level 1–72. **Required**, else you get the normal game. |
| `mode` | `solve` | `solve` clean win · `fail` stop on the near miss · `asmr` chain levels |
| `pace` | `620` | ms between placements |
| `lead` | `1400` | ms held on the untouched board before the first move |
| `hold` | `2600` | ms held after the win |
| `chain` | `3` | `mode=asmr`: how many consecutive levels |
| `loop` | `0` | `1` = restart forever (B-roll / attract mode) |
| `mute` | `0` | `1` = kill the synth SFX (for clips you score yourself) |
| `seed` | `1` | mark earlier levels cleared so the map looks lived-in |
| `auto` | `0` | `1` = skip the arming click. **Records silent** — pair with `mute=1` |

### The drama order

Pieces are **not** placed in tray order. Heaviest first, balloons last. Level 71 runs:

```
72  →  125  →  100  →  79  →  67
        ▲                      ▲
   beam slams to          locks level,
   max tilt (13°)          three stars
```

That overshoot-then-rescue arc is the entire reason the clip holds attention. A level
whose solution has no balloons lands flat on 67 and is boring on camera — which is why
[`CINEMATIC_LEVELS.md`](CINEMATIC_LEVELS.md) scores balloon-finished levels highest.

### Rendering instead of recording

For gameplay-only clips you don't have to screen-record at all:

```bash
npm run capture                                         # dev server, one shell
node tools/render-clip.mjs --level 71 --mode fail \
     --pace 520 --hold 4500 --out marketing/clips/A.mp4 # another shell
```

This drives headless Chrome on its **virtual clock** — the page's timers advance
in exact 1/60s steps that have nothing to do with wall-clock time, and every frame
is captured before the clock is allowed to move again. Output is a true 1080×1920
60fps H.264 file that cannot drop a frame, and re-running it produces the identical
video. Needs **Node ≥ 22** (`nvm use 22`) for the built-in WebSocket.

**The SFX are included.** They can't be *recorded* — the page is on virtual time, and
they're synthesised at play time with no file to mux. So they're **re-rendered**
instead: `src/dev/audioRender.ts` swaps `window.AudioContext` for a proxy over an
`OfflineAudioContext` whose `currentTime` reports elapsed virtual time. Every note the
game schedules lands at the same offset it would have played at live, and the buffer
is muxed in as AAC. Sample-exact, and verified to land within ~4ms of the placements.
Pass `--silent` if you'd rather score the clip yourself.

**The audio is normalised, and it has to be.** Raw, the synth measures about
**-32 LUFS** — the SFX are short transients with digital silence between them, so
even though peaks sit at -11 dBFS the perceived level is nowhere. Social platforms
normalise toward roughly -14 LUFS, so unprocessed clips are ~18 dB below everything
else in a feed and read as having no sound at all. The mux runs `loudnorm`, landing
at **-18 LUFS with peaks at -4 dBFS**. It can't honestly reach -14 without pumping
the silence between the clicks. `--raw-audio` skips the processing.

### Window and recording (when you need the audio)

- Resize the browser to **540 × 960 CSS px**. At DPR 2 that is a true 1080 × 1920
  backing store — native TikTok resolution, no upscaling.
- Hide bookmarks and use fullscreen so no chrome is in frame.
- **QuickTime → New Screen Recording** (selection) or **OBS** (display capture,
  1080×1920 canvas, 60 fps, CRF ~18). QuickTime is fine; OBS gives you 60 fps reliably.
- Record **system audio** if you want the synth SFX. The place/win sounds are genuinely
  satisfying and are half the ASMR value.

---

## 3. The six formats

Levels are named from the computed ranking. Swap freely — the table has 72 rows.

### F1 — Wrong answer bait ★ highest engagement

The single strongest format for anything numerical. People physically cannot let a
wrong answer stand. Comments are a ranking signal, and corrections are comments.

```
URL   ?rec=71&mode=fail&pace=520&hold=4000
0.0s  Board sits. VO: "get it to exactly sixty-seven."
0.5s  Text top: "you have 12 weights"
1.5s  Pieces drop, beam slams over
3.5s  Lands on 68. Beam does NOT lock.
4.0s  Text center, big: "68. close enough"
4.5s  Cut. Hold on 68 for two full seconds. No correction. No "jk".
```

Do not break character in the caption either. Caption: `level 71 was easy tbh`.
The entire payload is the comment section.

### F2 — "Only 1% can solve this"

```
URL   ?rec=71&pace=560&lead=1800
0.0s  Text: "12 weights. 4,096 combinations. one hits exactly 67."
1.8s  First weight — 72
2.4s  Second — 125. Beam maxed. Text: "58 over"
3.0s  Balloons: 100 → 79 → 67
5.0s  Beam locks. EXACTLY 67. Three stars.
6.0s  Text: "level 71 of 72"
```

The 4,096 is real (2¹² subsets), so you can say it without lying. Levels 70 and 72
are the other 12-weight boards.

### F3 — ASMR / satisfying, no voice

```
URL   ?rec=68&mode=asmr&chain=4&pace=480&lead=700&hold=1200
```

Level 68 clears in **two moves** and overshoots to 142 — maximum beam travel per
second of runtime. Chain four levels, no talking, no text past the first frame.
Keep the synth SFX. This is your highest-volume format: one 25-second capture cuts
into six different posts.

### F4 — The meme origin story

```
0.0s  Face to camera: "my nephew said six-seven 400 times at dinner"
2.0s  "so I made a game where the answer is always 67"
3.5s  Cut to gameplay, fast solve
6.0s  "it's on the app store. i'm not okay"
```

This is the one that gets shared rather than just watched. Shoot it once, properly.

### F5 — Build in public

```
0.0s  Split screen: GameScene.ts scrolling | the game running
0.5s  Text: "there are zero image files in this game"
2.0s  Text: "every balloon, every weight, drawn in code"
4.0s  Text: "the sound is synthesised at play time. no audio files either."
6.0s  Beam locks on 67.
```

True — see [`CLAUDE.md`](../CLAUDE.md). Converts worse than F1–F3 but gets shared into
dev communities, and dev audiences leave long comments.

### F6 — Impossible-looking board, obvious in hindsight

```
URL   ?rec=72&pace=700&lead=2600
```

Level 72 overshoots to **181** before four balloons haul it down. Hold on the static
board for 2.6 seconds — long enough that people start trying to solve it — then run it.

---

## 4. Fifteen hooks

First two seconds decide everything. Same gameplay clip, fifteen openers, let the
algorithm pick.

1. "Get this to exactly 67."
2. "Nobody has solved level 71 on the first try."
3. "Two moves. Watch the beam."
4. "I made a game about the worst meme of 2025."
5. "12 weights. One right answer."
6. "You have four seconds. Which two do you pick?"
7. "Balloons go up. Weights go down. Land on 67."
8. "The balloons are trying to ruin this."
9. "This game has no image files in it."
10. "Rate my solve out of 10."
11. "Level 71 broke my brain for an hour."
12. "The answer is always 67. That's the whole game."
13. "Watch the beam. Don't blink."
14. "I got 68. Close enough right?"
15. "This is illegal in classrooms now."

Rules: no "wait for it", no "you won't believe", no question that sounds like an ad.
Say a number in the first second — numbers stop the scroll.

---

## 5. Captions and hashtags

Caption formula: **one flat statement + one bait**. No emoji spam, no CTA in the
caption (put the CTA in the video's last frame instead — captions with "download now"
get suppressed).

```
level 71 was easy tbh
```
```
took me 40 minutes. be honest, how long would you take
```
```
the balloons ruin everything
```
```
we shipped a game named after the 2025 meme. in 2026. anyway — how fast can you do this?
```

Hashtags — five max, mixing one huge and three mid:

```
#puzzlegame #satisfying #mobilegame #indiedev
```
```
#asmr #satisfying #puzzlegame #mobilegame
```

Skip `#fyp` and `#viral`. They do nothing and they look like 2020.

---

## 6. Where fal.ai actually helps

**Never generate gameplay.** Viewers spot fake gameplay instantly, TikTok labels and
deprioritises AI-heavy uploads, and a generated clip cannot show a real product. Your
real footage is free, deterministic, and takes ten seconds to record. Use it.

Use fal for the **wrapper around** the real footage:

| Job | What to run | Why it's worth it |
|---|---|---|
| **2–3s cold open** before the gameplay cut — giant physical balance scale, a person lifted by balloons, a weight crushing a table | text-to-video with native audio (Veo-family, Kling, Seedance) | Buys you a scroll-stopping first second that you cannot film |
| **Talking-head UGC hook** over which the gameplay plays | TTS + a lipsync model | Lets you ship F4-style hooks without being on camera 15 times |
| **Mascot stills** — the balloon and the weight as characters, for thumbnails and the account avatar | Flux-family image gen, then image-to-video for a 1s idle loop | Brand consistency across the grid |
| **Batch hook variants** ← *the real win* | 15–20 openers from the hook list, same prompt skeleton, different subject | This is work you would never do by hand, and it's exactly what the algorithm rewards |

Check fal's current model catalogue before you build the pipeline — the specific model
IDs turn over every few months; the categories above don't.

**The pipeline that actually works:**

1. Record **one** clean gameplay capture (`?rec=71`, ~8s). This is your constant.
2. Generate 15 different 2-second cold opens on fal.
3. Concatenate: `[AI cold open 2s] + [real gameplay 8s] + [CTA frame 1s]`. Fifteen videos.
4. Post them over five days. Kill anything under 50% retention at 3 seconds.
5. Take the top two openers and generate 15 more variations *of those*.

You are not using AI to make a video. You are using AI to run an A/B test you could
not otherwise afford.

**Disclose it.** Toggle TikTok's AI-generated content switch when the opener is
synthetic. Getting caught undisclosed costs you distribution; disclosing costs nothing.

---

## 7. Cadence and what to measure

There is no viral video, only a viral *batch*. Assume 1 in 30 lands.

- **3–5 posts/day**, every day, for 30 days minimum before you judge anything.
- Post the same gameplay with different hooks. Change one variable at a time.
- The only metric that matters for the first two weeks is **retention at 3 seconds**.
  Under 50% = the hook is broken, not the game. Rewrite the first two seconds and repost.
- Full-watch rate and rewatches drive the second push. That is what F3 (ASMR) is for.
- Installs are a lagging indicator. Do not tune on installs for the first fortnight.
- Reply to every comment on the F1 (wrong answer) posts with something that provokes
  a reply. Comment threads keep a video alive for days.

**When one lands:** immediately post three more of the same format within 24 hours.
The algorithm pushes your next uploads harder while a video is hot. This is the single
biggest lever most people miss.

---

## 8. Regenerating the level ranking

```bash
npm run capture:levels    # rewrites marketing/CINEMATIC_LEVELS.md
```

Run it after editing any pack file. It reads the real solver, so the numbers stay
honest — see [`tools/cinematic-levels.ts`](../tools/cinematic-levels.ts).
