<!-- Researched 2026-07-28: 81 findings across Apple brand rules, TikTok 2026
     craft, studio-account branding, competitor formats and the fal.ai catalogue;
     the 14 riskiest claims were adversarially re-verified and 9 corrected.
     This supersedes the account/CTA/sound sections of BATCH-01.md and
     TIKTOK_PLAYBOOK.md. Low-confidence items are listed honestly in §7. -->

# Noqyris short-form production brief — Exactly 67
*Supersedes `marketing/BATCH-01.md` §"Account setup" and `marketing/TIKTOK_PLAYBOOK.md` §0, §1, §5. Everything below is a change to what you do.*

---

## 1. Apple: what you may and may not put in a video

### The rules that bind you

**Apple logo — never.** Not in the end card, opener, thumbnail, avatar, or as the Option-Shift-K glyph  pasted into a caption. Apple's carve-outs (reseller agreement, Web Badge Licensing Program, Apple Pay mark) all require a licence you don't hold, so for you it's absolute. The lookalike rule is real and reaches variations: no bitten shapes, no detached/right-angled leaf on any round fruit form, no San Francisco/Apple-typeface imitation in the Noqyris mark. (A pear is not per se banned — Prepear kept theirs and only changed the leaf — but don't spend money finding out.)

**The "Download on the App Store" badge — you don't currently have one, and for organic posts you should keep it that way.** Verified: there is no badge asset anywhere in this repo. Adding one imports five obligations: official artwork only (`toolbox.marketingtools.apple.com/app-store/`, never redrawn in your cream palette), **never animated, angled, scaled-in, or recoloured**, one per video, subordinate to your main message, ≥40 px on screen with ¼-badge-height clear space kept empty — *and* an end-of-video trademark credit line.

**The words.** `App Store` — uppercase A and S, only ever preceded by "the". Banned strings: `Apple App Store`, `iTunes App Store`, `at the App Store`, `downloadable`, and any superlative. **`iOS` is banned outright** in marketing copy — use the product name. `iPhone` takes a lowercase i even at the start of a line, is never set in ALL CAPS (this kills `EXACTLY 67 FOR IPHONE` as a hook plate), is never pluralised, and the referential form is `Exactly 67 for iPhone`, never `iPhone Exactly 67`.

**No ® / ™ / ℠ anywhere.** Symbols are a US-only-distribution requirement; TikTok/Reels/Shorts are global, so symbols are affirmatively wrong. Never in headline copy, never on badge artwork.

**Credit line.** Required in any communication that uses an Apple mark. `App Store` is a **service mark**, not a trademark — the lumped "Apple, the Apple Logo, and App Store are trademarks…" line is wrong twice over (you show no logo, and it misclassifies the mark).

### What your end card should actually contain

**Organic posts (TikTok / Reels / Shorts) — no Apple marks in frame at all.**
Cut the CTA card entirely. `tools/make-posts.py:96` currently burns in `Exactly 67\nfree on the App Store` for 1.4 s. Removing it does three things at once: it eliminates every Apple obligation above, it lets the clip loop (rewatch rate is the top distribution signal), and it recovers 1.4 s of a 9.4 s video. The CTA moves to the caption and a pinned comment.

Set in `make-posts.py`:
```python
CTA_TEXT = ""        # organic build: no Apple marks on screen
CTA_SECONDS = 0.0
```
Keep the old values behind a `--cta` flag for the paid build.

**Paid / Spark variants only — badge end card, exact spec at 1080×1920:**
- Dominant element: `Exactly 67` wordmark + the 67-block icon, centred around y≈820.
- Badge: official PNG, unmodified, **140 px tall**, hard-cut (no fade, no pop, no slide), centred at y≈1480.
- Keep-out box: **35 px** on all sides of the badge — no text, no icon, no credit line inside it.
- Credit line, 26 px cream, at y≈1620 (outside the keep-out):
  `App Store is a service mark of Apple Inc., registered in the U.S. and other countries.`
  If the badge is present, use the two-sentence form:
  `Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other countries. App Store is a service mark of Apple Inc., registered in the U.S. and other countries.`
- Badge colour: **black** (its grey keyline is designed for dark layouts and is part of the artwork — never modify it). The white badge is permitted on dark but is a judgement call, not a compliance win. The day a Google Play badge joins the layout, black becomes mandatory and the App Store badge goes **first** in the lineup.

**Caption boilerplate (all platforms):**
`Exactly 67 is free on the App Store — link in bio.`
Not "free on iOS", not "at the App Store", no ®.

**Genuinely uncertain → conservative option.** Whether a caption that names "App Store" independently triggers the credit-line requirement is not settled by Apple's text. Conservative and cheap: put the credit line in the **pinned comment** alongside the CTA link. Pinned comments are a weighted positive signal anyway, so this costs nothing and closes the question.

**Device frames: don't.** Filming a real iPhone is allowed; a Figma/mockup-generator iPhone is an enumerated Unauthorized Use ("rendering in 3D or creating any simulation of an Apple product"). Only Apple's own downloadable bezels, used as-is, are compliant. Full-bleed canvas — which is what `tools/render-clip.mjs` already produces — has zero exposure. Your drama-order capture **reorders, it does not shorten** (`dramaOrder()` in `src/dev/capture.ts:333` returns a permutation of the same index set, paced in real time), so no "sequences shortened" disclaimer is owed even if a device ever appears.

**Enforcement reality check:** no primary source shows Apple pursuing an indie's organic social post over badge geometry. Treat the logo ban and any AI-simulated iPhone as blocking; treat badge geometry and credit lines as a one-time end-card template. Do not delay the batch over them.

---

## 2. The Noqyris studio-account decision

The call is correct and low-risk — Landfall runs one account for nine games (1.8 M followers), Devolver does the same. Follower count is near-irrelevant to per-video distribution; both accounts show views decoupled from followers. Stop tracking followers.

**Paste these exactly.**

| Field | Value |
|---|---|
| Handle (all 3 platforms) | `noqyrisgames` |
| Display name | `Noqyris` |
| Bio (≤ ~80 chars) | `Exactly 67 — a balance puzzle. free ↓` |
| Link | `https://apps.apple.com/app/id6787536995?ct=tt-bio&mt=8` |
| Account type | **Business** (bio link at 0 followers; Creator/Personal needs 1,000) |
| Original sound name (post #1, permanent) | `Exactly 67 — balance SFX` |

Bio grows Landfall-style as apps ship: `Exactly 67, <next title>, <next title>` — never a mission statement. The Website field only exists in the **mobile** app and the URL must include `https://` or it isn't clickable.

**Business account trade-off, accepted deliberately:** it locks you out of the general Sound Library. That costs you almost nothing because your gameplay slate runs original audio (§4). It only bites if you later pivot to trending-audio formats.

**Avatar.** `marketing/brand/avatar-1024.png` (blue 67 block) is a *game* mark, not a studio mark. Demote it: it becomes the burned-in bottom-left signature inside Exactly 67 videos at ~90 px, which is exactly what decouples per-game identity from a studio profile. Draw a new Noqyris avatar as a **balance-beam glyph** in the same ink-on-cream palette and the same rounded-block silhouette so it reads as the same house. No fruit, no leaf, no Apple typeface.

**Playlists.** Organise by **format, not by game** — neither precedent has a single game-titled playlist. A post can only live in one playlist, and re-sorting later is manual per video, so decide now:
- `Can you hit exactly 67?`
- `Balloon math`
- `Wrong answer only`
- `How it's built`

Check TikTok Studio → More tools → Playlist on day one; it's a gated rollout with **no follower threshold** (blogs claiming 10 k are confusing it with Series). If absent, fall back to the 3 pinned-post slots — one per game — and re-check monthly. **Drop "Series" from the plan entirely**; it's a paywall product, not an organiser.

**"6 7" discoverability.** The meme is dead and adult/brand use is now cringe-coded (Kamala Harris's "Headquarters 6-7" rebrand was reverted inside 24 hours; "6,7" topped LSSU's 2026 banished-words list). Therefore:
- Delete `six seven` from the display name (`marketing/BATCH-01.md:24`), from hooks 1 and 8 in `TIKTOK_PLAYBOOK.md` §4, and from the "say it out loud" instruction at `TIKTOK_PLAYBOOK.md:55`.
- Delete `#67` and `#sixseven` from `BATCH-01.md` lines 95, 131, 150, 189.
- **Keep them in the App Store listing metadata.** ASO keyword value is unrelated to social credibility.
- Before locking anything, run `six seven game`, `6 7 game`, `number puzzle`, `brain game`, `math game` through **Creator Search Insights** (type it into TikTok search, or tiktok.com/inspiration) and check the Content Gap view. That's the only way to measure residual `6 7` search demand.
- Make **exactly one** self-roast post about the name — "we shipped a game named after the 2025 meme. in 2026. anyway —" — then never mention it again. Not a recurring bit.

**Where per-game discovery actually lives:** the video. TikTok OCRs on-screen text, and `GameScene.ts:364` already renders `Level ${global}` on screen. Put `Exactly 67` and the level number in the burned-in plate within the first 3 s, and repeat both verbatim in the caption.

**Publish the identical files to TikTok, Reels and Shorts from day one.** TikTok views are down 31.3 % YoY; 85–90 % of creators in one games study got better organic reach on Shorts and Reels. Same 1080×1920 file, marginal cost is an upload.

---

## 3. Reel construction spec

### Format A — the backbone: 60–120 s ASMR chain *(new primary)*
Your 5–8 s clips sit in the worst-performing length bucket. Median views by length: 1–15 s = 1,274; 30–60 s = 2,200; 60–90 s = 7,200; 90–120 s = 9,620. Engagement *rate* still peaks at 15–30 s, but views are 7–9× higher at 60–120 s.

`chain` is currently clamped at 12 (`src/dev/capture.ts:192`). Change the max to 24:
```ts
chain: clampInt(q.get('chain'), 3, 1, 24),
```
Then:
```bash
npm run capture
node tools/render-clip.mjs --level 49 --mode asmr --chain 16 --pace 430 --lead 900 --hold 1100 \
     --out marketing/clips/asmr-49-64.mp4
```
Length ≈ `chain × (lead + placements × pace + hold)`. At ~5 placements/level that's ~4.2 s per level → 16 levels ≈ 67 s; 24 levels ≈ 100 s. `Level N` is already on screen, so it self-chapters with zero overlay work.

### Format B — 7–9 s loop-bait *(demoted to secondary)*
Cap at ~1 in 4 posts.

### Format C — Reels-specific cut: **8–12 s**
Average Reels watch time is 8.5 s. The 60–120 s TikTok cut will underperform there — cut a short variant rather than cross-posting the long one.

### Numeric spec (applies to all)
- **Frame 0 = the failure state.** Beam already slammed over, total reading a wrong number in red. Tension visible, not promised. No AI frames, no logo sting, no black frame in the first second.
- **0.0–1.2 s:** full tray + target visible, beam still settling (motion, not dead air). This is the send-trigger beat — sends are Reels' #2 ranking signal, behind watch time. Never *ask* for the send in text; that's bait.
- **Kill every static hold.** `BATCH-01`'s 4–6 s "no motion, no music sting" beat inside a 7 s video is a retention hazard — 3-second retention is the gate.
- **Hook plate: 0.0 → 1.6 s** (currently 0.0–1.9 in `make-posts.py`). Contains `Exactly 67` + the searchable phrase.
- **Text band: 42–61 % of frame height.** Already correct in `make-posts.py` — clear of TikTok's right-hand rail. Also keep the bottom 22 % and right 12 % free.
- **Beat text:** 168 px orange, ≤1.4 s, on the deciding placement. Keep `PUNCH = 0.10 / PUNCH_SCALE = 1.10`.
- **Burned-in AND native.** Keep the cream-on-ink plate — 80–92 % of viewers watch muted and it's the watch-time driver. But externally burned text is invisible to TikTok's classifier, so **retype the same line as a native TikTok/Reels text element for the first ~1 s**, and put the phrase verbatim in the caption. Run both. Zero re-render; it's an upload-step change.
- **CTA:** never on screen organically. Caption + pinned comment posted immediately after upload.
- **Loop:** end on the settled beam with no CTA tail, so the cut back to frame 0 is a hard beat rather than a card. Benchmark to beat: 20–30 % rewatch rate. *(A truly seamless loop needs the capture director to clear the pan after the win — not built yet; see §7.)*
- **Second-pass reward:** don't reveal the winning combination legibly until the final second, so a rewatch lets the viewer verify the math.
- **Face: no.** Faceless is competitive or better in 2026, and a small corner reaction cam is the worst of both. If a face is ever used it must fill the frame. **Do add a hand** — UGC-shaped creative lifts impression-to-install ~152 %. Film a real thumb dragging weights, cropped tight to the screen so no bezel or device silhouette is in frame; that keeps you out of Apple's product-image ruleset entirely.
- **Cadence: 4–5 posts/week**, 6–9 pm US, peak 8 pm. Higher frequency raises the tail, not the median, so batch-render 20 clips rather than polishing each post. A post is dead at 10 days (96 % of reach lands by then).
- **Captions: end every one with a question.** Posts with a question get +26 % comments — larger than the entire hashtag effect. `BATCH-01` currently has zero questions.
- **Hashtags: 3–4, not 5.** `#puzzlegame #satisfying #mobilegame #indiedev`. Put the real keywords in caption prose.
- **Never post the same MP4 twice with a different hook.** `A1.mp4`–`A4.mp4` are all `A-l71-fail.mp4` — that's the unoriginal-content shape, which makes posts FYF-ineligible. You have 72 levels and a scriptable renderer: **one level per hook variant**, hook as the controlled variable. Vary `--pace` and `--hold` per variant too, and space them across days.
- **Boost, don't spray.** Organic reach for gaming accounts is 4–8 %. Treat the first 20 posts as a creative-testing instrument; track 0–3 s retention and rewatch rate, not views. Spark-boost only the 1–2 posts clearing ~1.5× median engagement within 7 days. Target **US only** (TikTok US is ~67 % iOS; global TikTok is >90 % Android and worthless until you ship on Play).

### The evergreen corpus — do this before anything creative
TikTok maintains dedicated Discover pages for individual puzzle-level queries ("Color Block Jam Level 88", "Puzzle Game Level 110 Solution"). That is standing search demand nobody owns for your game.

Batch-render all 72 solves and publish one per level, on-screen text and caption reading literally `Exactly 67 — Level N`. Order by `marketing/CINEMATIC_LEVELS.md` ranking. **Shorts is the higher-value home for these** — YouTube search surfaces them for months; TikTok's tail is short. On Shorts, rotate the plate position and pacing per video so the batch doesn't read as templated mass production under YouTube's inauthentic-content policy.

---

## 4. Sound

**Settled: original audio for every gameplay and ASMR post. No trending sound.**

- Delete the instruction at `BATCH-01.md` ~line 60: *"for the other formats you'll usually drop a trending sound over the top."* That is backwards. Your synth SFX are unique to the game, and when someone else uses your original sound, every one of their videos links back to your profile — a discovery channel licensed music cannot give you. Original-sound videos also show higher retention and stronger follower conversion.
- Trending audio gets a larger *initial* push and would be the right call if your audio were generic. It isn't. The −18 LUFS mix **is** the product.
- **Only the dev-story / build-in-public format gets a trending sound**, and pick "rising + high niche fit" over broad viral. Note the Business account restricts you to the Commercial Music Library for this — acceptable.
- **Post #1 is one-shot: rename the original sound to `Exactly 67 — balance SFX`** before publishing. It cannot be changed afterwards. Default `original sound - noqyrisgames` wastes a permanent, tappable, game-branded search surface.
- Keep the `loudnorm` −18 LUFS mux exactly as is. Raw at −32 LUFS reads as silence in feed.
- **Audio continuity across the AI cut:** `tools/splice-opener.py` injects `anullsrc` silence under any opener with no audio track, so a spliced post opens with 2 s of dead air right before the first "thock". Since openers are moving to paid-only (§5), this mostly disappears. If you keep one, replace the `anullsrc` branch with a 2 s bleed of the post's own head audio so the track is continuous through the visual cut.
- Never use Apple device system sounds. Your own app's sounds are fine.

---

## 5. AI openers on fal.ai

**Reposition them: openers are a *paid* asset, not an organic one.** ~52 % of consumers disengage from content they read as AI, and seconds 0–2 are where the swipe happens — an AI shot there burns the hook window on non-product footage. In paid UA the same technique is the highest-leverage puzzle creative going (Pixel Flow $8.2 M → $16 M/month on AI hooks). So: **cut the opener from organic posts; keep generating them for Spark/paid variants**, where the fail-tone and AI-hook advantages are actually measured.

### Model
**`fal-ai/pixverse/v6/transition`.** It is the only endpoint combining min-1 s duration, a seed, *both* start and end frame control, 9:16, 1080p, and style presets. $0.090/s at 1080p without audio → **$0.18 per 2 s opener**; 20 openers at 3 takes each ≈ **$11**.

```json
{
  "duration": 2,
  "aspect_ratio": "9:16",
  "resolution": "1080p",
  "generate_audio_switch": false,
  "thinking_type": "disabled",
  "seed": 670067,
  "style": "clay",
  "first_image_url": "<master brand still>",
  "end_image_url": "<frame 0 of the gameplay post>"
}
```

- **Fire one test call first.** The v5.5 guide says 1080p is limited to 5 or 8 s; the v6 schema advertises 1–15 s with no coupling. Confirm you get a genuine 2 s file before queueing 20. Fallback: 720p at $0.045/s — fine, TikTok recompresses hard anyway.
- **Fallback model:** Wan 2.7 (min 2 s, seed, end frame) with `enable_prompt_expansion: false`.
- **Disqualified — no seed, so you can never iterate on a shot that worked:** Kling v3 (pro and turbo), LTX-2.3, Grok Imagine 1.5, Gemini Omni Flash, Luma Ray 3.2, Hailuo 2.3.
- **Disqualified on minimum duration — you'd pay 2–3× for footage you throw away:** Veo 3.1 (4 s), Seedance 2.0 (4 s), LTX-2.3 (6 s), Hailuo 2.3 (6 s). If you generated `scale-01.mp4` (5.06 s, 496×864) on one of these, that's what happened.
- **Turn native audio off explicitly.** Seedance, LTX, Kling v3 pro and Veo 3.1 all default `generate_audio: true`, which collides with your real SFX exactly at the cut point.
- **Kill silent prompt rewriting**, the single biggest cause of a 20-clip series drifting: `thinking_type:"disabled"` (PixVerse), `enable_prompt_expansion:false` (Wan), `prompt_optimizer:false` (Hailuo), `auto_fix:false` (Veo).
- **Skip LoRA.** Locked-master-still + fixed-seed i2v gets the same consistency at zero training cost. Revisit past ~50 openers.
- **No AI presenter / lipsync.** Delete prompt 6 from `FAL_BRIEF.md` — a synthetic talking head gives a multi-project studio account a fake-brand feel across every game.

### Making 20 generations look like one series
1. **Lock ONE master still** — the brass scale, pastel candy blocks, dark 67 block, cream backdrop from `scale-01.mp4`. This is the look; the prompt is not.
2. Generate 20 *variants of that still* with `fal-ai/nano-banana-pro/edit` or Seedream (~$0.04/image): different block counts, angles, weights. The master carries palette, lighting and materials.
3. Feed each variant to `/transition` with an **identical prompt scaffold and a fixed seed**. Never write a fresh text-to-video prompt per opener. Log the seed with every keeper.
4. **Pin the last frame to the gameplay's first frame:**
   ```bash
   ffmpeg -i marketing/posts/A1.mp4 -vframes 1 -q:v 2 marketing/stills/frame0-A1.png
   ```
   Upload it as `end_image_url`. This is what makes 20 openers cut cleanly without hand-matching — and it forces you off plain `pixverse/v6/image-to-video`, which has no end-frame field.
5. **Settle the style preset once:** generate the same seed + prompt three times at 540p ($0.035/s, ~$0.07 each) with `style` unset, `"clay"`, and `"3d_animation"`. Whichever wins becomes a fixed field for all 20.

### Prompt scaffold (fixed; vary only the middle clause)
`<SUBJECT MOTION> + <CAMERA MOVEMENT> + keep stable: cream background, brass scale, pastel block colours, dark 67 block, locked horizon`

### Device safety — mechanical reject check
`scale-01.mp4` is device-free (verified frame by frame) and so is the whole pipeline. Keep it that way: **prefer no device at all** — it's the stronger hook anyway and it's the only configuration with zero Apple exposure. Negative prompt every generation for: `iPhone, Apple, phone, smartphone, screen, home button, notch, sensor housing, Dynamic Island, Action Button, camera bump, side buttons, mute switch, logo`. Reject on any of those — plus the corner-radius silhouette and iOS-looking UI chrome, which Apple's list doesn't name but which read as an iPhone anyway. An AI-generated iPhone is an "artist's rendering"/"simulation", which Apple prohibits even though real photography of a device is allowed. Prompts 3 and 6 in the existing brief were the two most likely to put a phone in frame.

### Six prompts, built on the brass-scale shot that worked

**1. The impossible scale — v2 (the proven look, tighter)**
```
The oversized brass balance scale tips hard and slams down, chunky candy-coloured
weight blocks rocking and settling on the left pan while the dark block reading 67
holds firm on the right. Camera pushes in slowly on the pan, locked horizon, no roll.
Keep stable: cream background, brass scale, pastel block colours, dark 67 block.
No text, no people, no devices.
```

**2. Balloon sabotage — personifies the game's twist**
```
A cluster of pastel pink balloons strains upward and yanks the loaded pan of the brass
scale off balance, blocks sliding toward the edge as the beam swings. Camera holds
static at eye level, slight handheld drift, no roll.
Keep stable: cream background, brass scale, pastel block colours, dark 67 block.
No text, no people, no devices.
```

**3. The near-miss — matches the 68 fail body**
```
The brass beam trembles a hair off level and refuses to settle, one small candy block
teetering on the rim of the pan before it stops moving. Camera pushes in on the beam
pivot, locked horizon, no roll.
Keep stable: cream background, brass scale, pastel block colours, dark 67 block.
No text, no people, no devices.
```

**4. Overhead scatter — cuts to a full tray**
```
Overhead: dozens of glossy candy-coloured number blocks pour onto a cream surface and
bounce into a loose grid, settling in slow motion. Camera locked top-down, drifting
gently upward, no roll.
Keep stable: cream background, pastel block colours, dark 67 block. No text, no people,
no devices.
```

**5. The deflating balloon — the self-roast post's opener**
```
A single pastel pink balloon deflates and sinks slowly past the brass scale, the beam
untouched behind it, late afternoon light. Camera holds static, shallow depth of field,
no roll.
Keep stable: cream background, brass scale, pastel palette, dark 67 block. No text,
no people, no devices.
```

**6. Wide-concept absurdist test — the one that breaks the mechanic**
```
A wall of pastel candy blocks collapses like a domino run across a cream floor, the
last block landing upright and reading 67. Camera tracks sideways with the collapse
then snaps to a halt, locked horizon, no roll.
Keep stable: cream background, pastel block colours, dark 67 block. No text, no people,
no devices.
```
Test 5–8 opener concepts against the *same* gameplay body — the paid winners in this category are absurdist and unrelated to the mechanic, so don't confine yourself to literal scale imagery.

### Labelling
Self-toggle TikTok's AI-generated content switch on any post containing AI frames. Pre-emptive labels are reach-neutral; **retroactive auto-labels are associated with severe reach collapse**, and TikTok now auto-detects via C2PA Content Credentials that fal.ai output may carry. Stylised/abstract openers stay outside the mandatory-realism trigger entirely — another reason to keep them non-photoreal.

---

## 6. What to change in the existing assets

**Keep as-is**
- `marketing/clips/*.mp4` — all seven gameplay renders. Correct format, correct loudness, no Apple exposure.
- The cream-on-ink hook plate, its 42–61 % band placement, the `PUNCH` pop, and the −18 LUFS mux.
- `marketing/openers/scale-01.mp4` — device-free and on-brand. Demote it to the **master look reference** rather than a shipped opener (it's 496×864 and 5.06 s; regenerate at 1080p/2 s via PixVerse).
- `marketing/brand/avatar-1024.png` — repurposed as the in-video Exactly 67 signature, not the profile picture.
- `https://apps.apple.com/app/id6787536995` as the single bio link. No Linktree — it adds a click and untracked installs at n=1. Build `noqyris.com/apps` only when app #2 ships.

**Change**
- `tools/make-posts.py:96` — `CTA_TEXT = ""`, `CTA_SECONDS = 0.0` for the organic build; keep the Apple-compliant card behind a `--cta` flag for paid.
- `tools/make-posts.py` `SPEC` — hook windows `0.0–1.9` → `0.0–1.6`.
- `src/dev/capture.ts:192` — chain clamp max `12` → `24`.
- `marketing/BATCH-01.md:22–27` — handle `exactly67game` → `noqyrisgames`; display name `Exactly 67 · six seven` → `Noqyris`; bio `land on exactly 67. free on iOS 👇` → `Exactly 67 — a balance puzzle. free ↓` (the string `free on iOS` breaks Apple's messaging rules outright).
- `marketing/BATCH-01.md:9–13` — replace the CTA-frame block with "no Apple marks in frame; CTA lives in caption + pinned comment."
- `marketing/BATCH-01.md` hashtag lines 95, 131, 150, 189 → `#puzzlegame #satisfying #mobilegame #indiedev`.
- All `captions.json` captions → append a question to each. `"level 71 was easy tbh"` → `"level 71 was easy tbh. how long would this take you?"`
- `marketing/BATCH-01.md` ~line 60 — delete the "drop a trending sound over the top" default.
- `marketing/TIKTOK_PLAYBOOK.md:11` (`iOS-only`), `:55` (say "six seven" out loud), `:215` ("it's on the app store"), §4 hooks 1 and 8, §5 hashtags — rewrite per §1 and §2.
- Hook framing: `get this to exactly six seven`, `12 weights. one right answer.`, `nobody gets level 71 first try` are all intelligence-challenge framing, the pattern puzzle UA is moving *away* from. Keep them as the control and test a stakes variant against the same footage — the balloons are already antagonists: `the balloons are trying to ruin this`. Text-overlay change, no re-render.

**Remove / rebuild**
- **`marketing/posts/A1.mp4`–`A4.mp4`: four hooks over one identical `A-l71-fail.mp4`.** This is exactly the unoriginal-content shape that makes posts For-You-ineligible. Rebuild each from a **different level** (pull the top four from `CINEMATIC_LEVELS.md`), varying `--pace`/`--hold` per variant. The hook stays the controlled variable; the footage becomes genuinely distinct.
- **`marketing/BATCH-01.md` Session A: "Do not correct it anywhere: not in the video, not in the caption, not in the comments for the first six hours."** Delete. High completion followed by no positive action reads as dissatisfaction, and withheld-payoff phrasing is classified as engagement bait. The organic version must **resolve to 67 in the final second**; the uncorrected version runs as a paid/Spark creative only, where the fail tone's CPI advantage is proven. Cap the fail format at ~1 in 4 organic posts, and **reply to correction comments** rather than staying silent — threaded replies are a weighted positive signal, silence converts the post into pure bait.
- `marketing/posts/*-scale.mp4` (the four 11.43 s spliced versions) — do not post organically. They lead with 2 s of non-gameplay AI in the only window that decides distribution. Reclassify as paid/Spark creatives.
- `FAL_BRIEF.md` prompt 6 (UGC talking head) — delete.
- Audit every opening line for `wait for it`, `secret`, `watch what happens`, `link in bio` on screen. `this is the last level` is fine — it's a statement of fact.

---

## 7. Open questions / low confidence

1. **Apple enforcement against indie organic social video is undocumented.** No primary source, no credible report. Documented enforcement is about competitors using the *name* "App Store" and about in-app/metadata violations. Calibrate effort accordingly: logo and simulated-device issues are blocking; badge geometry and credit lines are a template you build once.
2. **Does a caption naming "App Store" trigger the credit-line requirement?** Apple's text doesn't resolve it. Conservative fix adopted above (pinned comment) costs nothing.
3. **`?ct=tt-bio&mt=8` may not attribute without a provider token.** App Analytics campaign links are documented as `pt=<provider token>&ct=<campaign>&mt=8`. Pull your `pt` from App Store Connect → App Analytics before treating install numbers as real.
4. **PixVerse V6 at 2 s / 1080p is unconfirmed** — the v5.5 guide says 1080p is 5 or 8 s only, the v6 schema says 1–15 s. One test call settles it.
5. **Seamless looping isn't achievable today.** Clips end on the locked beam with the win overlay up; frame 0 is a tilted board. A true loop needs a capture-director change (clear the pan and return to the untouched board after the win hold). Removing the CTA card gets most of the benefit; the rest is a `src/dev/capture.ts` change nobody has scoped.
6. **Residual "6 7 game" search volume is unmeasured** — TikTok search requires login. Creator Search Insights is the only instrument; run it before locking hooks.
7. **The "45 % reach drop for mixed-niche accounts" figure is unsourced SEO filler.** TikTok ranks per video, which is why the studio account works. The real cost of mixing lands on the *follower* relationship, not FYP distribution — manage it with playlists and pinned posts, never by splitting accounts.
8. **Reported ranking weights (captions 40 % / on-screen text 30 % / hashtags 20 % / audio 10 %) are unverified.** The directional claim — caption > on-screen text — is consistent across sources; the numbers aren't.
9. **Rewatch-rate primacy and the 20–30 % benchmark are agency analysis, not TikTok documentation.** Directionally well-corroborated, not a published spec.
10. **Trending-audio lift figures (48–68 %) come from low-quality sources.** The original-audio decision rests on the compounding profile-linkback mechanism and on your SFX being genuinely distinctive, not on those numbers.
11. **Framed-vs-full-bleed conversion data is category-dependent and mixed.** "Zero conversion gain from a device frame" is a judgement call, not a measured fact — the compliance argument for staying frameless is the solid one.
12. **Store screenshots at `store/screenshots/` were not audited** in this pass. That's a *live* Apple-facing surface; the unposted TikTok assets are not. Check it before the next release.