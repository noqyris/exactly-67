# Exactly 67

A balance-scale number puzzle for iOS: the left pan holds a fixed **67**, and you fill the right pan with signed weights until its total is **exactly 67** and the beam locks level. Positive weights are down-weights (pan sinks); negative weights are balloons that lift/pull the pan up. **600 levels across 25 packs** — the first 72 hand-authored, the rest generated and solver-verified by `tools/generate-levels.ts`, each pack harder than the last.

## Stack

- **Phaser 3** (`^3.90`) — rendering + input, all art drawn in code (zero image/audio assets)
- **TypeScript** (`^5.9`, strict) + **Vite** (`^5.4`) — build/dev
- **Vitest** (`^2.1`) — unit tests + build-time content gate
- **Capacitor 8** (`@capacitor/core|ios|haptics|preferences`) — iOS wrapper (`appId com.noqyris.exactly67`, `webDir dist`)
- **iOS, portrait-only.** Android-ready but not shipped. Capacitor CLI needs **Node >= 22** (documented, not enforced — no `engines` field, no `.nvmrc`).

## Commands

| Command | Script | What it does |
|---|---|---|
| `npm run dev` | `vite` | Browser dev server (hot reload). |
| `npm test` | `vitest run` | Run the logic + level-validation suite once. |
| `npm run test:watch` | `vitest` | Same suite in watch mode. |
| `npm run build` | `tsc --noEmit && vitest run && vite build` | Typecheck → test → bundle to `dist/`. **`&&`-chained: any stage failing aborts the rest.** |
| `npm run ios:sync` | `npm run build && cap sync ios` | Build web, copy into the native iOS project, sync plugins. Needs Node >= 22. **This is the App Store path.** |
| `npm run ios:sync:tf` | `VITE_UNLOCK_ALL=1 npm run build && cap sync ios` | Same, but unlocks **every level** for testers (`services/buildFlags.ts`). TestFlight only — the flag is absent from a normal build, so production is locked by default. |
| `npm run ios:open` | `cap open ios` | Open `ios/App/App.xcodeproj` in Xcode. |
| `npm run capture` | `vite --port 5199` | Dev server on a fixed port for **marketing video capture** — open `?rec=<level>`. |
| `npm run capture:levels` | `vite-node tools/cinematic-levels.ts` | Re-rank every level by how well it films → `marketing/CINEMATIC_LEVELS.md`. |
| `npm run levels:generate` | `vite-node tools/generate-levels.ts -- --report` | Regenerate packs 4–25 (seeded, idempotent, solver-verified) and print the difficulty ramp. **Never edits packs 1–3.** |
| `python3 tools/make-posts.py` | — | Burn hook/beat/CTA text into the rendered clips → upload-ready `marketing/posts/*.mp4` (PIL renders the text; this ffmpeg has no `drawtext`). |
| `python3 tools/make-endcard.py` | — | Render the animated Noqyris end card to `marketing/brand/endcard.mp4` (PIL frames → H.264 + silent AAC, stream-copy-compatible with the posts). |
| `python3 tools/splice-opener.py` | — | Conform an AI-generated cold open to 1080×1920/60fps and concatenate it in front of a finished post. |
| `npm run capture:render` | `node tools/render-clip.mjs` | Render a 1080×1920/60fps MP4 of a level offline, SFX included (headless Chrome + virtual time + offline Web Audio + ffmpeg). Needs the dev server up and **Node ≥ 22**. |

> **`npm run build` is a hard content gate, not just a compile.** Stage 2 (`vitest run`) runs `src/game/levels.test.ts`, which asserts `validatePacks(PACKS)` returns `[]`. If any shipped level is unsolvable or malformed, that array is non-empty, the test throws, vitest exits non-zero, and the chain aborts **before `vite build` ever runs**. You cannot bundle a broken level.

## Architecture

Three layers, strict one-way dependency: **`render`/`services` depend on `game`; `game` depends on nothing** (no Phaser, no DOM, no service imports anywhere in `src/game`).

### `src/game` — pure logic (framework-free, fully unit-tested)
| File | Role |
|---|---|
| `types.ts` | Contracts + `TARGET = 67`. `LevelDef`, `LevelPack`, `Evaluation`. |
| `balance.ts` | Stateless math over a total: `panTotal`, `gapToTarget`, `isBalanced` (strict `=== 67`), `beamAngleDeg`. |
| `rules.ts` | Placement state machine over `Placement = boolean[]`: `initialPlacement`, `canPlace`/`place`, `canRemove`/`remove`, and the authoritative `evaluate()`. |
| `solver.ts` | Brute-force subset solver `solveLevel()` + build-time `validatePacks()`. `MAX_LEVEL_WEIGHTS = 16`. |
| `stars.ts` | `starsForClear(used, minWeights)` → `1 | 2 | 3`. Standalone, no imports. |
| `progress.ts` | Persisted model (`mergeClear`, `isUnlocked`, `parseProgress`, …). Pure; storage I/O lives in `services`. |
| `levels/` | `pack1/2/3.ts` hand-authored (24 each) + `pack4…pack25.ts` **generated** → aggregated in `index.ts` as `PACKS`, `TOTAL_LEVELS` (600), `levelByGlobal`/`globalOf`. **Progress is keyed by global level number, so packs may be appended but never reordered or resized.** |

Internal deps only: `balance ← rules`, `types ← everything`, `solver` and `stars` are only exercised together in tests. `rules.ts` never imports `solver`/`stars`/`progress` — the UI orchestrator wires those together.

### `src/render` — Phaser scenes + Graphics-only vector art
| File | Role |
|---|---|
| `../main.ts` | Boot: awaits font + settings, builds `Phaser.Game`, scenes `[MenuScene, LevelMapScene, GameScene, StoreScene]` (Menu auto-starts). Also grandfathers the pre-split `unlimitedHints` entitlement — see `services/storage.ts`. |
| `../splash.ts` | Studio sting (`public/splash.mp4`, muted + `playsinline`, markup inline in `index.html`). Plays *over* the boot; dismisses on end/tap/error/autoplay-refusal/8s timeout, skipped under reduced motion. Two invariants: the overlay stays in the DOM as an **invisible input shield** until the finger is up (Phaser fires buttons on a bare `pointerup` re-hit-tested at the release point, so a skip tap would otherwise press Play underneath), and `initSplash()` returns a promise that ads wait on so no native view draws over the sting. |
| `layout.ts` | `DPR` (clamped 1–3), `u(n)=n*DPR`, `contentFrame()` (caps play area to 680×940), `safeArea()`, `prefersReducedMotion()`. |
| `palette.ts` | Single color/typography source: `INK`, `BG`, candy fills, `weightColor(value)`, `FONT`. |
| `MenuScene.ts` / `LevelMapScene.ts` / `GameScene.ts` / `StoreScene.ts` | The four scenes. `GameScene` (~700 LOC) is the play loop; `StoreScene` is the shop (hint packs + the unlimited/no-ads unlock + Restore). |
| `ScaleView.ts` | The beam: under-damped angular spring toward a target angle; upright hanging pans; `setWon()` locks level. |
| `WeightView.ts` | One draggable weight (`value>0` = candy block, `value<0` = balloon), Graphics-only. |
| `ui.ts` | Shared helpers: `makeButton`, `makeIconButton`, `drawStar`, icon glyphs, `TEXT.ink/cream` style factory. |

### `src/services` — platform abstraction
| File | Role |
|---|---|
| `audio.ts` | Web Audio **synth** — every SFX generated from oscillators + gain envelopes at play time. No audio files. Owns the shared `audioContext()` (ungated) plus a private effects-gated accessor. |
| `music.ts` | The background bed — **generative**, not a loop: a slow I-vi-IV-V in C with a melody re-rolled each bar from the pentatonic scale, so it never repeats audibly. Own toggle, own storage key, look-ahead scheduler, `duckMusic()` for the win. Parks while hidden or while the context is suspended. See [`docs/AUDIO.md`](docs/AUDIO.md). |
| `haptics.ts` | Toggle-gated `@capacitor/haptics` wrapper; fire-and-forget, silently no-ops on web. |
| `ads.ts` | Toggle-gated `@capacitor-community/admob` wrapper (banner / interstitial / rewarded-hint); same fire-and-forget, web-no-op pattern as `haptics.ts`. Runs on **Google test ad units** until real IDs are wired — see [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `iap.ts` | IAP wrapper — StoreKit via `cordova-plugin-purchase` (`CdvPurchase` global; no bundler import, injected natively). Sells three **consumable** hint packs (`HINT_PACKS`, 10/30/100) plus **two non-consumables**: `NO_ADS_ID` ($0.99, ads off only) and `REMOVE_ADS_ID` ($4.99, ads off **+ unlimited hints**). Web-no-op. **Two separate entitlements** — `ads.adsRemoved()` (either product) and `ads.hintsUnlimited()` (the $4.99 one only). Gameplay must gate free hints on `hintsUnlimited()`, never `adsRemoved()`, or the cheap product hands out the expensive perk. **Price-ladder invariant: the $4.99 unlock must stay dearer than the largest pack ($2.99).** See [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `review.ts` | "Rate this app" wrapper — native StoreKit prompt via `@capacitor-community/in-app-review`. One-shot (persisted flag), web-no-op; `maybeRequestReview` fires from the win overlay at a delight peak. See [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `storage.ts` | `@capacitor/preferences` wrapper. Keys: `exactly67.progress` (JSON), `exactly67.sound`, `exactly67.haptics` (`'on'`/`'off'`), `exactly67.music` (`'on'`/`'off'`; **absent = the `MUSIC_ON_BY_DEFAULT` constant in `main.ts`**, not the on-by-default `loadFlag` rule), `exactly67.adClears`, `exactly67.adsRemoved`, `exactly67.hintFreeDate` (daily-top-up date), `exactly67.hintCount` (hint inventory), `exactly67.reviewRequested`, `exactly67.unlimitedHints` (`'on'`/`'off'`; **absent = pre-split install**, grandfathered from `adsRemoved` at boot in `main.ts` so old $0.99 buyers keep unlimited hints). |
| `progressStore.ts` | In-memory cache of `Progress` so scenes read synchronously; write-through on every clear. |

### `src/dev` — dev-only surfaces (never in the shipped bundle)
Both are dynamically imported from `main.ts` behind `import.meta.env.DEV`, which is
statically `false` in a production build, so Vite tree-shakes them out entirely.

| File | Role |
|---|---|
| `testBridge.ts` | Read-mostly `window.__e67` view of the running game for E2E: active scene, all Text strings, every `WeightView` with its world position, interactive buttons, `seedProgress`. Never mutates state. |
| `capture.ts` | **Capture director** for marketing video. `?rec=<level>` scripts a level through the real `placeWeight` path (so sound/haptics/spring/win all fire authentically) in "drama order" — heaviest weights first, balloons last, so the pan overshoots hard then gets hauled back to 67. Modes: `solve` / `fail` (stops on the nearest legal wrong answer) / `asmr` (chains levels). See [`marketing/TIKTOK_PLAYBOOK.md`](marketing/TIKTOK_PLAYBOOK.md). |
| `audioRender.ts` | Offline **SFX re-render** for those clips. Swaps `window.AudioContext` for a proxy over an `OfflineAudioContext` whose `currentTime` reports elapsed virtual time, so every note `services/audio.ts` schedules lands at its true offset in a WAV buffer. `services/audio.ts` is untouched — the proxy just has to be installed before the first sound, since that module caches its context on first use. |

## Core data flow

```
tap/drag weight
  → canPlace / place  (or canRemove / remove)   [rules.ts]   → new Placement
  → evaluate(level, placed)                      [rules.ts]
  → Evaluation { total, gap, balanced, won, blockedReason? }
      ├─ scaleView.setTargetAngle(beamAngleDeg(ev.total))  → beam tilt (spring)
      └─ updateHud(ev)                                     → total chip color + gap text
  → on ev.won: winSequence
      → used = placedCount(placed);  min = solveLevel(level).minWeights
      → starsForClear(used, min) → 1|2|3
      → recordClear → mergeClear(progress, global, stars, used) → saveProgress
```

`evaluate` is the single source of truth. `won = balanced && !(useAll && !allPlaced)`; a `useAll` level can read `balanced:true` at 67 yet `won:false` (remaining balloons net to zero but must still come aboard) — signalled by `blockedReason: 'use-all'` (the only blocked reason).

`beamAngleDeg(total) = 13 * tanh((total-67)/18)`: 0° at 67, antisymmetric, saturates at ±13° so huge overshoots read as max tilt instead of flipping.

## Key domain facts

- **`TARGET = 67`** is the one constant the whole game revolves around (`types.ts`). Weights are non-zero integers, so balance is strict equality — no float tolerance.
- **Solver** (`solveLevel`) is an exhaustive `2^n` bitmask subset search honoring `locked` (mask must include all locked bits), `useAll` (mask must equal full set), and `maxWeights` (popcount cap). It records the **minimum** piece count summing to 67. Capped at `MAX_LEVEL_WEIGHTS = 16` — **throws** above that.
- **3 stars = solver-proven minimum.** `starsForClear`: `used <= min` → 3, `used <= min+2` → 2, else 1. `used` counts locked pieces.
- **Budget (`maxWeights`) counts locked pieces** toward the cap; `validatePacks` requires `maxWeights >= max(1, locked.length)`.
- **Balloons (negative weights) debut at level 6** (`{ weights: [72, -5], locked: [0], hint: … }`). Levels 1–5 are positive-only; `levels.test.ts` hard-codes this beat. Level 6 is also the first `locked` use, though the *featured* locked-build tutorial is L18.
- **Packs & globals:** pack1 Warm-Up (1–24), pack2 Prime Time (25–48), pack3 Heavy Lifting (49–72). Global numbers are 1-based and derived from pack order, not stored on levels.
- **Progress** is keyed by stringified global level number; `isUnlocked` opens level 1 always and any level whose predecessor (or itself) is cleared — it only looks one level back. `parseProgress` defensively drops corrupt entries (keys `/^\d+$/`, stars 1–3, best 1–99).

## Conventions & gotchas

- **`src/game` must stay Phaser-free / DOM-free.** No UI or service imports. This is what keeps the logic unit-testable and is enforced by convention + the test suite living alongside it.
- **Every shipped level must pass `solveLevel`** or the build breaks (see the `npm run build` note above). When you add/edit level data, run `npm test`.
- **Retina/DPR sizing is manual** in `src/main.ts`: canvas is sized at `innerWidth/innerHeight × DPR` with `Scale.NONE` + `zoom = 1/DPR` (Phaser `RESIZE` mode can't give a physical-pixel backing store). Every fixed dimension must pass through `u()`; `TEXT.ink/cream` already apply `u()`, so don't double-apply DPR to a value already in device pixels.
- **All art and audio are generated in code** — no asset files. Art is `Phaser.Graphics` primitives; SFX are Web Audio synthesis. There is nothing to swap to files.
- **Immutability contract:** `place`/`remove` return the *same array reference* when the guard fails and a *new* array on success. Don't assume a fresh array is always returned.
- **`beamAngleDeg` takes the total, not the gap** (it computes `total-67` internally); `GameScene` passes `ev.total`.
- **The beam is a spring**, not the target — call `settleImmediately()` on scene start to avoid a visible spring from 0°, and `setWon(true)` in the win sequence or the beam keeps swaying under the overlay.
- **Capacitor config source of truth is `capacitor.config.ts`.** The generated `capacitor.config.json`/`config.xml` under `ios/App` are gitignored and overwritten by `cap sync` — hand-edits are lost.
- **`vite base: './'` is load-bearing for iOS** (assets resolve from `capacitor://localhost`). Don't change it to `'/'`.
- **Never commit App Store Connect keys** — `*.p8`, `AuthKey_*.p8`, `ios/App/fastlane/keys/` are gitignored.

## How to add a level

1. Open the target pack file — `src/game/levels/pack1.ts`, `pack2.ts`, or `pack3.ts` — and append (or insert) a `LevelDef` in the `levels` array. The array position **is** the level's place in global numbering.
2. Minimal level is just `{ weights: [...] }`. Weights are signed non-zero integers in tray order: positive = down-weight, negative = balloon. Optional fields:
   - `locked: number[]` — indices pre-placed and unremovable (locked pieces still count toward budget).
   - `maxWeights: number` — piece budget; must be `>= max(1, locked.length)`.
   - `useAll: true` — every weight must be on the pan to win.
   - `hint: string` — onboarding line shown above the tray (use only when introducing a mechanic).
3. Keep it well-formed: at least one weight, at most **12** (shipping cap; solver hard limit is 16), `|value| <= 99`, and there **must exist an exact-67 subset** under the constraints.
4. Run `npm test`. `validatePacks` will report any structural problem or `"…: no exact-67 solution"`; a green suite means it ships. `TOTAL_LEVELS` and global↔pack mapping update automatically.

For the full authoring guide — every constraint explained, the star economy, the build-time safety net, and annotated real levels — see [`docs/LEVEL_DESIGN.md`](docs/LEVEL_DESIGN.md). The pack files' inline per-level comments and `solver.ts`/`validatePacks` are the ground truth.

## Further reading (real paths)

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — deeper engineering reference: layer diagram, the pure-logic core, render/scene flow, services & persistence, native iOS/Android, and an end-to-end "playing a level" walkthrough.
- [`docs/reference/`](docs/reference/) — per-module API reference (every export + signature + gotcha): [`GAME.md`](docs/reference/GAME.md), [`RENDER.md`](docs/reference/RENDER.md), [`SERVICES.md`](docs/reference/SERVICES.md).
- [`docs/LEVEL_DESIGN.md`](docs/LEVEL_DESIGN.md) — how to author and tune levels: the `LevelDef` schema, constraints, solver & star economy, the build gate, and annotated example levels.
- [`docs/AUDIO.md`](docs/AUDIO.md) — the whole audio layer: the three independent switches, the shared context, how the generative music bed is built and scheduled, the two-beat celebration, and the iOS `AVAudioSession` category that keeps the player's Spotify alive.
- [`docs/MONETIZATION.md`](docs/MONETIZATION.md) — ads & IAP: the strategy, how `ads.ts` is wired, and the exact steps to go from test ads to live App-Store-approved revenue.
- [`docs/TESTING.md`](docs/TESTING.md) — build gate, the unit + E2E matrix, how to run/drive (web + simulator), and the adversarial audit + confirmed fixes.
- [`docs/RELEASE.md`](docs/RELEASE.md) — build & release runbook for both stores: version bumps, fastlane, the ASC version+IAP submission, Android AAB, current status.
- [`marketing/TIKTOK_PLAYBOOK.md`](marketing/TIKTOK_PLAYBOOK.md) — short-form video playbook: the "67 = six-seven" positioning, recording setup, six shot-listed formats, hooks/captions/hashtags, and where AI generation does and doesn't belong.
- [`marketing/CINEMATIC_LEVELS.md`](marketing/CINEMATIC_LEVELS.md) — **generated** (`npm run capture:levels`): all 72 levels scored on how well they film, with the best picks per video format.
- [`marketing/PRODUCTION_BRIEF.md`](marketing/PRODUCTION_BRIEF.md) — **the source of truth for marketing decisions.** Researched July 2026 (81 findings; the 14 riskiest adversarially re-verified, 9 corrected): Apple's rules on the logo/badge/wording in video, the Noqyris studio-account setup, the numeric reel spec, the original-vs-trending audio call, the fal.ai model choice, and an honest low-confidence list. Supersedes parts of the two files below.
- [`marketing/FAL_BRIEF.md`](marketing/FAL_BRIEF.md) — what to generate on fal.ai (2s cold opens only — never gameplay), the output spec the splicer expects, and six ready prompts.
- [`marketing/POSTING.md`](marketing/POSTING.md) — the copy-paste sheet: the App Store link and where it may go, the pinned comment, hashtags, every caption, per-platform differences, and Apple's binding wording rules.
- [`marketing/BATCH-01.md`](marketing/BATCH-01.md) — the executable version: twelve videos fully specified (capture URL, overlay timings, caption, hashtags), account setup, posting order. iOS-only; the App Store listing is live as `id6787536995`.
- `README.md` — project overview + command summary.
- `src/game/levels/pack1.ts` … `pack3.ts` — annotated level data and difficulty ramp.
- `store/` — App Store release collateral: `STORE_LISTING.md`, `PRIVACY_POLICY.md`, `SUBMISSION.md` (runbook), `icon-1024.png`, `screenshots/`.
- `ios/App/fastlane/` — `Fastfile` (8 lanes), `Appfile`, `Deliverfile`, `metadata/`, `screenshots/`.
- `docs/` also hosts the GitHub Pages support/privacy site (`index.html`, `privacy.html`) — the privacy URL the store listing points to.