# Exactly 67

A balance-scale number puzzle for iOS: the left pan holds a fixed **67**, and you fill the right pan with signed weights until its total is **exactly 67** and the beam locks level. Positive weights are down-weights (pan sinks); negative weights are balloons that lift/pull the pan up. **600 levels across 25 packs** — the first 72 hand-authored, the rest generated and solver-verified by `tools/generate-levels.ts`, each pack harder than the last.

## Stack

- **Phaser 3** (`^3.90`) — rendering + input, all art drawn in code (zero image/audio assets)
- **TypeScript** (`^5.9`, strict) + **Vite** (`^5.4`) — build/dev
- **Vitest** (`^2.1`) — unit tests + build-time content gate
- **Capacitor 8** (`@capacitor/core|ios|android|haptics|preferences`) — iOS wrapper (`appId com.noqyris.exactly67`, `webDir dist`). iOS native dependencies resolve through **Swift Package Manager** (`ios/App/CapApp-SPM`), not CocoaPods — there is no Podfile.
- **Ads: Unity LevelPlay** via `capacitor-levelplay-ads`, pinned **exactly `0.1.42`** (never a caret range: the `postinstall` patches in `scripts/` refuse any other version, because they depend on its file shapes). It mediates the **Unity Ads** network only (`package.json` → `levelplay.networks: ["unityads"]`). It replaced `@capacitor-community/admob`, which is **gone entirely** — code, dependency, `Info.plist` app id and SKAdNetwork id, Android manifest id — after Google terminated the publisher account on 2026-08-18. **Never add an AdMob adapter or any Google network**; `scripts/check-no-google.mjs` fails every sync chain if one comes back.
- **IAP** `cordova-plugin-purchase` (StoreKit, no backend) · **rating prompt** `@capacitor-community/in-app-review`.
- **iOS, portrait-only.** Android-ready but not shipped. Capacitor CLI needs **Node >= 22** — declared in `package.json` `engines` (`>=22.0.0`, which npm only warns about), no `.nvmrc`.

## Commands

| Command | Script | What it does |
|---|---|---|
| `npm run dev` | `vite` | Browser dev server (hot reload). |
| `npm test` | `vitest run` | Run the logic, level-validation and ad-layer suites once (ad policy, entitlements, build markers, the music hold under ads, the LevelPlay provider). |
| `npm run test:watch` | `vitest` | Same suite in watch mode. |
| `npm run build` | `tsc --noEmit && vitest run && vite build` | Typecheck → test → bundle to `dist/`. **`&&`-chained: any stage failing aborts the rest.** |
| `npm run dev:mock` | `VITE_ADS=mock vite` | Dev server with **fake ads we draw ourselves** (`services/providers/mock.ts`): banner, interstitial, hint video and privacy sheet, each lettered "FAKE AD — MOCK BUILD", no network. The way to test the ad *flow* (reserved strip, cadence, reward granted or withheld, loop pause) in a browser. |
| `npm run build:adsoff` | `VITE_ADS=off npm run build && node scripts/check-ad-mode.mjs off` | Bundle with the ad layer **off** (`ADS:off`): no SDK, no consent prompt, no banner strip; the hint video grants without an ad. |
| `npm run build:tf` | `VITE_ADS=off VITE_UNLOCK_ALL=1 npm run build && node scripts/check-ad-mode.mjs off` | The TestFlight bundle: ads off **plus every level unlocked** (`UNLOCKALL:1`, `services/buildFlags.ts`). |
| `npm run build:live` | `node scripts/check-levelplay-config.mjs ios && VITE_AD_MODE=live npm run build && node scripts/check-ad-mode.mjs live` | The App Store bundle: real LevelPlay ids for iOS, then `ADMODE:live` + `ADS:on`, no `UNLOCKALL:1`. The id check runs **first**, so a failed check leaves no live bundle behind. A successful run does leave one in `dist/` (that is the point) — `npm run ios:sync` once the release is done. |
| `npm run build:mock` | `VITE_ADS=mock npm run build && node scripts/check-ad-mode.mjs mock` | Fake-ads bundle. Every store target refuses it; never archived or uploaded. |
| `npm run build:test` | `npm run build && node scripts/check-ad-mode.mjs test` | `ADMODE:test` + `ADS:on` for **dev integration only**. On LevelPlay "test" is not test inventory: this bundle serves **real ads**. Never uploaded. |
| `npm run ios:sync` | `npm run build:adsoff && node scripts/check-no-google.mjs && cap sync ios && node scripts/check-native-sync.mjs ios off` | The everyday sync: **ads off**. Needs Node >= 22. **Not** the App Store path any more. |
| `npm run ios:testflight` | `npm run build:tf && node scripts/check-no-google.mjs && cap sync ios && node scripts/check-native-sync.mjs ios off` | Build **N+1** of a release: ads off, all levels unlocked. |
| `npm run ios:appstore` | `npm run build:live && node scripts/check-no-google.mjs && cap sync ios && node scripts/check-native-sync.mjs ios live` | Build **N** of a release — the only chain that produces a **real-ads** App Store binary. See "Ad safety" below. |
| `npm run ios:sync:mock` / `ios:sync:test` | `build:mock` / `build:test` → `check-no-google` → `cap sync ios` → `check-native-sync ios mock\|test` | Fake ads on a device, or the real waterfall on a device for integration. `test` serves **real ads**: never tap, never upload. The Xcode guard builds a `test` bundle only when `AD_TARGET=test` is stated for a Run, and never archives it. |
| `npm run ads:check -- <target> [dir]` | `node scripts/check-ad-mode.mjs` | Gate #1 by hand: `live` / `off` / `mock` / `test` against `dist/assets`. |
| `npm run ads:nogoogle` | `node scripts/check-no-google.mjs` | Gate #2 by hand: no AdMob / Google ad surface anywhere (`--strict` also fails on the dead publisher id in prose). |
| `npm run ads:config -- <ios\|android>` | `node scripts/check-levelplay-config.mjs` | Gate #3 by hand: a real LevelPlay app key (`/^[0-9a-f]{9}$/`) and three distinct unit ids (`/^[a-z0-9]{16}$/`) in `providers/levelplay.ts`. |
| *(automatic)* `postinstall` | `node scripts/patch-levelplay-spm.mjs && node scripts/patch-levelplay-consent.mjs && node scripts/patch-levelplay-android-sdk.mjs` | Patches the plugin after every `npm install`: an SPM manifest that actually links the LevelPlay SDK + Unity Ads adapter (upstream links nothing under SPM and silently serves no ads), the consent bug that read a **decline** back as GRANTED, and the Android SDK versions. Each exits 1 on any plugin version but 0.1.42 or an unexpected file shape. |
| *(automatic)* `capacitor:sync:after` | `node node_modules/capacitor-levelplay-ads/scripts/levelplay-manifest.js` | Runs inside `cap sync`: writes the ATT string, SKAdNetwork ids and `LevelPlayCMPProvider` into `Info.plist` (and the Android adapter/CMP config). It rewrites `Info.plist` **and drops its comments** — `git checkout ios/App/App/Info.plist` afterwards, and treat any other diff there as something the hook added. That checkout cannot undo a version bump: `Info.plist` reads `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)`, and the numbers live only in `project.pbxproj`. |
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
| `daily.ts` | Daily Challenge: a board generated deterministically from the UTC date (`todayKey`), the same for every player, solver-verified. |
| `share.ts` | The win card's share text: the pan-total *route* as glyphs, never a weight value, so it cannot spoil the level. |
| `levels/` | `pack1/2/3.ts` hand-authored (24 each) + `pack4…pack25.ts` **generated** → aggregated in `index.ts` as `PACKS`, `TOTAL_LEVELS` (600), `levelByGlobal`/`globalOf`. **Progress is keyed by global level number, so packs may be appended but never reordered or resized.** |

Internal deps only: `balance ← rules`, `types ← everything`, `solver` and `stars` are only exercised together in tests. `rules.ts` never imports `solver`/`stars`/`progress` — the UI orchestrator wires those together.

### `src/render` — Phaser scenes + Graphics-only vector art
| File | Role |
|---|---|
| `../main.ts` | Boot: awaits font + settings, builds `Phaser.Game`, scenes `[MenuScene, LevelMapScene, GameScene, StoreScene]` (Menu auto-starts). Also grandfathers the pre-split `unlimitedHints` entitlement — see `services/storage.ts`. Ad wiring: reserves the banner strip (`bannerReserve() × DPR`) before any scene lays out, registers the loop sleep/wake hooks, runs `splashGone.then(initAds).then(showBanner)` unconditionally (the ads service decides who gets what), and calls `adsForegrounded()` on every return to the foreground. |
| `../splash.ts` | Studio sting (`public/splash.mp4`, muted + `playsinline`, markup inline in `index.html`). Plays *over* the boot; dismisses on end/tap/error/autoplay-refusal/8s timeout, skipped under reduced motion. Two invariants: the overlay stays in the DOM as an **invisible input shield** until the finger is up (Phaser fires buttons on a bare `pointerup` re-hit-tested at the release point, so a skip tap would otherwise press Play underneath), and `initSplash()` returns a promise that ads wait on so no native view draws over the sting. |
| `layout.ts` | `DPR` (clamped 1–3), `u(n)=n*DPR`, `contentFrame()` (caps play area to 680×940), `safeArea()`, `prefersReducedMotion()`. |
| `palette.ts` | Single color/typography source: `INK`, `BG`, candy fills, `weightColor(value)`, `FONT`. |
| `MenuScene.ts` / `LevelMapScene.ts` / `GameScene.ts` / `StoreScene.ts` | The four scenes. `GameScene` (~1,400 LOC) is the play loop (levels and the Daily Challenge) and owns the hint modal (`HINT_COPY`: "Watch ad: +1 hint", or "Ad: +1 hint" when that does not fit a 320 pt phone; no watch button at all without ad consent). `StoreScene` is the shop (hint packs + No ads, whose card says "hint videos stay" + the unlimited/no-ads unlock + Restore). `LevelMapScene` puts an opaque, tap-swallowing footer over the banner strip whenever one is reserved, because its tiles are the only tappable things that scroll toward the ad. `MenuScene` carries a quiet **"Privacy choices"** text link (top-right of the content frame, far from the banner) that re-opens the ad-consent decision — shown only when `adsSupported() && !hintsUnlimited()`. |
| `ScaleView.ts` | The beam: under-damped angular spring toward a target angle; upright hanging pans; `setWon()` locks level. |
| `WeightView.ts` | One draggable weight (`value>0` = candy block, `value<0` = balloon), Graphics-only. |
| `ui.ts` | Shared helpers: `makeButton`, `makeIconButton`, `drawStar`, icon glyphs, `TEXT.ink/cream` style factory. |

### `src/services` — platform abstraction
| File | Role |
|---|---|
| `audio.ts` | Web Audio **synth** — every SFX generated from oscillators + gain envelopes at play time. No audio files. Owns the shared `audioContext()` (ungated) plus a private effects-gated accessor. |
| `music.ts` | The background bed — **generative**, not a loop: a slow I-vi-IV-V in C with a melody re-rolled each bar from the pentatonic scale, so it never repeats audibly. Own toggle, own storage key, look-ahead scheduler, `duckMusic()` for the win. Parks while hidden or while the context is suspended. `suppressMusic(on)` is a counted hold that `startMusic()` obeys: `ads.ts` takes it for the length of a full-screen ad, so the module's own visibility / focus / pageshow listeners cannot restart the pad under the ad's soundtrack. See [`docs/AUDIO.md`](docs/AUDIO.md). |
| `haptics.ts` | Toggle-gated `@capacitor/haptics` wrapper; fire-and-forget, silently no-ops on web. |
| `ads.ts` | The ad **policy** layer: decides *when* an ad may appear and what happens around it, never *who* serves it. Owns the interstitial cadence (`CLEARS_PER_INTERSTITIAL=3`, `ONBOARDING_LEVELS=8`, `MIN_SECONDS_BETWEEN_ADS=180`, `FIRST_AD_MIN_SESSION_SECONDS=90`, `MAX_ADS_PER_SESSION=3`, `REWARDED_SUPPRESS_SECONDS=300`, never on a pack-finale clear), the hint economy, both entitlements, the banner strip (`bannerReserve()`: 58 design px or 0), and sleeping the Phaser loop + music under a full-screen ad. Same guarded, fire-and-forget pattern as `haptics.ts`; a no-op wherever `adsSupported()` is false (browser, `ADS:off`). `maybeShowInterstitial` / `watchRewardedHint` resolve only once the player is done with the ad; `watchRewardedHint()` says `'earned' \| 'unavailable' \| 'not-earned'` so the hint modal can tell the player something true (`showRewardedHint()` is the boolean wrapper). **Every ad surface follows the provider's current consent answer** (`consentAllows()`): `rewardedOffered()` is false without consent, and a withdrawal from Privacy choices takes the banner down and stops interstitials and hint videos for the session, while a later yes brings them back. `initAds()` runs a **one-time consent reset** (`provider.resetConsent()`, flag `exactly67.levelplayConsentMigrated`) before the first `init()`, so a Google-era IAB TCF record from 1.2.0 is never read as a LevelPlay decision. Unlimited owners never start the SDK; No Ads owners start it for the opt-in hint video only. See [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `adProvider.ts` | The seam under `ads.ts`: the `AdProvider` interface, `adsOff()` / `adsMock()`, `ADS_MARKER` (`ADS:on\|off\|mock`), `BANNER_RESERVE_DESIGN_PX`. The next network is one new file under `providers/`, not another rewrite. |
| `providers/levelplay.ts` | Unity LevelPlay behind the seam, ported from KVIZKO. **ATT, then the consent modal, BEFORE `initialize()`; only `GRANTED` starts the SDK** — a legal requirement pinned by `levelplay.test.ts`. **iOS ids are real** (LevelPlay app created 2026-09-16): app key `282af3d55`, units banner `bkov9ky03m5q7nb5` / interstitial `037b2c2vtwjlz5bg` / rewarded `v9y4469brsj85byl`, Unity Ads bidding on all three (Game ID `800374923`, placements `BP_*_iOS`). **Android has no LevelPlay app**: its entries stay empty, and `init()` refuses an empty key. Keep them plain string literals — `check-levelplay-config.mjs` parses the source. Carries `ADMODE:test\|live` on `id`; `testing` is hard-wired `false` because LevelPlay has no test inventory. `openPrivacyOptions()` backs the menu's "Privacy choices"; `adsAllowed()` (only `GRANTED`), `onConsentChange()` and `resetConsent()` (refuses while the SDK is starting or up) feed the policy layer. The interstitial answers **from the prefetch cache only** — a miss is "no ad this time" at once and fetches one for the next break — while the rewarded video may load at tap time (the player asked) and re-arms the backoff on a miss. A rewarded ad that is not *displayed* within 10 s resolves as not shown. |
| `providers/mock.ts` | Fake ads drawn in the DOM for `VITE_ADS=mock`; no network. Tree-shaken out of every other bundle. |
| `buildFlags.ts` | `allLevelsUnlocked()` (`VITE_UNLOCK_ALL=1`, TestFlight only) and `stampBuildFlags()`, which puts `UNLOCKALL:1` in the bundle and on `<html data-build-flags>` so the `live` gate can refuse it. |
| `share.ts` | Hands the share text to `navigator.share`, clipboard as fallback; never throws. |
| `iap.ts` | IAP wrapper — StoreKit via `cordova-plugin-purchase` (`CdvPurchase` global; no bundler import, injected natively). Sells three **consumable** hint packs (`HINT_PACKS`, 10/30/100) plus **two non-consumables**: `NO_ADS_ID` ($0.99, ads off only) and `REMOVE_ADS_ID` ($4.99, ads off **+ unlimited hints**). Web-no-op. **Two separate entitlements** — `ads.adsRemoved()` (either product) and `ads.hintsUnlimited()` (the $4.99 one only). Gameplay must gate free hints on `hintsUnlimited()`, never `adsRemoved()`, or the cheap product hands out the expensive perk. **Price-ladder invariant: the $4.99 unlock must stay dearer than the largest pack ($2.99).** See [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `review.ts` | "Rate this app" wrapper — native StoreKit prompt via `@capacitor-community/in-app-review`. One-shot (persisted flag), web-no-op; `maybeRequestReview` fires from the win overlay at a delight peak. See [`docs/MONETIZATION.md`](docs/MONETIZATION.md). |
| `storage.ts` | `@capacitor/preferences` wrapper. Keys: `exactly67.progress` (JSON), `exactly67.sound`, `exactly67.haptics` (`'on'`/`'off'`), `exactly67.music` (`'on'`/`'off'`; **absent = the `MUSIC_ON_BY_DEFAULT` constant in `main.ts`**, not the on-by-default `loadFlag` rule), `exactly67.adClears`, `exactly67.adsRemoved`, `exactly67.hintFreeDate` (daily-top-up date), `exactly67.hintCount` (hint inventory), `exactly67.reviewRequested`, `exactly67.dailyDone` (UTC date of the last Daily Challenge clear), `exactly67.levelplayConsentMigrated` (`'on'` once the one-time LevelPlay consent reset has run; **absent or unreadable = not yet**, so the reset runs and the consent modal is asked once more), `exactly67.unlimitedHints` (`'on'`/`'off'`; **absent = pre-split install**, grandfathered from `adsRemoved` at boot in `main.ts` so old $0.99 buyers keep unlimited hints). |
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
- **Build markers are load-bearing.** The bundler folds `VITE_AD_MODE`, `VITE_ADS` and `VITE_UNLOCK_ALL` into the literals `ADMODE:test|live`, `ADS:on|off|mock` and `UNLOCKALL:1`, each **exactly once** (the last only when set), and every release gate counts them as plain substrings. They survive tree-shaking only because live code reads them (`provider.id`, `stampBuildFlags()`). Never put those literals in any other shipped string (comments and tests are fine; the minifier drops the one and never bundles the other), and never move a marker off live code.
- **The native ad SDK versions are pinned in `Package.resolved`**, not in `Package.swift` (the patched plugin manifest says `from:`): LevelPlay **9.6.0**, UnityAds adapter **5.11.0**, Unity Ads **4.20.0**, plus Unity Ad Quality **9.9.0** (pulled in transitively) — KVIZKO's App-Store-proven graph. `check-native-sync.mjs` refuses any other version on **every** iOS target (live, off, mock, test), and the archive passes `disable_package_automatic_updates`. Never "Update to Latest Package Versions" or delete `Package.resolved`; a bump is a deliberate change that starts in `scripts/lib/levelplay-versions.mjs`.
- **The App target links with `OTHER_LDFLAGS = -ObjC`** (Debug and Release). Do not remove it: without it the linker strips the Unity Ads SDK/adapter classes and categories that LevelPlay loads by name, and the SDK crashed at `initialize()` (KVIZKO BUG-9).
- **The App target sets `ENABLE_USER_SCRIPT_SANDBOXING = NO`** (Debug and Release). The Ad-mode guard phase reads `App/public` and `App/capacitor.config.json`, which are not declared inputs; with sandboxing on, every build fails with "Sandbox: bash deny file-read-data". Never accept Xcode's "Update to recommended settings" for it, and never answer that error by deleting the guard phase.
- **Version and build number live only in `project.pbxproj`** (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`, two occurrences each). `Info.plist` reads them as `$(…)` variables, so a bump is one file and the post-sync `git checkout` of `Info.plist` cannot undo it. Never put literal numbers back in `Info.plist`.
- **Consent before init, always.** `providers/levelplay.ts` asks ATT and shows the consent modal *before* `LevelPlayAds.initialize()`, and only `GRANTED` starts the SDK (a decline means no ads at all, hint videos included — the hint modal then offers no watch button and says why). Never "tidy" `initialize()` earlier — it transmits device data. The one-time consent reset in `initAds()` must stay **before** the first `init()`. A withdrawal cannot stop a running SDK, so the policy layer honours it: banner removed, no interstitial or hint video for as long as the answer stays no, `doNotSell` set (the stored `DENIED` keeps the SDK off from the next launch). No app-open ads, ever; no "support us" / "help the developer" wording near any ad.

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
- [`docs/MONETIZATION.md`](docs/MONETIZATION.md) — ads & IAP: the strategy and cadence, the policy layer over the provider seam, consent, the LevelPlay dashboard setup (iOS ids live since 2026-09-16), and what is left before the first LevelPlay release.
- [`docs/TESTING.md`](docs/TESTING.md) — build gate, the unit + E2E matrix (including the ad suites and the mock-ads build), how to run/drive (web + simulator), and the adversarial audit + confirmed fixes.
- [`docs/RELEASE.md`](docs/RELEASE.md) — build & release runbook: the four ad targets and their gates, the Xcode guard, the fastlane lanes, the upload ledger and the privacy gate, the pre-release checklist, the two-build release step by step, version bumps, the ASC version+IAP submission, Android AAB.
- [`marketing/TIKTOK_PLAYBOOK.md`](marketing/TIKTOK_PLAYBOOK.md) — short-form video playbook: the "67 = six-seven" positioning, recording setup, six shot-listed formats, hooks/captions/hashtags, and where AI generation does and doesn't belong.
- [`marketing/CINEMATIC_LEVELS.md`](marketing/CINEMATIC_LEVELS.md) — **generated** (`npm run capture:levels`): all 72 levels scored on how well they film, with the best picks per video format.
- [`marketing/PRODUCTION_BRIEF.md`](marketing/PRODUCTION_BRIEF.md) — **the source of truth for marketing decisions.** Researched July 2026 (81 findings; the 14 riskiest adversarially re-verified, 9 corrected): Apple's rules on the logo/badge/wording in video, the Noqyris studio-account setup, the numeric reel spec, the original-vs-trending audio call, the fal.ai model choice, and an honest low-confidence list. Supersedes parts of the two files below.
- [`marketing/FAL_BRIEF.md`](marketing/FAL_BRIEF.md) — what to generate on fal.ai (2s cold opens only — never gameplay), the output spec the splicer expects, and six ready prompts.
- [`marketing/POSTING.md`](marketing/POSTING.md) — the copy-paste sheet: the App Store link and where it may go, the pinned comment, hashtags, every caption, per-platform differences, and Apple's binding wording rules.
- [`marketing/BATCH-01.md`](marketing/BATCH-01.md) — the executable version: twelve videos fully specified (capture URL, overlay timings, caption, hashtags), account setup, posting order. iOS-only; the App Store listing is live as `id6787536995`.
- `README.md` — project overview + command summary.
- `src/game/levels/pack1.ts` … `pack3.ts` — annotated level data and difficulty ramp.
- `store/` — store collateral: `STORE_LISTING.md` (internal mirror of `ios/App/fastlane/metadata` plus the ASC-only answers: IAP ladder, App Privacy), `PRIVACY_POLICY.md` (short mirror of the published `docs/privacy.html`), `SUBMISSION.md` (historical 1.0.0 walkthrough — the current runbook is `docs/RELEASE.md`), `PLAY_LISTING.md` (Android, not released), `icon-1024.png`, `screenshots/`.
- `ios/App/fastlane/` — `Fastfile` (17 lanes; every one that builds or uploads requires `AD_TARGET`, and every upload is recorded in the gitignored upload ledger `ios/App/build/ad-ledger.json` — `fastlane ledger` prints it), `Appfile`, `Deliverfile`, `metadata/`, `screenshots/`.
- `ios/App/ad-mode-guard.sh` — the "Ad-mode guard" Run Script phase, first in the App target: Xcode itself refuses to build a bundle whose markers disagree with `AD_TARGET`, an `ADS:on` test bundle without `AD_TARGET=test` (and archives of one at all), and a `capacitor.config.json` carrying `server.url` (a `cap run -l` live-reload leftover, so live reload no longer builds).
- `scripts/` — the release gates (`check-ad-mode`, `check-no-google`, `check-native-sync`, `check-levelplay-config`) and the three `patch-levelplay-*` postinstall patches; `scripts/lib/levelplay-versions.mjs` pins the SDK and adapter versions.
- `docs/` also hosts the GitHub Pages support/privacy site (`index.html`, `privacy.html`) — the privacy URL the store listing points to.

## ⚠️ Ad safety — the two-build release

**A real-ads upload is half a release. Shipping it alone is the bug.**

Apple makes an App Store build the **newest build on TestFlight** as soon as it
processes, and TestFlight offers the newest build first. There is no way off:
the internal tester group's `hasAccessToAllBuilds` is `true` and App Store Connect
refuses to change it. So a real-ads binary lands on the owner's own phone by
default — and taps on real ads in TestFlight builds are what closed AdMob
publisher `pub-3307486877162157` on 2026-08-18, killing ads in every app on the
account at once (appeal refused, final). The game now runs on Unity LevelPlay,
which terminates for invalid traffic too and can claw the money back on top.

**On LevelPlay no build is safe to tap.** There are no test ad units and no test
inventory: `isTesting` only unlocks Unity's Test Suite, so **every `ADS:on` build
serves the real waterfall — the `test` target included**. A dashboard Test Device
pin narrows the ad *source* for about an hour; it does not make an ad safe to tap.
That is why there is **no TEST ADS badge** any more (`provider.testing` is
hard-wired `false`): on this network it could only ever lie. **Never tap an ad, on
any build, on any phone.** The only build with nothing on it to tap is `ADS:off`,
where the ad layer never starts.

Before build N, work through the **pre-release checklist** in `docs/RELEASE.md` §0:
`docs/privacy.html` and `docs/index.html` published to `main`, the Unity Ad Controls age
limit set for a 4+ app, the $4.99 IAP's App Store Connect name matching what it delivers,
and re-captured screenshots.

Every App Store release is **two uploads**, in this order (fastlane from `ios/App`):

1. **Build N — real ads.** Bump the build number (`project.pbxproj` only), `npm run ios:appstore` (gate
   reports **live**; the LevelPlay ids must be real), then
   `AD_TARGET=live fastlane archive` and `AD_TARGET=live fastlane upload_testflight`.
   Say out loud, before uploading, that this build carries real ads. The upload
   refuses until the published privacy page names LevelPlay (merge `docs/privacy.html`
   and `docs/index.html` to `main` first) and while the ledger's newest upload is
   already live.
2. **Build N+1 — ads off, immediately.** Bump the build number again,
   `npm run ios:testflight` (gate reports **off**: `ADS:off`, all levels unlocked —
   *not* the `test` target, which is real ads under a reassuring name), then
   `AD_TARGET=off fastlane archive` and `AD_TARGET=off fastlane upload_testflight`.
   Only now is what TestFlight offers safe to open.
3. Attach **N** (never N+1) and submit: `APP_VERSION=x.y.z BUILD_NUMBER=N fastlane submit`,
   which refuses unless the ledger records N as live **and** a higher ads-off build of the
   same version after it — or the App Store Connect UI when the release carries a
   first-time IAP (see `docs/RELEASE.md`). The UI path has no ledger check: run
   `fastlane ledger` and pick the build it names as live.
4. Once N is `READY_FOR_SALE`, **expire every real-ads build on TestFlight** — N and
   any older `ADS:on` build still installable, not only N. Expiring does **not**
   touch the App Store — verified on `com.noqyris.kvizko` build 51, simultaneously
   `READY_FOR_SALE` for 1.2 and `expired: true` on TestFlight.

Step 2 is not homework for later: the gap between the two uploads is exactly when
the owner opens TestFlight to look at the new version. Never leave a real-ads build
as the newest one, and never end a session between steps 1 and 2. Google Play has
the same shape — follow a production rollout with an **ads-off** build on the
internal track.

What enforces it, failing closed except where noted: on `build:live`, `check-levelplay-config.mjs ios`
first (real ids, before anything is built) → `check-ad-mode.mjs` (bundle markers,
before sync) → `check-no-google.mjs` → `cap sync` → `check-native-sync.mjs` (the
native project holds exactly that bundle, at exactly the pinned SDK versions); the Xcode
**Ad-mode guard** phase (`ios/App/ad-mode-guard.sh` — Product → Archive of a live bundle
needs `AD_TARGET=live`, an `ADS:on` test bundle Runs only under `AD_TARGET=test` and is
never archived, and a `server.url` in `capacitor.config.json` never builds); and the
Fastfile, which never archives or uploads `test`, re-runs `check-native-sync` and
re-checks `App/public` before archiving and the finished `.ipa` before every upload,
refuses a live upload (and `submit`) until the published privacy page names LevelPlay
and no longer mentions AdMob (`SKIP_PRIVACY_CHECK=1` overrides, loudly), and keeps the
**upload ledger**: a live upload refuses while the newest recorded upload is live
(`ALLOW_CONSECUTIVE_LIVE=1` overrides, loudly), and `submit` needs N recorded live with
a higher ads-off build after it. The ledger is per machine, in `ios/App/build`: never
delete that folder while a release is open (without it `submit` refuses, but a live
upload only warns — the one check here that fails open). A green gate proves which build it is —
**never permission to tap.**

Leave the tree safe: after any live build, `npm run ios:sync` so `dist/` and
`ios/App/App/public` hold an ads-off bundle again.

Full procedure: [`docs/RELEASE.md`](docs/RELEASE.md) and the user-level
`mobile-game-playbook` skill (`references/ad-safety.md`, `references/launch-runbook.md`).
The older `ad-safety` skill is AdMob-era and marked superseded.
