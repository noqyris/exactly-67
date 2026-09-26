<!-- Researched 2026-07-28 after the first batch failed to get views or follows.
     75 findings; the 10 riskiest adversarially re-verified. Several claims the
     research itself surfaced were REFUTED on checking and are corrected inline
     (voice-is-mandatory, playlist episode chips, profile-visits-as-ranking-signal,
     share-card-alone-works). The single-solution census in §1.3 was re-run
     independently against src/game/levels: 41 of 72 confirmed.
     This supersedes BATCH-01.md's posting plan and parts of PRODUCTION_BRIEF.md. -->

# Exactly 67 — short-form recovery plan

*Post-mortem, not a pep talk. Where the research handed to me was refuted on verification, I've used the correction and said so.*

---

## 1. The actual diagnosis

**Content dominates. Distribution is real but secondary, and it is measurable rather than arguable.**

### 1.1 You have only ever posted the losing format

Every one of the 25 posts is a montage: rendered gameplay, cut to music/SFX, no person, no speech. In the largest public 2026 format study (The Content Labs, ~4,000 TikTok/IG videos) montage averages ~12K views against ~56K for talking-head and 150K+ for greenscreen. You did not pick a format and execute it badly. You picked the one format that loses and ran it 25 times.

*(Caveat, honestly: single agency study, no published methodology. Treat the ranking as directional, the decimals as noise. It is still the best format-level data that exists, and nothing contradicts the direction.)*

### 1.2 The footage is literally UA-ad grammar

`tools/render-clip.mjs` outputs a device-free 1080×1920 canvas, deterministic pacing, offline-rendered SFX, a guaranteed win, and a black end card with an Apple badge. That is not "production value" — it is a byte-for-byte description of a Playrix-style pull-the-pin creative. Viewers have a decade-trained reflex for exactly this frame and it fires in under a second. Scrolling.media's 2026 breakdown names your asset as the losing baseline verbatim: *"a 15 second screen recording of actual gameplay."*

It gets worse in your own code. `dramaOrder()` produces the same drama-ordered solve at the same pace every time, and the `human` flag you added to fix that is a **seeded RNG** — a deterministic simulation of hesitation, which re-renders identically. And `minimalSolution(def)` means the clip *cannot fail*. Nothing you have posted has ever contained risk.

### 1.3 The content is terminal and argument-proof — this is the real one

`tools/prototypes/solution-census.ts` over the shipped packs: **41 of 72 levels have exactly one valid solution**, only 16 have more than one *optimal* solution, and balance is strict `=== 67` with no tolerance. You engineered disagreement out of the game as a quality bar.

Then every video shows the full solve, and every caption (25 of 26 in `marketing/posts/captions.json`) asks a rhetorical question about an answer already on screen. There is nothing to be wrong about, so there is nothing to say, so there are no comments, so there is no second distribution stage. `POSTING.md:99` mandates the question rule precisely because the footage generates none on its own — the caption is doing work the game refuses to do, and doing it badly.

Every viral number format on earth runs on defensible disagreement: PEMDAS wars, Terrence Howard's 1×1=2, Limmy's kilogram of steel vs kilogram of feathers (which is, note, a balance-scale joke — your exact domain).

### 1.4 The account is close to unclassifiable

TikTok's stated video-information signals are captions, sounds, and hashtags; a zero-history video's initial audience comes from lookalike modelling over content embeddings. You supply: no speech (no ASR transcript, no auto-captions), synth beeps (no sound cluster to attach to), flat vector on cream (weak visual embedding), and the hook **burned in** — which `POSTING.md` itself already notes is invisible to the classifier. That line in POSTING.md is not an optimisation. It is the load-bearing sentence in the whole document and it is not being enforced.

### 1.5 Cold start and geography — real, secondary, and testable

Do not catastrophise the view counts. Socialinsider's 2026 benchmarks (2M videos / 214,507 profiles) put 1–5K-follower accounts at ~350 views/post; Buffer's fixed-effects study (11.4M posts, 150,000+ accounts) puts median views at 489–506 regardless of cadence. Metricool measured 2026 TikTok views down **31%** YoY across 2.3M posts. If you are doing 200–400 views, **your views are normal** and you are reading a newborn account as a catastrophe.

There is also no new-account throttle. TikTok states outright: *"neither follower count nor whether the account has had previous high-performing videos are direct factors in the recommendation system."* **Do not restart the account** — you would also permanently destroy the one-shot renamed original sound.

Posting from Serbia is a genuine tax: your first few hundred viewers are Balkan and mostly cannot install a US-priced iPhone-only app. That depresses installs independent of content quality.

### 1.6 How to tell them apart from your own numbers

| Reading | Verdict |
|---|---|
| Median views 200–500, top-of-25 under 5× median | Normal cold start **plus** undifferentiated content. Not a distribution problem. |
| Retention at 3s under ~50% | Hook problem. Content. |
| Retention at 3s fine, completion low | Payoff problem. Content. |
| Comments per 1,000 views under ~2 | The content generates no disagreement. This is your likeliest primary failure. |
| FYP share ~70%+ but views at the floor | The algorithm tested you and stopped. Content. |
| FYP share low, most views from Following/profile | Distribution never happened. Rare; not your case. |
| Audience 80%+ Balkan, installs near zero | Geography tax. Real, but does not explain zero comments. |
| Profile visits healthy, follows ~zero | Profile problem — 30-minute fix, not a strategy. |

**The one experiment that cleanly separates content from geography:** $200–500 of Spark Ads boosting your single best existing organic post, targeted US. At $3.50–8 CPM that is 25K–140K genuine US impressions. If US engagement rate is also flat, it is the content, definitively. Run this in week 2, not after 30 posts. **Check first** whether a Serbia-registered ads account can even select the US — TikTok gates self-serve targeting by registration country, and this must be verified in Ads Manager before you plan around it.

**Correction to what you were told:** profile visits are *not* a "high-weight ranking signal" that costs you future distribution. I could not find the quotes attributed to Darkroom Agency or Hootsuite in either source — Darkroom in fact names rewatch, completion, shares and comments as the high-weight signals, and TikTok explicitly says prior account performance is not a factor. Fix the profile once because it converts visits you already get. Then go back to watch time.

---

## 2. What to stop doing

**Assets to retire from organic (keep every one of them for Spark/paid, where they are correct):**

- `tools/render-clip.mjs` output as the organic body. The clean device-free render is your ad-skip trigger.
- `marketing/brand/endcard.mp4` and `endcard-search.mp4`. A black plate with an app icon and an App Store badge at the point of maximum attention is the "ghost town / pure spam" swipe trigger, it taxes completion rate, and on TikTok the CTA is not even clickable. It is also a machine-readable commercial signal in every frame.
- The dark burned-in hook plate. Text goes on the cream background, and it must be **retyped as native TikTok text** on upload — that is the classification fix, not an aesthetic preference.
- The `N1`–`N22` batch as-is. Twenty-two interchangeable montages posted on a schedule optimise a metric that is already fine.
- `marketing/openers/` + `tools/splice-opener.py` + the whole fal.ai pipeline. Freeze it. Your bottleneck is that there is nothing worth filming, not that the filming is insufficiently cinematic.

**Habits to drop:**

- **The "every caption ends in a question" rule** (`POSTING.md:99`). Rewrite it. Captions on the primary format *assert*. And never write "comment your answer" or "who can solve this" — TikTok classifies that as engagement bait with a four-tier penalty ladder.
- **The spec-sheet hook.** "Exactly 67 — Level 71 / 12 weights. one right answer." is an App Store subtitle on a lower-third. It is unfalsifiable in 1.5 seconds, so no one can argue with it. "two moves. watch the beam." is worse — it is an instruction to keep watching, which you only write when the footage has no reason to be watched.
- **Six-seven positioning in `TIKTOK_PLAYBOOK.md`.** Wikipedia's 6-7 article documents the "Great Meme Reset" of March 2026, with teenagers mocking continued users ("who left you in 2025?"). `POSTING.md` already bans `#67`/`#sixseven`; the playbook still positions on it. Resolve in favour of POSTING.md. Keep six-seven in the App Store keyword field only — search demand is real and free there. Skip the planned self-deprecating post about the name entirely; do not anchor a new account to a dead meme.
- **Treating the studio account as the distribution channel.** *A Little to the Left* — the closest existing comparable, minimal, narrative-free, drag-and-drop — went 100K wishlists → 300K+ copies entirely through other people's accounts (beap.boop 3.3M views, Jacob Forster, Gab Smolders). No developer-account metrics appear in the gamediscover.co case study because they were not the mechanism.
- **Uploading byte-identical files under different names.** TikTok's originality enforcement (effective 15 Sep 2025) makes duplicate content FYF-ineligible.

**Turn ON:** the promotional-content disclosure toggle. TikTok's own comparison of ~2M videos found disclosure has no performance cost, while a retroactive undisclosed-commercial flag can make a post FYF-ineligible. You are carrying that risk for free.

**Do NOT do these things you may have been advised to:**

- **Do not delete `#satisfying` from `POSTING.md:83`.** I verified the sourcing: the "ASMR converts poorly to followers" evidence does not exist. One quote is about brand *sales* attribution and is truncated mid-thought (its next sentence is "It builds desire"); a second is guidance to brands on *hiring* ASMR creators; a third appears in no Influencers-Time article at all. Line 83 is the default tag set for 23 of 26 posts, and `#satisfying` is an accurate label for wordless SFX-driven gameplay. Misleading tags carry a stated TikTok penalty. The only defensible micro-change: on `LONG.mp4` specifically, swap `#asmr` for `#puzzle`.
- **Do not restart the account.**
- **Do not rewrite the bio into a daily-delivery promise.** See §6.
- **Do not throttle to "3–4 posts a week for follower conversion."** I traced those numbers (89%/72%/58% retention cliff; +41% follower conversion) to a single unsourced SEO aggregator page, and the agency they were credited to actually recommends 4–8 episode series. Buffer's 11.4M-post fixed-effects study shows posting frequency increases reach **monotonically** (+17% at 2–5/wk, +29% at 6–10, +34% at 11+) via more shots at virality. Post as often as you can without the clips getting worse.

---

## 3. The format to run instead

### "the game says no."

You already shipped the single best moment in the product and have never filmed it: the `useAll` blocked state, where the beam locks dead level, the HUD reads exactly 67, and the game refuses the win. `rules.ts` emits `blockedReason: 'use-all'` — the only blocked reason in the codebase.

Verified: **levels 17, 22, 46, 55, 63, 65** can all produce it. L65 (`src/game/levels/pack3.ts:52`, `[58,52,47,44,41,-40,-37,-33,-65]`, `useAll: true`) has three such placements, e.g. `52+47+41-40-33 = 67`, refused.

**Shoot it off a real phone. Hands only.**

- iPhone flat on a desk or in one hand, other thumb dragging. Second phone or a cheap arm overhead.
- Crop tight so no bezel or device silhouette enters frame — this also keeps Apple's product-image rules out of it.
- Whatever room light you have. Visible imperfection is the point.

**Beat sheet, 12–18 seconds:**

| Time | On screen |
|---|---|
| 0.0–1.5s | Board already up, tray visible, thumb entering. Native TikTok text on the cream: *"this is a bug right"* |
| 1.5–9s | Heavy pieces first so the beam slams over. **One mis-drag, corrected.** A real pause before the last placement. |
| 9–11s | Beam hauls back and locks dead level. HUD reads 67. The chime fires. |
| 11–14s | The game refuses. Hold on it. **Do not explain `useAll`.** |
| 14s | Hard cut. No end card. The loop point is the refusal. |

**Caption asserts, never asks:** *"it says 67. i think i broke my own game."*
**Pinned comment 20 minutes later:** the App Store link, nothing else.

**Why this specific format:**

1. It is physically un-fakeable by a render farm. A thumb, a room, a mis-drag, a hesitation — those are the verifiable human specificity that 2026 audiences use to distinguish content from slop.
2. **It resolves on screen.** This is the important distinction, and it is why I am overriding your own `POSTING.md:191` quarantine of `P1-fail.mp4` only partially. Your note there is correct: a near-miss with no payoff reads as bait, and high completion followed by no positive action is a dissatisfaction signal. The decoy is different — the payoff *lands* (the beam locks at 67, the chime plays) and then gets refused. Nothing is withheld. The argument is about whether the game is right, not about what the answer was.
3. It manufactures the disagreement your 41 forced-answer levels cannot. Half the comments will be wrong about why, which is the entire point. Cunningham's Law is the best-documented comment engine available: the physician who mis-said "buckshot" for "birdshot" drew ~1,600 corrections and 800K views, 300× his baseline.
4. Six levels means six posts from one afternoon of code.

**Face required: no.** Every named breakthrough in this space was faceless — Adrien Laurent's *The Matriarch* went 400 → 20,000 wishlists on one gameplay clip with no face, because ~20% of comments were people naming an anime the death animation resembled.

**Voice required per post: no — and I am correcting what you were told here.** The "voice is the highest-leverage thing you're refusing" claim does not survive checking. Its three citations are vendor content marketing: the Barchart piece is a syndicated press release for an AI-avatar product (Barchart's own footer disclaims review or endorsement), and its quote is used backwards — it argues you need a *face*, as a pitch to sell you a synthetic one. Clippie sells AI narration. And the mechanism is falsified outright by Khaby Lame at 160.3M followers, whose entire brand is an opinion delivered in silence.

**What is genuinely true:** you have five simultaneous absences (no face, no voice, no speech, no trending audio, no narrative) and the classifier gets almost nothing. Fix that with the cheapest lever first — native on-screen text and searchable caption prose — which costs zero and is already written into POSTING.md.

**Then run exactly one voice test, once:** lay a flat, dry voice track over the existing `marketing/posts/LONG.mp4` (77s). No re-render, one take. First five seconds: *"the left side is always 67. the pink ones are negative. you have to land it exactly."* Then keep talking through the near-misses. 77s sits in the second-best length bucket (61–90s ≈ 126K avg views vs 31–60s ≈ 28K), and Acorn Games' *Schrödinger's Cat Burglar* did 100K+ views and ~2K wishlists overnight on exactly that shape — a talked-through explainer, not a wordless loop. Post both versions. Let the data settle the argument instead of me.

**What you do need, and it is not a voice: a first-person authorial point of view.** "I made this level." "I checked all 4,096." "I think I broke my own game." Your playbook already contains this (F4 origin story, hooks at lines 255/257) — it has simply never been shot. Put the authorial line in the burned hook and the caption of posts you are already making, at zero marginal cost, and reply to comments in first person.

**Do not add per-post VO.** It inserts a manual step into a pipeline whose entire advantage is that one capture batch-renders into six posts, and cadence is the lever you would be spending.

---

## 4. Ten videos for the next two weeks

All shootable with what is on disk plus, at most, the ~5-line `mode=decoy` change at `src/dev/capture.ts:183`.

**1. "this is a bug right" — L65**
*Hook:* native text on cream, thumb entering frame.
*Screen:* hand-filmed. `52+47+41-40-33`. Beam slams, hauls back, locks level, HUD reads 67, game refuses. Hold 2s.
*Why it travels:* a visibly correct answer rejected by its own author's software. Nobody can watch that without wanting to explain it, and most explanations will be wrong.

**2–4. The same on L17, L22, L55**
Three more refusals, three different boards, three different caption assertions: *"67 is 67"* / *"my own game is gaslighting me"* / *"i wrote this rule and i still think it's wrong."*
*Why:* format repetition with genuine board variety is what you actually want — three data points on one format instead of twelve one-offs.

**5. "4,096 combinations. exactly one works. i checked all of them."**
*Hook:* that line, native text, over L71 (12 weights).
*Screen:* hand-filmed solve, real hesitation, no end card.
*Why:* verified true — `solver.ts` is an exhaustive bitmask search, and L47, L48, L69, L70, L71, L72 each have exactly one valid solution. Falsifiable and checkable, which is a dare rather than a boast. "I checked all of them" invites people to find a second one, which produces comments without asking for them.

**6. "level 71 is unsolvable. i checked."**
*Hook:* that, flat, wrong on purpose.
*Screen:* board, thumb hovering, no solve. Cut.
*Why:* pure Cunningham's Law. This is the one post that genuinely withholds — run it once as a control, not as a habit, and read whether it eats a bait penalty.

**7. The steel-and-feathers transposition**
*Hook:* *"which one lifts"*
*Screen:* a 67 candy block on one pan, a 67 balloon on the other. Nothing else. Beam. Hold.
*Why:* this is Limmy's kilogram-of-steel joke rebuilt in your own art, and Limmy's clip is a decade old and still spawning TikTok discover pages. **An external referent is what carried *The Matriarch* to 1M views** — recognition, not production quality. This is the cheapest recognisable referent you own, it takes ten minutes, and it needs no code.

**8. The voice re-cut of `LONG.mp4`**
*Hook:* the first spoken line, before anything moves.
*Screen:* the existing 77s 16-level chain, untouched.
*Why:* the one clean test of the voice question, at the cost of one take and no re-render. Post the silent version too as the control arm.

**9. "two people. same 67. different answers."**
*Hook:* that line.
*Screen:* split-screen or A/B cut of one of the 16 multi-optimal levels, two different valid routes to 67.
*Why:* the only content you currently own that contains a legitimate argument. This is the pilot for the game change in §5 — if the comments fight about which route was better, the multi-solution direction is validated and Daily 67 has a reason to exist.

**10. The wrong-but-legal solve**
*Hook:* *"solved it in 7. optimal."*
*Screen:* L47 cleared in 7 pieces when 4 exist. Two-star overlay visible if you can catch it.
*Why:* it resolves fully (no bait), and it is provably wrong in a way any viewer can demonstrate. Needs a small `capture.ts` addition — `solveLevel()` already returns the best mask, so a "worst valid solution" mode is a few lines in the same file.

**Cross-post all ten to Reels and Shorts.** Owlcat's 2026 creator data showed 85–90% of creators performing better organically on Reels/Shorts than TikTok, and TikTok game-content reach collapsed measurably across 2025 (one sponsored video: 425.8K views in June, 6K in November, same creator, same format). Shorts matters most for you specifically because the description link is clickable there — your TikTok caption URL is not a route at all.

---

## 5. What to build in the game, ranked by build cost

The load-bearing correction first: **a share card alone does not work on this game.** Wordle's grid is shareable because guesses differ between players. With 41 of 72 levels having exactly one solution, an answer-based card would be byte-identical for every player who clears a level — nothing to compare, nothing to post twice. The card must encode **the journey, not the answer**. The totals you pass through vary even when the answer doesn't, and the overshoot is the drama anyway.

Second correction: **build order is web destination before share artifact.** Wardle's growth was "one puzzle daily that everyone solves together, no ads, and no app" — click a link, playing in seconds. Your only link is an App Store install wall with zero ratings, plus AdMob and an IAP. A share card routing there imports the artifact but not the condition that made it convert. Also note Wordle went 90 → ~12,000 daily players *before* the share button existed; the button amplified a curve that press and a group chat had already started. At n≈0, amplification of zero is zero.

### Tier 0 — hours, do this week

| Change | Scope |
|---|---|
| `mode=decoy` in `src/dev/capture.ts` | The mode parse is one ternary at line 183; order selection at ~471–479 already picks a target subset. ~5 lines. **Unblocks 6 videos.** |
| `&order=3,7,1` param overriding `dramaOrder()` | ~10 lines. Unlocks the "comments are solving L72" series. |
| `countSolutions()` in `solver.ts` | `search()` already enumerates every mask and throws away all but the minimum. Collect instead. ~15 lines. Win overlay gains: **"you found way 2 of 4."** Cheapest argument-generator in the codebase. |
| Record the total trace | `placeWeight`/`removeWeight` both funnel into `afterChange()` at `GameScene.ts:792`. Push `ev.total` there. ~3 lines. Prerequisite for the share card. |
| Per-level solve timer | Start on first tap, stop on win. Gives you a number two players can compare — duet bait that asks for nothing, so it is not engagement bait. |

### Tier 0.5 — an afternoon, and it changes what the ASMR format can be

Exaggerate the physicality for filmed builds: real drop-and-settle on placement, an audible thunk with weight-proportional pitch, and a beam that visibly overshoots and *rings* before locking. `ScaleView` is already an under-damped angular spring — turn the damping down and lengthen the ring. Satisfying content needs a tactile object with a surprising outcome; you currently have flat rectangles that lock in ~200ms. *A Little to the Left* worked because pencils and cutlery have felt mass.

### Tier 1 — one evening: the share card

- New pure `src/game/share.ts` (~40 lines, zero deps, fits the `src/game` purity rule, unit-tests trivially).
- `@capacitor/share` (verified absent from `package.json`) + `src/services/share.ts` copying the fire-and-forget / web-no-op shape of `haptics.ts` (~25 lines).
- A Share button in `showWinOverlay` (`GameScene.ts:900`) — `makeButton` already exists.

**~120 lines total.** The artifact, from the working prototype in `tools/prototypes/share-card.ts`:

```
Exactly 67 · Daily #12        Exactly 67 · Daily #12        Exactly 67 · Daily #12
⬛⬛⬛🟩                        ⬛⬛⬛⬛⬛🎈🎈🟩                  🎈🎈🎈⬛🎈🎈🎈🟩
4 pieces · peak 149 ·         5 pieces · peak 181 ·         6 pieces · low 12 ·
way 1/3 · ★★★                 way 2/3 · ★★☆                 way 3/3 · ★☆☆
```

`⬛` pan down, `🎈` pan up, `🟩` exactly 67. Your own two objects, so it reads to someone who has never played. Deltas hidden, so it is spoiler-free. **`way 2/3` is the argument engine.** Record removals as a distinct glyph — that is your wasted-guess marker, and it is what makes a Wordle grid worth posting.

Default the share sheet to the Messages row. The card's job is being sent to one specific person who argues about maths, not broadcast.

### Tier 1.5 — a day, and it is the one I would actually prioritise

**Deploy the free web build.** The game already runs in a browser via `npm run dev`, every native service guards on `Capacitor.isNativePlatform()` (`ads.ts:157`, `iap.ts:34`, `review.ts:40`), and `docs/` already serves GitHub Pages. This is close to free.

Point the bio link there, not at the App Store. It restores the actual Wordle/neal.fun mechanism — tap, play, no install, no account — and gives you a URL people can send each other, which an App Store link is not. *The Password Game* has been played 10M+ times as a browser page; *Infinite Craft* launched on neal.fun and only shipped to iOS/Android three months later, after the web virality, not because of the apps.

Without this, everything in Tier 1 and Tier 2 routes into an install wall.

### Tier 2 — a weekend: Daily 67

`tools/prototypes/daily-generator.ts` is already written and measured:

```
unconstrained:                    0 failures / 40 days · median 0 retries · 200 boards in 2ms
forced multi-optimal (2-4 ways):  0 failures / 40 days · median 3 retries · 200 boards in 9ms
```

It picks a hidden solution first (guaranteeing solvability), pads with decoys, then rejects on a quality band. `MAX_LEVEL_WEIGHTS = 16` makes the 2ⁿ validation free. Everyone called this "heavy." It is ~70 lines and instant.

**Note the build gate does *not* cover this.** `validatePacks(PACKS)` runs at build time over the shipped packs only; a generated or injected level bypasses it entirely and needs its own runtime `solveLevel()` guard plus an `n <= 16` check, or `solver.ts:37` throws. This is also the correction to the "community levels are safe because the build gate catches them" idea — it does not.

The real work is `GameScene` surgery (~80 lines): it currently assumes `levelByGlobal(global)` and keys progress, ads and review off `ref.global`. Needs a daily branch. Plus `src/game/streak.ts` (~25 lines, pure) and two storage keys copying the six near-identical accessor pairs already in `storage.ts`.

**Reset at 6:07 local.** That is the only non-cringe use of the name left, and it is a free ritual hook.

**Design calls:** keep the campaign forced (the "exactly one works, I checked all 4,096" hook is genuinely excellent and elegance is the product); make the *daily* multi-optimal so comparison and argument happen there. And pre-schedule **Day 67 as an unsolvable board** — needs an `impossible: true` escape hatch (~20 lines) since the gate would reject it, but as a one-off dated event it is the most divisive artifact you can ship, everyone fails identically, and the comment section is people insisting they solved it. Reveal after 24h. Put it in the calendar the day the daily launches.

**Justify Daily 67 as retention, not as a growth hack.** 72 static levels give nobody a reason to return. Nothing in the Wordle record supports "daily = subscription pitch" for a game behind an install wall.

### Tier 3 — later, only once Tier 2 has an audience

**Level editor + share code.** `LevelDef` is four fields. A base33 encoding (no I/L/O) puts your hardest 12-weight level in **24 characters**: `67-5R5B564Z4M4G1S1T25282C2N`. Pasteable, not sayable. `solveLevel()` gates code generation, so unsolvable submissions are impossible by construction. Geometry Dash hit an all-time Steam concurrent peak of 109,993 in March 2026 with no developer update, driven by TikTok clips of its level editor. This is the highest-ceiling item and the only one that makes the audience produce your content — and it is worthless until there is an audience.

**Honest total:** Tier 0 + 1 + 1.5 is about a week of evenings. Tier 2 is a weekend. This is not the multi-month build everyone told you it was.

---

## 6. How to earn a follow

**First, correct the KPI.** For a free iOS game with ads and an IAP, followers are near-irrelevant to per-video distribution — TikTok says so directly — and near-irrelevant to installs. Your own `PRODUCTION_BRIEF.md:62` already reached this conclusion with named comparables (Landfall: one account, nine games, 1.8M followers). Do not trade install intent for follower count.

That said, zero follows across 25 posts *is* a real signal, because follows are the one metric distribution does not gate. It says nobody perceives a someone behind the account.

### The promise mechanic

Name one series and run it. **"the game says no"** is the one you have. Number episodes in the burned hook and the caption for grid legibility — but keep every clip **self-contained**, and do not write "part 4 of 8" in the hook. Almost every viewer arrives cold and has never seen episode 3; sequential framing tells them they missed something.

**Correction on playlists:** you were told TikTok shows an "Episode 3 of 8" chip and that playlist autoplay overrides the For You feed. Neither is true. TikTok's Creator Academy page never uses the word "episode," and describes playlist traversal as requiring the viewer to *click the link* to the Playlist Details page — in-feed, the next swipe is still the algorithm's. I checked a live public playlist: no chip, no counter, the header reads "4 posts." Most importantly, TikTok states playlists are **"only available to creators with over 10k followers."** Spend 30 seconds checking TikTok Studio → Tools → Playlist to see if the option exists for you at all; if not, drop that half entirely.

The recurring constants you actually have and should never post without: the burned 67-block signature (`PRODUCTION_BRIEF.md:79`), the named original sound "Exactly 67 — balance SFX" (permanent, tappable, back-links every use to your profile — this is a better signature than most faceless accounts have), the all-lowercase no-emoji caption voice, and now the hand. Add: **a first-person authorial voice in text.** That is the difference between a product feed and a person with a game.

### Exact profile changes

**Keep the bio as planned:** `Exactly 67 — a balance puzzle. free ↓` plus the link. **Do not rewrite it as a daily-delivery contract.** The bio is ~80 characters and it holds the only 2-tap route to the store; captions and comments are not clickable on TikTok. A delivery promise is a straight swap against the install CTA, and it publicly commits you to 7/week against a plan you should not be running. If you want a cadence signal, put it in a pinned comment.

*(Once the web build ships — Tier 1.5 — the bio link should point at the free daily on the web, not at the App Store. That changes the calculus entirely and is a better reason to touch the bio than any of this.)*

**Business vs Creator account — decide this deliberately, it is a real trade.** Business gets you the bio link at 0 followers but locks you to the ~150,000-track Commercial Music Library; using a general-library track gets the video muted or struck. Creator keeps the full catalogue but needs 1,000 followers for a link. Given that trending audio is not part of the plan (six-seven is dead, and your original sound is a genuine asset), **stay Business** and keep the link.

**Do now (30 minutes total):**
1. Device and app language to English; keep all on-screen text and captions in English. This is the only officially-confirmed account-level region lever. Do not VPN-spoof — SIM and device settings feed region detection anyway, and misrepresentation risks suspension.
2. Schedule posts into the US 6–9pm window (peak ~8pm). That is 3–6am Belgrade, so it must be scheduled, never posted live.
3. Turn on promotional-content disclosure.
4. Make the **"who makes this"** post — this is the one genuine gap. Hands, the solver terminal printing `L71: 4096 masks · 1 solution`, a level being authored in `pack3.ts`. No face, no voice, text on screen. It is scoped in `PRODUCTION_BRIEF.md:83` and has never been shot.
5. Leave the three pin slots empty until you have 10+ posts worth choosing between. Pinning 3 of your first 5 signals nothing.

### The comment loop — use it, don't build a strategy on it

Reply-with-video is a real mechanic (the comment renders as a tappable sticker; the reply posts as a normal video). It is an **amplifier for a post that already has comments**, not an engine, and it cannot bootstrap from zero. The claims that it "gets more views than the original" and "notifies the commenter's network" are not in the sources they were attributed to — TikTok notifies the commenter only, and the sticker taps *backward* to the old video. The one thing creator reports agree on: *"regular uploads still bring the real growth; creators use replies mainly to milk a topic that's already doing well."*

So: when a decoy post actually accumulates comments, reply-with-video to the best wrong explanation and the first right one. Opportunistically. Not as the publishing loop.

The **"comments are solving level 72"** 5-part series (needs the `&order=` param, ~10 lines) is worth running once the account has any comment volume at all. Episode 5 either lands on 67 or the comments collectively fail. The failure ending is the better one.

---

## 7. Realistic expectations

**Baseline, calibrated to 2026:**

| Metric | What normal looks like |
|---|---|
| Median views/post, sub-5K account | **300–500.** Discount any pre-2026 benchmark ~30% (Metricool: views −31% YoY across 2.3M posts). |
| 90th-percentile post at 2–5 posts/week | ~3,700–7,000 |
| Top post across 30 posts | 5–10× your own median |
| Follows | 0–2 per post. Single digits per week is not failure. |
| Where the reach lands | 96% within 10 days; 72.7% from FYP |

**At n=10 you have no signal at all.** Buffer's distribution is heavily right-skewed — you expect exactly one post in your own top decile out of ten, which is indistinguishable from luck.

**The decision rule, set in advance:**

- Run **30 posts across no more than 3 formats (10 each)**. Twelve one-off variants, which is what `BATCH-01.md` is shaped like, is unreadable data.
- A format is **signal** only if it clears **5× your trailing-20 median**, or if two posts of the same format both clear **3×**. Anything else, do not iterate on it.
- Judge every post at **day 10** and never revisit. 96% of its reach is spent. "It might pick up" is not a real hope on TikTok — it is on Shorts, which is another reason to cross-post.
- Log per post from post #1: views, retention at 3s, completion, rewatch, comments, shares, profile visits, follows-from-video, audience country split. If engagement rate declines while views hold flat, that is creative fatigue and the answer is a format change, not more posts.

**Thresholds that mean "the content is wrong," not "the account is young":**
- Retention at 3s under 50%.
- Comments per 1,000 views under 2 after 10 decoy posts. This is the number I would actually watch. The whole thesis of the decoy format is that it manufactures comments; if it doesn't, the thesis is dead.
- Rewatch under ~15%.

**When to conclude short-form is the wrong channel — say it plainly:**

If after 30 posts, including at least 10 hand-filmed decoy/refusal posts, **and** after the $200–500 US Spark test, you have: best post under 5× median, comments/1,000 views under 2, and US audience share under 20% — stop. Do not iterate a fourth time.

That outcome means the channel is not the problem to fix. Reallocate to:
1. **Creator seeding.** 20 micro-creators in puzzle/satisfying/mobile-games, DM'd a free App Store link. The game is free, so there is no gifting friction. Budget ~$200/month for the 3–5 who post; Spark-boost anything clearing 1.5× median. *A Little to the Left*'s entire growth was this.
2. **Apple editorial.** Historically the reliable channel for a minimal iOS puzzle. It costs one form.
3. **The web build + daily.** Growth mechanics you own, on a surface no algorithm can throttle.

And be honest about the prior going in: **I could not find a single minimal/abstract puzzle dev who built a real short-form following from zero in 2025–26 by posting their own gameplay.** Every named success in the category came from somewhere else — a shareable artifact (Wordle, Infinite Craft), streamers (*A Little to the Left*, Megabonk), fan UGC (Sprunki), Apple editorial, or an external meme referent (*The Matriarch*). Chris Zukowski, the most-cited data source in indie marketing, reports flatly that for most devs "nothing really works on Twitter and TikTok."

If your plan is "keep posting better-rendered gameplay clips until it clicks," the evidence says it will not.

---

## 8. Open questions and low-confidence items

**Things I am recommending on thin evidence — flagged honestly:**

1. **The Content Labs format/emotion/length numbers** (montage 12K vs greenscreen 150K; fear 264K vs curiosity 98K; 90s+ 170K) are a single agency study with no published methodology. I use the direction; ignore the decimals. Nothing contradicts the direction, but nothing independently confirms it either.

2. **Whether voice/TTS lifts anything for this content is genuinely unknown.** I found no credible study either way. The `LONG.mp4` re-cut is the experiment, and it costs one take.

3. **Whether the decoy format eats an engagement-bait penalty.** Your own `POSTING.md:191` concluded an unresolved near-miss reads as bait organically, and that reasoning is not obviously wrong. My argument is that the decoy *resolves* (beam locks, chime fires) and is therefore a different animal — but this is my inference, not a documented distinction. Post concept #6 (the genuinely withheld "unsolvable" post) is the one that carries real risk; run it once, watch for the in-app notification, do not build a habit on it.

4. **`#67` / `#sixseven`.** Genuinely unresolved. The Great Meme Reset is well-documented and argues against it; the search volume is also well-documented and argues for it. My split: hashtags are a classification input, not an identity statement, so a reversible split test across 20 posts is cheap and fine. Hook copy and spoken words are identity — never there. And keep it in the ASO keyword field regardless (your current keyword string indexes nothing for six-seven; swapping `zen,mental,sums,addition,relax` for `sixseven,brainrot,67,meme,number` is one ASC metadata edit with no build).

5. **The Serbia region tax.** TikTok does name country setting as a signal, but the "cannot be changed / 60-day requirement" details are user-report level, not documented. The Spark test resolves it empirically.

6. **Whether a Serbia-registered ads account can target the US at all.** Must be checked in Ads Manager before you plan around Spark. If not, the documented routes are a TikTok Marketing Partner account or an entity registered elsewhere.

7. **Whether playlists are available to this account.** 30-second check.

8. **"Polish is now a negative signal."** Plausible and widely asserted in 2026 syntheses, poorly evidenced. Note that the UGC-lift numbers everyone quotes (152% impression-to-install, 4× CTR, 12× engagement) come from ad platforms and UA vendors with a commercial interest in that conclusion. The mechanism I actually trust is narrower and better-supported: UGC-shaped creative converts better because it does not trigger the ad-skip reflex. That is enough to justify filming the phone.

9. **The multi-solution thesis is untested on this audience.** Concept #9 is its pilot. If "two people, same 67, different answers" generates no argument, then Daily 67's multi-optimal constraint — the whole reason the daily would be worth building — loses its justification, and the daily is retention-only. Run #9 before starting Tier 2.

10. **`#satisfying`, ASMR, and follower conversion.** The claim that ASMR converts poorly to followers does not survive source-checking (see §2), and I could not find good evidence either direction. I am recommending you keep the tag on the grounds that it is accurate. That is a weak basis, but it is stronger than the basis for removing it.

11. **What I could not check at all:** your actual analytics. Everything in §1.6 and §7 is a framework for reading numbers I have never seen. Pull profile-visits vs follows-from-video, retention-at-3s, and the audience country split before you act on the diagnosis — if the audience is 85% Balkan and retention at 3s is 70%, this document's priority order is wrong and the answer is Spark Ads and seeding, not new formats.