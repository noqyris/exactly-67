# Testing & QA

How *Exactly 67* is verified: the build-time gates, the unit suite, how to run and
drive the app for manual testing, the end-to-end test matrix, and the record of an
adversarial code audit and the fixes it produced.

The app has **four** layers of assurance:

1. **Type gate** — `tsc --noEmit` (strict).
2. **Content + logic gate** — Vitest suite, incl. `validatePacks(PACKS)` proving
   every shipped level is solvable, plus the ad policy, entitlement, build-marker,
   music-hold and LevelPlay provider suites.
3. **Manual E2E** — driving the real game (identical Phaser code on web and
   device) through every mechanic, and the ad flow on the **mock-ads** build.
4. **Adversarial audit** — multi-agent correctness review of the whole codebase.

The **release gates** (`scripts/check-*.mjs`, the Xcode guard, the Fastfile checks)
are a separate layer that proves *which* build a bundle is; they are documented in
[`RELEASE.md`](RELEASE.md). They are not part of the Vitest run.

---

## 1. The build gate

`npm run build` is **`tsc --noEmit && vitest run && vite build`** — `&&`-chained,
so any stage failing aborts the rest. You cannot bundle a broken build:

- **Stage 1 — `tsc --noEmit`:** strict typecheck of everything.
- **Stage 2 — `vitest run`:** the logic suite. `src/game/levels.test.ts` asserts
  `validatePacks(PACKS)` returns `[]`; if any level is unsolvable or malformed the
  array is non-empty, the test throws, vitest exits non-zero, and the chain aborts
  **before `vite build` ever runs**.
- **Stage 3 — `vite build`:** bundle to `dist/`.

Run just the tests with `npm test` (`vitest run`) or `npm run test:watch`.

Current status (16 September 2026, after the consent / hint-offer / release-gate fix
round): **`tsc` clean · 247/247 tests pass across 12 files.**

The suite must also stay green with each release-chain variable set, since the ad
tests read them: `VITE_AD_MODE=live`, `VITE_ADS=off`, `VITE_ADS=mock`,
`VITE_UNLOCK_ALL=1`, and `VITE_ADS=off VITE_UNLOCK_ALL=1` (verified when the
LevelPlay migration landed, and again after the fix round).

---

## 2. Unit suite

The pure logic core (`src/game`) is fully unit-tested, and so is the ad layer in
`src/services` (with the plugin and Capacitor mocked). The render layer and the
other services are covered by manual E2E (§4), since they need Phaser or a device.

| File | Tests | Covers |
|---|---|---|
| `balance.test.ts` | 10 | `panTotal`, `gapToTarget`, `isBalanced`, `beamAngleDeg` (0 at 67, antisymmetry, ±13° saturation). |
| `rules.test.ts` | 11 | `initialPlacement`, `canPlace`/`place`/`canRemove`/`remove`, the immutability contract, `evaluate` incl. `useAll` / `blockedReason`. |
| `solver.test.ts` | 24 | `solveLevel` minimums honoring locked/useAll/maxWeights, the >16-weight throw, `minimalSolution`. |
| `levels.test.ts` | 11 | **The build gate:** `validatePacks(PACKS) == []`, 600 levels across 25 packs, packs 1-3 frozen at 24 (progress is keyed by global number), the difficulty ramp is monotonic pack-to-pack, no duplicate trays, balloon debut at L6, global-number round-trips, tray bounds. |
| `progress.test.ts` | 9 | `mergeClear` monotonicity, `isUnlocked` one-step-back, `parseProgress` dropping corrupt entries. |
| `daily.test.ts` | 4 | The Daily Challenge board is deterministic per date and solver-verified across a year of dates. |
| `share.test.ts` | 14 | The share card: route glyphs, never a weight value. |
| `services/adsPolicy.test.ts` | 38 | **The ad policy, unchanged by the network move:** every interstitial cadence rule (onboarding, pack finales derived from `PACKS`, 3 clears, 180 s floor, 90 s warm-up, session cap, rewarded suppression) plus no interstitial without consent; the cadence spent only on a presented ad; navigation waits for the dismissal; the loop/music pause and resume, the music **hold** taken for the whole ad and released however it ended (refused, failed, abandoned, skipped); a rewarded hint pays out only on an earned reward, including the close-before-reward race; the three `RewardedOutcome`s the hint modal words its message from, and no network touched without consent. |
| `services/adsEntitlements.test.ts` | 31 | Who gets what: nothing bought / No ads (SDK, never an interrupting format) / Unlimited (no SDK at all); purchases mid-session, including a banner whose request **failed** (still removed, still hidden under a full-screen ad); the banner requested once and re-asked until it exists; Privacy choices: a mid-session withdrawal removes the banner and stops interstitials and hint videos, a later yes brings them back, a withdrawal during banner creation removes it once it lands; the **one-time consent reset** runs before the first `init()` and never again (No ads owners migrated, Unlimited owners and ads-off builds never reset); an `ADS:off` build makes **not one** provider call. |
| `services/adsMusicHold.test.ts` | 6 | The real `music.ts` against a stand-in document and window: while held, no visibilitychange / focus / pageshow and no direct call starts the bed; released, it starts at once; the hold is counted, an extra release banks no credit, and a player with music off stays off. |
| `services/adsMarkers.test.ts` | 20 | The build markers the gates count: `ADS:*` and `ADMODE:*` folded once per build, `UNLOCKALL:1` present exactly when set and stamped by live code; the providers carry the markers on `id`; the inline provider pick; the mock banner matches the strip; **no TEST ADS badge**; no Google plugin, unit id or app-open code in the ad layer; scenes reach ads only through the policy layer. |
| `services/providers/levelplay.test.ts` | 69 | The LevelPlay provider: formats; empty ids, Android's state (`init()` refuses an empty key before any prompt); **consent before `initialize()`** and only `GRANTED` starts the SDK (a `DENIED` decline never does); late consent; the consent reset (before ATT, the modal and `initialize`; its `UNKNOWN` event never starts the SDK; a running SDK is never reset; a refused reset does not throw); `adsAllowed()` and consent reporting to the policy layer; `onReady`; `testing` is false; the rewarded reward-vs-skip race, including the 10 s display deadline; prefetch, and a tap-time rewarded miss re-arming the backoff; the interstitial answered **from the cache only** (a miss is false at once and fetches for next time, an in-flight load is not joined, a waiting backoff is not pre-empted, a refused `isReady` is a miss); interstitial resolve-on-present; the dismissal watcher; the banner; the CCPA/COPPA flags set before init; init retry with backoff and on foreground. |

---

## 3. How to run and drive the app

### Web (the primary way to drive gameplay)

```bash
npm run dev          # vite dev server → http://localhost:5173
```

The browser runs the **exact same Phaser code** as the device — same rendering,
input, and game logic. Only the native-only services differ: in plain `npm run dev`,
ads, IAP, haptics and the rating prompt are **web no-ops** (no banner strip, no Store
button, no "Privacy choices" link). This makes the browser the fastest, most reliable
way to test gameplay.

### Web with fake ads — testing the ad flow

```bash
npm run dev:mock     # VITE_ADS=mock: providers/mock.ts draws the ads, no network
```

The mock build exercises **our** ad code end to end — the reserved strip, the
cadence, navigation waiting for a dismissal, a reward granted or withheld, the loop
and music pausing — with no device, no network and nothing billable. Every surface
reads "FAKE AD — MOCK BUILD", is safe to tap, and carries
`data-e67-mock="banner|interstitial|rewarded|privacy"` (close buttons:
`data-e67-mock-close`) for automation. It proves nothing about whether the real
LevelPlay waterfall fills.

Storage keys on web are `localStorage` `CapacitorStorage.exactly67.*`.

- **Banner:** appears at the bottom once the splash ends, for a player who owns
  neither unlock.
- **Privacy sheet:** tap "Privacy choices" on the menu.
- **Hint video:** set `hintCount` to `'0'` and `hintFreeDate` to today's UTC date,
  reload, Play, tap the 💡, then **"Watch ad: +1 hint"** ("Ad: +1 hint" at 320 px wide).
  The button reads "Loading…" and *Done* stays shut while the fake ad loads and plays.
  Close within 5 s → no hint, and the note under the card reads "No hint this time —
  the ad didn't play to the end"; wait 5 s and close → +1 and "Hint earned!". The mock
  always grants consent, so the videos-off state (no watch button, "Hint videos are off
  because ads were declined…") only appears with consent forced off in the page.
- **Interstitial:** seed `progress` with levels 1–9 cleared, `adClears` = `'2'`
  (and `reviewRequested` = `'on'` to keep the rating prompt away), reload, wait at
  least 90 s (Playwright's `page.clock` can fast-forward), clear level 10 and tap
  Next or Map. Avoid pack-finale levels. The next level loads only after the fake
  ad's Close.

Drive the canvas with real pointer events (the game is canvas-only, so there are no
DOM elements to target — click by pixel coordinate):

```js
// via a Playwright/automation harness
await page.mouse.click(x, y)   // tap a weight in the tray, or a button
```

### iOS Simulator

```bash
nvm use 22
npm run ios:sync          # ads OFF — or npm run ios:sync:mock for fake ads
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/dd CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted /tmp/dd/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.noqyris.exactly67
xcrun simctl io booted screenshot menu.png       # observe
```

The simulator is the only place the **native layer** runs: the IAP products'
prices load via StoreKit (the Store screen shows the packs, No ads and the unlock),
and — in a build with ads on — ATT and the LevelPlay consent modal are prompted.

The Xcode **Ad-mode guard** runs on these builds too. An ads-off (`ios:sync`) or mock
(`ios:sync:mock`) bundle builds with `AD_TARGET` unset. An `ios:sync:test` bundle builds
**only** with `AD_TARGET=test` stated (`AD_TARGET=test xcodebuild …`, or
`AD_TARGET=test npx cap run ios`), and is never archived. `npx cap run ios -l` (live
reload) does not build at all: it writes `server.url` into `capacitor.config.json`,
which the guard refuses.

> ⛔ **LevelPlay has no test inventory.** An `ios:sync:test` build on a simulator or
> a device serves the **real** waterfall; there is no test-device mode that makes a
> tap safe. Use `ios:sync` (ads off) or `ios:sync:mock` (fake ads) for anything
> interactive, and look but never tap in a `test` build. The iOS LevelPlay ids are
> real since 2026-09-16, so an iOS ads-on build now **does** show ATT, the consent
> modal and real ads.

> ⚠️ **You cannot programmatically drive the simulator's UI.** macOS blocks
> synthetic mouse/keyboard input into another app without an **Accessibility**
> grant (`osascript` → error `-25211`), and `simctl` has no tap command (and `idb`
> isn't installed). So automated tapping/typing into the simulator is not possible
> from a headless session. Native gameplay flows (placing weights, triggering an
> interstitial, verifying audio resumes after an ad) must be driven **by hand** on
> the simulator or a real device — the gameplay *logic* is already covered on web.
> To enable driven simulator testing, grant Accessibility to the controlling
> terminal in **System Settings → Privacy & Security → Accessibility**, then the
> game's dev keyboard shortcuts (number keys toggle weights, `N` next, `R` restart,
> `M` mute) can be sent to the focused simulator.

### Seeding progress for testing

To jump to a specific level without clearing everything, seed the progress store.
The value is `{ stars: { global: 1..3 }, best: { global: pieces } }`; a level is
"unlocked" if it or its predecessor is cleared, so seed up to *N−1* to make `Play`
land on level *N*.

```js
// Web (localStorage; Capacitor Preferences prefixes keys with CapacitorStorage.)
const stars = {}, best = {}
for (let i = 1; i <= 45; i++) { stars[i] = 3; best[i] = 1 }
localStorage.setItem('CapacitorStorage.exactly67.progress',
  JSON.stringify({ stars, best }))
// reload → "Play · level 46"
```

On the simulator, write the same JSON to `exactly67.progress` in the app's
Preferences plist (or clear it to reset).

---

## 4. Manual E2E test matrix

The whole game was driven click-by-click on web (identical code to device). Every
row below was exercised and passed. This first matrix dates from the 72-level,
AdMob-era build (hence the `/216` star chip); the gameplay rows still describe the
game, and the ad flow was re-verified after the LevelPlay migration in the table
that follows.

| Area | What was verified |
|---|---|
| **Menu** | Scale renders and idles; Play/Level-map buttons work; "Play · level N" resumes at the first uncleared level. |
| **Place** | Tap a tray weight → it moves to the pan; HUD total updates; "X to go" gap text; beam tilts by the total. |
| **Remove** | Tap a placed weight → returns to the tray; HUD reverts; locked weights stay (can't be removed). |
| **Balloons (L6)** | Negative weights lift the pan; `72 − 5 = 67`; balloon art + "balloons lift!" messaging. |
| **Locked (L6, L18)** | Pre-placed, unremovable; count toward the star "used". |
| **useAll — blocked (L46)** | A subset summing to 67 (`59+47+31−29−41`) shows **green "67" but "Balanced — but every weight must be aboard!"**, beam locked level, **no win** (the `3`/`−3` net-zero pair still in the tray). |
| **useAll — win (L46)** | Placing all 7 → win, `Solved with 7 — the perfect minimum!` |
| **Win + stars** | "EXACTLY 67!" overlay; **3★ = solver minimum** (verified at 1/2/3/7 pieces); star pop-in animation. |
| **Level map** | Packs, per-level stars/padlocks, total-stars chip (**141/216** for 47 cleared), scroll, tap-to-play, back. |
| **Hint** | Verified in this pass with the original flow (first hint free, then a rewarded "Watch ad"). The current flow — spend a banked hint on the ghost demo, open the hint modal at zero — and its video were re-verified on the mock build below. |
| **Progress** | Seeded progress read on boot; a win writes through (`L46 win → "Play · level 47"`). |
| **Navigation** | Play / Next / Map / Back all route correctly. |
| **Toggles** | Sound toggle flips the muted icon. |

**Ad flow on the mock build (browser, verified 16 September 2026, after the
LevelPlay migration):**

| Area | What was verified |
|---|---|
| **Layout** | At 320×568 and 1024×1366 the "Privacy choices" link overlaps nothing, and the fake banner exactly fills the 58 px strip. |
| **Privacy choices** | The link opens the privacy sheet; it closes. |
| **Hint video** | Closing early kept `hintCount` at 0; watching the 5 s through gave 1. The game loop slept while the video was up and woke after; the banner came back. |
| **Interstitial** | On level 10, 91 s into the session, "Next" opened it. The game stayed on level 10 for the 10 s the ad was up and moved to 11 only after Close; `adClears` reset from 3 to 0. |
| **Tests catch breakage** | Nine rules broken one at a time — init without consent, a `DENIED` decline let through, an Unlimited owner initialising, no pack-finale skip, no wait for dismissal, a skipped video paying out, the watcher attached after show, `ADS:off` ignored, the strip reserved for owners — each failed the suite. |

**After the fix round (browser, mock build, 16 September 2026; checked by eye, desktop
browser, no device):**

| Area | What was verified |
|---|---|
| **Hint modal copy** | At 390×844 the button reads "Watch ad: +1 hint"; at 320×568 it falls back to "Ad: +1 hint". "Loading…" while the fake ad loads, *Done* staying shut while it is up, the note under the card after a skipped ad and after an earned one, and the videos-off state (consent forced off) with *Done* alone. The scene's own toast was shown to sit behind the card on 320 and 390 phones, which is why the modal writes its own note. On 320 pt the note wraps to two lines over the top of the tray, still readable. |
| **Level map footer** | With the strip reserved, tiles never scroll into or under the fake banner at 320×568, 390×844 and 820×1180; a click on the hidden part of a tile under the footer does nothing, a click on its visible part opens the level; the last row stops clear of the footer. A No ads owner gets no footer. Leaving the map scrolled deep and coming back still starts at the top (the 54e34dc fix holds). |
| **Store (No ads card)** | The sublabel reads "hints not included · hint videos stay" at 375 and 390; "without hints · hint videos stay" at 320 in USD; "hint videos stay" at 320 with a long local price. At 320×568 with the strip reserved, "Hints never expire." no longer collides with the Unlimited card. Prices came from a render-only stub injected in the page (the web build has no StoreKit); confirm once on an ads-off simulator build. |
| **Tests catch breakage** | Each new guard (consent gate on every surface, the reset order, the failed-banner teardown, the cache-only interstitial, the rewarded display deadline, the music hold) was broken on purpose and a test failed every time. |

**Native (simulator, observed in the AdMob era — not re-run on LevelPlay):** clean
launch; `[CdvPurchase.AppleAppStore.objc] Initialized.`; the Store screen's four
prices + `Restore purchases` render; ATT resolved.

**Not yet verified on LevelPlay, on any device:** the native consent modal showing
`CONSENT_COPY` and the privacy link, ATT order, banner fill in the strip on a notched
iPhone, interstitial and rewarded presentation, the Phaser loop sleep/wake inside
WKWebView, and that `initialize()` does not crash (the App target's `-ObjC` linker
flag is there because KVIZKO's SDK crashed at `initialize()` without it, BUG-9 — a
compile cannot prove it). Also unverified natively: the one-time consent reset showing
the modal again on an install upgraded from 1.2.0, a withdrawal from Privacy choices
taking the real banner down mid-session, the `RewardedDisplayed` event arriving within
the 10 s display deadline for real Unity videos, and whether a web view reports
"visible" while a real ad is still up (the music hold covers it either way; only a real
ad could show which). The iOS ids exist since 2026-09-16; what is left is an
`ios:sync:test` pass on a device with `AD_TARGET=test` — eyes only, never tap.

---

## 5. The adversarial audit

A multi-agent correctness review swept the codebase in four dimensions (the recent
fixes, the pure logic, render/input, and services/persistence). Each dimension's
finder produced candidate bugs; **each finding was then independently
adversarially verified** (a second agent tried to *refute* it). 14 agents, 10 raw
findings, **6 confirmed** (5 distinct — one bug was found by two dimensions).

Refuted as false alarms: onboarding clears counting toward cadence (the first ad
correctly fires on leaving L6), owners losing a second daily hint, an
`initHintState` boot race, and `validatePacks` not enforcing `|value| ≤ 99` (it's
asserted in `levels.test.ts`).

### The 5 confirmed bugs (all fixed)

All were **low severity** — no crash, no data loss — and all are fixed and verified.

| # | Bug | File | Fix | Verified |
|---|---|---|---|---|
| **1** | Menu scale could overlap the Play button on the smallest/oldest iPhone (SE 1st-gen, 320×568) with a banner **and** the Remove-ads button — the fit floor left it larger than the gap. | `MenuScene.ts` | Hard-clamp the scale's bottom to `gapBottom − scaleDrop` so it can never cross into the button (it shrinks / rides toward the subtitle instead); lower the floor to `0.35`. | Extreme short viewport (360×500): scale stays above the button. Normal viewport unchanged. |
| **2** | Interstitial cadence counter reset **before** the ad was shown → an offline/no-fill break silently burned a full 5-clear cycle. *(Found by two dimensions.)* | `ads.ts` | Reset `clearsSinceInterstitial` only **after** `showInterstitial()` resolves; a failed attempt leaves the counter armed to retry. | Code review. |
| **3** | `parseProgress` coerced non-numeric corrupt values (`true→1`, `[3]→3`, `"3"→3`) past the range check, injecting unearned clears/unlocks from a tampered save. | `progress.ts` | Add a `typeof v === 'number'` guard before the range check (honors the documented "drop corrupt" contract). | `tsc` + 53 tests still pass. |
| **4** | The over-weight HUD message hard-coded "balloons lift!" even on positive-only levels (1–5) that have no balloon — telling players to use a mechanic that isn't there. | `GameScene.ts` | Show "balloons lift!" only when an *unplaced balloon exists*, otherwise "remove a weight". | Level 3 (positive-only) overshoot now reads "5 too heavy — remove a weight". |
| **5** | Win-overlay buttons stayed interactive during the awaited interstitial → a second tap (e.g. Retry) could queue a competing, mis-routed navigation. | `GameScene.ts` | Lock all overlay buttons on the first press with a local `once()` guard. | Code review. |

> These fixes ship in the **next build**. The build already in App Review (`1.1.0
> (9)`) predates them and is unaffected — it addresses the store rejection (age
> rating + IAP), not this polish.

---

## 6. Known limitations of automated testing

- **Native UI can't be driven headlessly** (macOS Accessibility, §3). Interstitial
  timing, audio-resume-after-ad, and haptics need a hands-on device/simulator pass.
- **IAP and haptics are web no-ops**, so those paths aren't exercised by the web
  E2E — they're verified on the simulator and by code review. The **ad** flow is
  exercised on the web through the mock build; the native LevelPlay plugin only
  through its mocked unit tests until a device pass.
- **Real ad fill can't be tested safely.** LevelPlay has no test ad units and no
  test inventory: `isTesting` only unlocks Unity's Test Suite, and a dashboard
  Test Device pin narrows the source for about an hour without making an ad safe to
  tap. Only LevelPlay's reports can say whether the waterfall fills. **Never tap an
  ad on any build** — invalid traffic is what closed the AdMob account on
  2026-08-18, and Unity terminates and claws back for the same thing.

---

## Further reading
- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`reference/GAME.md`](reference/GAME.md) ·
  [`reference/RENDER.md`](reference/RENDER.md) ·
  [`reference/SERVICES.md`](reference/SERVICES.md)
- [`RELEASE.md`](RELEASE.md) — build & ship. · [`MONETIZATION.md`](MONETIZATION.md)
  — ads/IAP go-live.
