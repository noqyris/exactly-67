# Testing & QA

How *Exactly 67* is verified: the build-time gates, the unit suite, how to run and
drive the app for manual testing, the end-to-end test matrix, and the record of an
adversarial code audit and the fixes it produced.

The app has **four** layers of assurance:

1. **Type gate** — `tsc --noEmit` (strict).
2. **Content + logic gate** — Vitest suite, incl. `validatePacks(PACKS)` proving
   every shipped level is solvable.
3. **Manual E2E** — driving the real game (identical Phaser code on web and
   device) through every mechanic.
4. **Adversarial audit** — multi-agent correctness review of the whole codebase.

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

Current status: **`tsc` clean · 53/53 tests pass.**

---

## 2. Unit suite (`src/game/*.test.ts`)

The pure logic core (`src/game`) is fully unit-tested — **53 tests across 5
files**. The render/services layers are covered by manual E2E (§4), since they need
Phaser + a device.

| File | Covers |
|---|---|
| `balance.test.ts` | `panTotal`, `gapToTarget`, `isBalanced`, `beamAngleDeg` (0 at 67, antisymmetry, ±13° saturation). |
| `rules.test.ts` | `initialPlacement`, `canPlace`/`place`/`canRemove`/`remove`, the immutability contract, `evaluate` incl. `useAll` / `blockedReason`. |
| `solver.test.ts` | `solveLevel` minimums honoring locked/useAll/maxWeights, the >16-weight throw, `minimalSolution`. |
| `levels.test.ts` | **The build gate:** `validatePacks(PACKS) == []`, 300 levels across 13 packs, packs 1-3 frozen at 24 (progress is keyed by global number), the difficulty ramp is monotonic pack-to-pack, no duplicate trays, balloon debut at L6, global-number round-trips, tray bounds. |
| `progress.test.ts` | `mergeClear` monotonicity, `isUnlocked` one-step-back, `parseProgress` dropping corrupt entries. |

---

## 3. How to run and drive the app

### Web (the primary way to drive gameplay)

```bash
npm run dev          # vite dev server → http://localhost:5173
```

The browser runs the **exact same Phaser code** as the device — same rendering,
input, and game logic. Only the native-only services differ: ads, IAP, and haptics
are **web no-ops** (so the "Remove ads" button and the banner don't appear on web).
This makes the browser the fastest, most reliable way to test gameplay.

Drive the canvas with real pointer events (the game is canvas-only, so there are no
DOM elements to target — click by pixel coordinate):

```js
// via a Playwright/automation harness
await page.mouse.click(x, y)   // tap a weight in the tray, or a button
```

### iOS Simulator

```bash
nvm use 22
npm run build && npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/dd CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted /tmp/dd/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.noqyris.exactly67
xcrun simctl io booted screenshot menu.png       # observe
```

The simulator is the only place the **native layer** runs: the real AdMob banner
loads (test ads — simulators are always AdMob test devices, never billed), the IAP
products' prices load via StoreKit (the Store screen shows `$0.99 / $1.99 /
$2.99` packs and the `$4.99` unlock), and ATT is prompted.

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
row below was exercised and passed.

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
| **Hint** | First hint **free** (highlights the correct weight); second prompts **"Watch ad"** (rewarded) → grants + highlights the solver-chosen weight. |
| **Progress** | Seeded progress read on boot; a win writes through (`L46 win → "Play · level 47"`). |
| **Navigation** | Play / Next / Map / Back all route correctly. |
| **Toggles** | Sound toggle flips the muted icon. |

**Native-only (simulator, observed — not gameplay-driven):** clean launch with no
crash/exception in the logs; `[CdvPurchase.AppleAppStore.objc] Initialized.`; the
real banner loads + displays; the menu `Store` button opens a Store screen whose
four prices + `Restore purchases` all render;
ATT resolved; the responsive menu layout accommodates the real banner without the
scale overlapping the buttons.

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
- **Ads/IAP/haptics are web no-ops**, so those code paths aren't exercised by the
  web E2E — they're verified by the simulator launch (services init + banner + IAP
  price) and by code review.
- **Real (billable) ad fill** can't be tested — only Google test ads serve on
  simulators/registered test devices. Never tap live ads (invalid traffic → AdMob
  ban).

---

## Further reading
- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`reference/GAME.md`](reference/GAME.md) ·
  [`reference/RENDER.md`](reference/RENDER.md) ·
  [`reference/SERVICES.md`](reference/SERVICES.md)
- [`RELEASE.md`](RELEASE.md) — build & ship. · [`MONETIZATION.md`](MONETIZATION.md)
  — ads/IAP go-live.
