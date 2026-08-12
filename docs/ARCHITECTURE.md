# Exactly 67 — Architecture Reference

Engineering reference for the codebase, one level deeper than `CLAUDE.md`. It describes how the layers fit together, the pure logic core in detail, the level system, the Phaser render stack, the platform services, and the native iOS wrapper. Every claim is anchored to a `file:line`.

Exactly 67 is a Phaser 3 + TypeScript + Vite puzzle game wrapped for iOS with Capacitor. The player fills a right-hand pan with signed weights — positive down-weights, negative balloons — to make the pan total equal exactly `67`. All art is drawn procedurally with `Phaser.Graphics`; there are no image or audio assets.

---

## 1. Layered module overview

The source splits into three layers under `src/`:

- **`game/`** — the Phaser-free, fully unit-tested rules core. Types, balance math, the placement state machine, the solver, star scoring, the progress model, and the level content.
- **`render/`** — everything visible: the Phaser boot, three scenes, two view classes, and shared vector-art/UI helpers.
- **`services/`** — the platform-abstraction boundary: audio synthesis, haptics, persistence, and the in-memory progress cache.

```
        ┌────────────────────────────────────────────────┐
        │  render/   (Phaser 3 — the visible surface)     │
        │  main.ts · layout · palette · ui                │
        │  MenuScene · LevelMapScene · GameScene          │
        │  ScaleView · WeightView                         │
        └───────────────┬───────────────────┬────────────┘
                imports  │                   │  imports
                         v                   v
        ┌─────────────────────┐    ┌──────────────────────────┐
        │  services/          │    │  game/   (pure logic)     │
        │  audio · haptics    │──> │  types · balance · rules  │
        │  storage ·          │    │  solver · stars ·         │
        │  progressStore      │    │  progress · levels/*      │
        └─────────┬───────────┘    └──────────────────────────┘
                  v
   Capacitor Preferences / Haptics · Web Audio API
```

**The dependency rule.** Arrows point down the stack toward the pure core.

- `game/` imports nothing from `render/` or `services/`, and never imports Phaser or the DOM. Its only cross-file edges are internal (`types` ← `balance` ← `rules`; `types` ← `solver`; `levels/*` ← `types`). `stars.ts` and `progress.ts` have no imports at all.
- `services/` may import the `game/` data model (e.g. `progress.ts`) plus platform SDKs, but never `render/`.
- `render/` may import both `game/` and `services/` (plus Phaser).

No upward edges, no cycles. This is what keeps the logic core testable in a plain Node/Vitest environment (`vite.config.ts` sets `test.environment: 'node'`).

---

## 2. The pure logic core (`src/game`)

### Types and the one constant

`types.ts` holds the shared contracts and the single number the whole game revolves around:

- `TARGET = 67` (`types.ts:2`) — the fixed left-pan value the right pan must match.
- `LevelDef` (`types.ts:9`) — `{ weights: number[]; locked?: number[]; maxWeights?: number; useAll?: boolean; hint?: string }`. Only `weights` is required; the rest are optional constraints.
- `LevelPack` (`types.ts:22`) — `{ id; name; tagline; levels }`.
- `Evaluation` (`types.ts:31`) — `{ total; gap; balanced; won; blockedReason? }`, the runtime output the HUD and beam consume after every pan change.

### Balance math (`balance.ts`)

Stateless functions over a numeric total, with no level or state knowledge:

- `panTotal(values)` (`balance.ts:13`) — sum of signed values; empty pan → 0.
- `gapToTarget(total)` (`balance.ts:17`) — `total - TARGET`.
- `isBalanced(total)` (`balance.ts:21`) — strict `total === 67`. Weights are validated as non-zero integers, so there is no float tolerance concern; equality is exact.
- `beamAngleDeg(total)` (`balance.ts:29`) — the deterministic visual tilt, `13 * tanh((total - 67) / 18)`. It is `0` at 67, monotonic, antisymmetric about 67, and **saturates** at ±`MAX_BEAM_ANGLE_DEG` (13, `balance.ts:4`) rather than flipping the beam over. A gap of 1 still tilts ~1°; a gap of 100 reads as maximum tilt, not a spin. `ANGLE_SOFTNESS = 18` (`balance.ts:11`) is a private module constant — not exported.

Note `beamAngleDeg` takes the **total**, not the gap, and computes the gap internally.

### Rules — the placement state machine (`rules.ts`)

State is a `Placement = boolean[]` (`rules.ts:6`), parallel-indexed to `LevelDef.weights`; `placed[i] === true` means `weights[i]` is on the pan.

- `initialPlacement(level)` (`rules.ts:8`) — all-false, then every `locked` index flipped true. Locked weights start aboard.
- Queries: `isLocked` (`rules.ts:14`), `placedCount` (`rules.ts:18`, counts locked pieces too), `placedValues` (`rules.ts:22`), `rightTotal` (`rules.ts:26`).
- `canPlace(level, placed, index)` (`rules.ts:33`) → refuses `'already-placed'` if on the pan, or `'budget-full'` if `maxWeights` is set and `placedCount >= maxWeights`. **Budget counts locked pieces toward the cap.** It does **not** bounds-check `index` — the UI supplies valid tray indices.
- `canRemove(level, placed, index)` (`rules.ts:46`) → true only if placed and not locked.
- `place` (`rules.ts:50`) / `remove` (`rules.ts:57`) — immutable. On success they return a **new** array; on a failed guard they return the **same** array reference unchanged. Callers can use reference-equality to detect no-ops, but must not assume a fresh array is always returned.

#### `evaluate()` — the single source of truth

`evaluate(level, placed)` (`rules.ts:70`) is the one function every consumer calls after any change. It computes:

```
total    = rightTotal(level, placed)
balanced = isBalanced(total)            // total === 67
won      = balanced && !(useAll && !allPlaced)
```

where `allPlaced` is `placed.every(Boolean)` (`rules.ts:73`). The beam angle, the HUD chip color, the gap message, and the win trigger all derive from this one `Evaluation`, so there is no second place that can disagree about whether a level is cleared.

#### The `useAll` "balanced but not won" subtlety

A `useAll` level can read `balanced: true` at 67 yet `won: false` — because the remaining tray weights (which net to zero via balloons) are not aboard yet. `evaluate` signals exactly this with `blockedReason: 'use-all'` (`rules.ts:80`), the **only** `blockedReason` value in the game. Example: `[30, 25, -8, 20], useAll: true` — placing `30 + 25 - 8 + 20 = 67` but leaving one out reads balanced-yet-blocked until all four are on.

### Solver (`solver.ts`)

Offline analysis, not a runtime hot path. `MAX_LEVEL_WEIGHTS = 16` (`solver.ts:5`) keeps brute force (2¹⁶ subsets) instant.

- `solveLevel(level)` (`solver.ts:27`) → `{ solvable, minWeights }`. It enumerates every subset `mask = 0..(1<<n)-1` (`solver.ts:39`) and treats a mask as a candidate only if it contains all locked bits (`(mask & lockedMask) === lockedMask`), equals `full` when `useAll` is set, and has `popcount <= maxWeights`. It records the **minimum** `popcount` whose signed sum is 67. `popcount` (`solver.ts:13`) is Kernighan's bit-clear loop. It **throws** if `weights.length > MAX_LEVEL_WEIGHTS` (`solver.ts:29`).
  - Minimum-not-first-found detail: `if (best !== null && count >= best) continue` (`solver.ts:44`) prunes any subset no smaller than the current best **before** summing, which is why scanning masks `0..full` yields the true minimum.
- `validatePacks(packs)` (`solver.ts:62`) → a list of human-readable problems; **empty means all good**. It checks: no weights, too many weights, non-zero-integer weights, locked index in range / no duplicates, `maxWeights >= max(1, locked.length)`, `useAll` vs `maxWeights < n` conflict, and solvability via `solveLevel`. It is invoked from the test suite as the **build gate** (see §3 and §6).

### Stars (`stars.ts`)

`starsForClear(used, minWeights)` (`stars.ts:6`) is a pure efficiency rating: `used <= min → 3`, `used <= min + 2 → 2`, else `1`. `used` is the weights on the pan at clear (locked included); `min` comes from the solver. Because `min` is the true minimum, `used` can never be below it in normal play, so `<=` is effectively `==` for 3 stars. It never returns 0 — "0 stars" means "not cleared", which lives only in `Progress`.

### Progress (`progress.ts`)

The persisted model, self-contained and unit-tested; reading/writing the store lives in `services/storage.ts`.

- `Progress` (`progress.ts:6`) — `{ stars: Record<string, number>; best: Record<string, number> }`, keyed by the **string** of the 1-based global level number.
- `mergeClear(progress, globalLevel, stars, weightsUsed)` (`progress.ts:18`) — immutable and monotonic: `stars = max(prev, stars)`, `best = min(prev, weightsUsed)` (or `weightsUsed` if none). Stars and best count are tracked independently and never regress.
- `starsFor` / `bestFor` / `isCleared` (`progress.ts:36–45`) — `isCleared` is defined purely as `stars > 0`.
- `isUnlocked(progress, globalLevel)` (`progress.ts:52`) — level 1 is always open; any level is open if it is cleared or the **immediately previous** level is cleared. It only looks one step back, so a level cleared out of order unlocks its immediate successor but leaves gaps locked; a cleared level always stays replayable.
- `totalStars` (`progress.ts:60`).
- `parseProgress(raw)` (`progress.ts:65`) — defensive: null/empty/bad-JSON/non-object → `emptyProgress()`. It keeps only entries whose key matches `/^\d+$/` and whose integer value is in range (stars 1–3, best 1–99); everything else is silently dropped rather than throwing.

**Wiring.** Nothing in `rules.ts` imports the solver, stars, or progress. The render layer is the orchestrator that chains `evaluate() → solveLevel() → starsForClear() → mergeClear()`.

---

## 3. Level content system (`src/game/levels`)

All 300 puzzles live here: packs 1-3 hand-authored, packs 4-13 generated by `tools/generate-levels.ts` and solver-verified.

- `pack1.ts` / `pack2.ts` / `pack3.ts` — three themed `LevelPack`s of 24 levels each: `pack-1` "Warm-Up", `pack-2` "Prime Time", `pack-3` "Heavy Lifting".
- `index.ts` aggregates them:
  - `PACKS` (`index.ts:6`) — `[pack1, pack2, pack3]`. Pack order defines global numbering (pack1 → 1–24, pack2 → 25–48, pack3 → 49–72).
  - `TOTAL_LEVELS` (`index.ts:8`) — `PACKS.reduce(...)` = 72. Derived, not hard-coded.
  - `LevelRef` (`index.ts:10`) — `{ def, pack, packIndex, levelIndex, global }`.

### Global numbering

The player-facing "global" number is 1-based across all packs and is **not** stored on levels — it is derived from pack order and lengths.

- `levelByGlobal(global)` (`index.ts:21`) walks packs accumulating an `offset`; when `global <= offset + pack.levels.length` it returns a `LevelRef` with `levelIndex = global - offset - 1`. Global 0 yields `null` (levelIndex < 0); any global > 72 falls through to `null`.
- `globalOf(packIndex, levelIndex)` (`index.ts:35`) is the inverse: sum of prior pack lengths + `levelIndex + 1`.

### Content validation

Correctness is a **build-time** gate, not a runtime check. `src/game/levels.test.ts` runs under `vitest`, and `npm run build` runs `vitest run` (§6). It asserts:

- `validatePacks(PACKS)` returns `[]` — any unsolvable or malformed level makes the array non-empty and fails `toEqual([])`, which fails the build before `vite build` runs.
- 13 packs = 300 levels (packs 1-3 frozen at 24 each, since progress is keyed by global level number); trays are 1–12 weights with `|value| <= 99` (1–12 weights is a stricter shipping bound than the solver's 16-weight ceiling); the balloon mechanic debuts at level 6; solver minimums are reachable; global numbering round-trips at the boundaries.

Mechanics debut behind a `hint` in Pack 1 (drag L1, balloon L6, `useAll` L11, `maxWeights` budget L14, `locked` build-around L18); Pack 3 stacks constraints with no hints.

---

## 4. Render architecture (`src/render`)

### Boot (`main.ts`)

`boot()` (`main.ts:17`) constructs the Phaser game after the platform is ready:

1. `await document.fonts.ready` (`main.ts:19`) so the first paint uses the bundled Baloo 2 font instead of a fallback.
2. `Promise.all([initProgress(), loadSoundEnabled(), loadHapticsEnabled()])` (`main.ts:21`), then push the two flags into `setSoundEnabled` / `setHapticsEnabled` (`main.ts:26–27`).
3. `new Phaser.Game({ ... })` (`main.ts:32`) with `backgroundColor: BG_CSS` and scene list `[MenuScene, LevelMapScene, GameScene]` (`main.ts:43`) — index 0 (`Menu`) auto-starts.

### Manual DPR retina scaling

The canvas is sized in **physical device pixels** and displayed at CSS size:

```
width:  window.innerWidth  * DPR
height: window.innerHeight * DPR
scale:  { mode: Phaser.Scale.NONE, zoom: 1 / DPR }
```

(`main.ts:37–42`). `Phaser.Scale.RESIZE` tracks CSS pixels only and cannot give a physical-pixel backing store, so it is deliberately avoided (`main.ts:29–31`). Resizes are handled by a hand-written `window 'resize'` listener that calls `game.scale.resize(innerWidth * DPR, innerHeight * DPR)` (`main.ts:46–48`).

Because the canvas is in device pixels, **every fixed dimension goes through `u()`**. `DPR = clamp(devicePixelRatio, 1, 3)` (`layout.ts:6`); `u(n) = n * DPR` (`layout.ts:8`); 1 design unit = 1 CSS px. `TEXT.ink` / `TEXT.cream` (`ui.ts`) already apply `u()` to font sizes, so passing a value that is already in device pixels double-applies DPR — a few block/balloon/level-button labels deliberately use a raw px font for that reason.

`contentFrame(screenW, screenH)` (`layout.ts:32`) caps the play area at `MAX_CONTENT_W × MAX_CONTENT_H` = `u(680) × u(940)` (`layout.ts:18–19`) and centers it — full-screen on phones, a centered column on tablets. `safeArea()` (`layout.ts:55`) reads iOS notch/home-indicator `env()` insets exposed by `style.css` and converts them to device px.

### The three scenes and navigation

A simple star topology, all transitions via `scene.start` / `scene.restart`:

```
        ┌────────────┐   {level: next}   ┌────────────┐
        │  MenuScene │ ─────────────────>│  GameScene │
        │  'Menu'    │                   │  'Game'    │
        └────┬───▲───┘                   └────┬───▲───┘
        {}   │   │ (no data)   {scrollTo: │   │ {level:
             │   │              global}   │   │  global}
             v   │                        v   │
        ┌──────────────────────────────────────────┐
        │            LevelMapScene 'LevelMap'       │
        └──────────────────────────────────────────┘
```

- **MenuScene** (`MenuScene.ts:15`) — title, a live idle `ScaleView` "heartbeat", Play (continues to the first uncleared level, scanning `isCleared`), a Level-map button, and sound/haptics toggles.
- **LevelMapScene** (`LevelMapScene.ts:12`) — a scrollable 4-column grid of the three packs with stars or a padlock per level, a total-stars chip, a sticky header, and custom drag/wheel scrolling. `init({ scrollTo? })` lands a given level in view. Its back button returns to `Menu` with no data (`LevelMapScene.ts:37`).
- **GameScene** (`GameScene.ts:58`) — the playable scene. `init({ level? })` defaults to 1 and resolves via `levelByGlobal`, throwing on an unknown level (`GameScene.ts:91–93`).

Data passing: Menu→Game passes `{ level: next }`; Map→Game passes `{ level: global }`; Game→Map (back, Escape, and the win overlay's Map/The End buttons) passes `{ scrollTo: this.ref.global }`; win-overlay **Next** does `scene.restart({ level: global + 1 })`, **Retry** `restart({ level: global })`. GameScene has no direct transition back to Menu.

### Gameplay data flow inside GameScene

`create()` (`GameScene.ts:104`) builds `initialPlacement`, precomputes `minWeights = solveLevel(level).minWeights` (`GameScene.ts:108`), builds the `ScaleView`, tray, weights, and HUD, then snaps the beam with `settleImmediately()` and the weights with `steerWeights(1)`.

Each pointer/keyboard action routes to `placeWeight` / `removeWeight` (`GameScene.ts:449` / `:470`), which call `canPlace`/`place` or `canRemove`/`remove`, play SFX + haptics, and then `afterChange()` (`GameScene.ts:489`):

```
afterChange → evaluate(level, placed) → Evaluation
            → scaleView.setTargetAngle(beamAngleDeg(ev.total))
            → updateHud(ev)                     // recolor total chip + gap text
            → if ev.won && !wonState → winSequence()
```

`update(time, delta)` (`GameScene.ts:536`) advances `scaleView.update(...)` and `steerWeights(1 - exp(-12·dt))` — a frame-rate-independent lerp that glides every non-dragging weight toward its tray-home or pan target (`GameScene.ts:542`). `winSequence()` (`GameScene.ts:568`) sets `wonState`, calls `scaleView.setWon(true)`, computes `starsForClear(placedCount, minWeights)`, calls `recordClear`, then shakes, plays the jingle, and shows the overlay.

### ScaleView — the beam spring

`ScaleView` (`ScaleView.ts:33`) builds the fulcrum, a rotating beam `Container`, two upright hanging pans, the string Vs, and the fixed "67" target block on the left pan — all `Graphics`. The beam angle is an **under-damped angular spring**, not the target itself: each frame it eases `angle`/`velocity` toward `targetAngle + idle sway` (`ScaleView.ts:108–125`) with stiffness `K` and damping `C` (`ScaleView.ts:117–118`).

- `setTargetAngle(deg)` (`ScaleView.ts:82`) only sets the goal — the beam visibly springs toward it.
- `settleImmediately()` (`ScaleView.ts:87`) snaps to the target (used on scene start / reset).
- `setWon(true)` (`ScaleView.ts:94`) forces `targetAngle = 0`, kills the idle sway, and switches to firmer damping (`C = 10`), locking the beam level under the win overlay.
- The pans are **separate** Containers, not rotated with the beam; `positionPans()` (`ScaleView.ts:137`) re-derives each pan's world position from the beam-end points every frame and hangs it straight down so dishes stay upright, redrawing the strings as a fresh V.
- `rightPanAnchor()` (`ScaleView.ts:100`) is the drop-target and weight-stacking anchor GameScene reads.

### WeightView — Graphics-only weights

`WeightView` (`WeightView.ts:20`) is one draggable `Phaser.GameObjects.Container` drawn entirely with `Graphics`: `value > 0` → a handled candy block (`drawBlock`), `value < 0` → a balloon whose string terminates at the container **origin** (`drawBalloon`), so placing the origin on the pan rim makes the balloon float above it. `sizeFor(value)` (`WeightView.ts:66`) scales the body by magnitude; `weightColor` picks the fill.

The hit area is authored in **displayOrigin-relative** coordinates (`makeInteractive`, `WeightView.ts:184`): Phaser adds `displayOrigin` to the local pointer before the `Contains` test, so the rectangle is offset by `displayOriginX/Y` — get this wrong and only one quadrant of the weight is draggable. `centerOffsetY` (`WeightView.ts:207`) supports tray centering; `wiggle()` (`WeightView.ts:212`) is the refusal shake. Locked weights get a tint plus a padlock badge and no input.

### Shared helpers

`ui.ts` provides `makeButton` (chunky press-animated rounded button), `makeIconButton` (square icon button with `refresh()` to redraw muted state), `drawStar`, the sound/haptics/back icon drawers, and the `TEXT` style factory. `palette.ts` is the single source of color truth (ink outline, candy fills, semantic `GOOD/OVER/UNDER`, `OUTLINE = u(4)`, `FONT`), plus `weightColor(value)` (buckets by magnitude) and `labelColorFor(fill)` (ink vs cream for contrast).

---

## 5. Services and persistence (`src/services`)

### Audio — a Web Audio synth (no files)

`audio.ts` synthesizes **every** sound effect at play time from `OscillatorNode` + `GainNode` envelopes; the game ships zero audio files (`audio.ts:1–3`). The `AudioContext` is created lazily inside `context()` (`audio.ts:20`), which returns `null` when sound is disabled and calls `ctx.resume()` on any non-`running` state — so the first user tap unlocks audio on iOS (which starts contexts suspended, and can report the non-standard `'interrupted'`). `tone()` (`audio.ts:43`) uses exponential gain ramps that go `0.0001 → gain → 0.0001` and never target exactly 0 (an exponential ramp to 0 would throw/click). Play functions: `playPlace`, `playPlaceBalloon`, `playRemove`, `playRefuse`, `playWinJingle`.

Returning from a full-screen ad / phone call / backgrounding leaves the iOS context suspended or `'interrupted'`, silencing later sounds. `resumeAudio()` (`audio.ts:38`) plus a module-level `visibilitychange` listener resume it the moment the app is visible again (and `ads.ts` also calls it on interstitial/rewarded `Dismissed`); if `resume()` fails the context is nulled so the next tap rebuilds a fresh one.

### Haptics — Capacitor, web no-op

`haptics.ts` wraps `@capacitor/haptics`. Each of `placeTap` / `removeTap` / `refuseTap` / `winTap` is gated by the `enabled` flag and is fire-and-forget with `.catch(() => {})` (`haptics.ts:18,24,30,36`). There is no explicit platform check — on web without the vibration plugin the rejected promise is simply swallowed, so it degrades to a silent no-op.

### Storage — Capacitor Preferences

`storage.ts` wraps `@capacitor/preferences` (native key/value on iOS/Android, `localStorage` on web — web keys are prefixed `CapacitorStorage.`) with six namespaced keys:

- `exactly67.progress` — JSON `{ stars: {}, best: {} }`, via `JSON.stringify` / `parseProgress`.
- `exactly67.sound`, `exactly67.haptics` — the strings `'on'` / `'off'`.
- `exactly67.adClears` — integer string, the interstitial cadence counter.
- `exactly67.adsRemoved` — `'on'`/`'off'`, the Remove-Ads IAP flag (defaults **off**: `value === 'on'`).
- `exactly67.hintFreeDate` — UTC `YYYY-MM-DD` of the last free daily hint.

`loadFlag` (`storage.ts:33`) returns `value !== 'off'`, so a missing sound/haptics key (`null`) is **on** — both default ON on a fresh install. Every read/write is wrapped in try/catch and degrades to a safe default; a failed progress write is non-fatal (the run just isn't remembered). Renaming any key silently orphans existing player data.

### progressStore — in-memory cache

`progressStore.ts` holds a module-global `current: Progress` (`progressStore.ts:9`) so scenes can read progress synchronously via `progress()` (`progressStore.ts:15`). `initProgress()` (`progressStore.ts:11`) loads it once at boot. `recordClear(globalLevel, stars, weightsUsed)` (`progressStore.ts:19`) merges through `mergeClear` and fires `void saveProgress(current)` **without awaiting** — a slow or failed native write never blocks gameplay.

### Ads & IAP — the monetization services

`ads.ts` and `iap.ts` follow the same guarded, fire-and-forget, web-no-op pattern as `haptics.ts`. `ads.ts` wraps `@capacitor-community/admob` (init + GDPR/UMP consent + ATT, a bottom banner whose real height is reserved into `safeArea().bottom`, an interstitial every `CLEARS_PER_INTERSTITIAL` clears past onboarding, a rewarded hint, and the daily-free-hint clock). `iap.ts` wraps the one-time Remove-Ads unlock via `cordova-plugin-purchase` (StoreKit / Play Billing), granting entitlement **only** on an `approved`/`finished` transaction that actually contains the product, and mirroring ownership into `ads.setAdsRemoved`. Both keep `src/game` pure — the hint is just a new `solver.minimalSolution` query. Full detail: [`MONETIZATION.md`](MONETIZATION.md) and [`reference/SERVICES.md`](reference/SERVICES.md).

### Boot sequence ordering

`main.ts` guarantees `initProgress()` resolves **before** `Phaser.Game` is constructed (`main.ts:21–32`), so no scene ever reads an empty `current`, and `primeAdsRemoved()` runs before scenes read `adsRemoved()`. It also awaits `document.fonts.ready` before the first paint so canvas text renders in Baloo 2, not a fallback (`main.ts:19`). Ads/IAP init **after** boot so first paint is never blocked on the network.

---

## 6. Native (Capacitor — iOS + Android)

The web app is wrapped with Capacitor 8 for **both** iOS and Android (the Android
platform under `android/` carries the AdMob app id in `AndroidManifest.xml` and a
signed release config; iOS remains the primary target). `capacitor.config.ts`:

- `appId: 'com.noqyris.exactly67'`, `appName: 'Exactly 67'`, `webDir: 'dist'`.
- `backgroundColor: '#F6EEDF'` — matches the game background so there is no white flash while the web view loads.
- `ios.contentInset: 'never'` — the web view never insets its own content; the app manages safe-area via `layout.safeArea()`.

`ios/App/App/Info.plist`:

- `ITSAppUsesNonExemptEncryption = false` (`Info.plist:7`) — skips the export-compliance prompt.
- `CFBundleDisplayName = 'Exactly 67'` (`Info.plist:11`), `UIRequiresFullScreen = true` (`Info.plist:37`).
- **Portrait-only** on iPhone (`Info.plist:39–42`); iPad additionally allows upside-down portrait (`Info.plist:43–47`). The app is a universal iPhone + iPad build.

`npm run build` runs `tsc --noEmit && vitest run && vite build` — the `&&` chain means the level-solvability gate (`validatePacks(PACKS)` in `levels.test.ts`, §3) aborts the build **before** `vite build` if any level is malformed or unsolvable. `npm run ios:sync` = `npm run build && cap sync ios` copies `dist/` into the native project. Because `vite.config.ts` sets `base: './'`, built assets resolve from `capacitor://localhost`; changing it to `'/'` would break iOS asset loading.

---

## 7. End-to-end: playing a level

Tying the layers together, from launch to a recorded clear:

1. **Boot** (`render` + `services`). `boot()` awaits fonts, `initProgress()` (fills the `progressStore` cache from `storage` → Preferences), and the two settings flags, then constructs Phaser with `[Menu, LevelMap, Game]` (`main.ts:17–44`).
2. **Navigate.** MenuScene reads `progress()` to find the first uncleared level and starts GameScene with `{ level }`; or the player opens LevelMapScene and taps a level, which starts GameScene with `{ level: global }`.
3. **Level start** (`game` + `render`). `GameScene.init` resolves the global number via `levelByGlobal` (`game/levels`), then `create()` builds `initialPlacement(level)` (locked weights aboard) and precomputes `minWeights = solveLevel(level).minWeights`. The `ScaleView` and `WeightView`s are drawn; the beam is snapped with `settleImmediately()`.
4. **Player taps a tray weight.** `placeWeight` calls `canPlace` → `place` (`game/rules`); a refusal instead triggers `wiggle()` + `playRefuse()` + `refuseTap()`. On success it plays a place tone and a light haptic.
5. **Re-evaluate** (`game`). `afterChange()` calls `evaluate(level, placed)` — the single source of truth — producing `{ total, gap, balanced, won, blockedReason }`.
6. **Reflect it** (`render`). `scaleView.setTargetAngle(beamAngleDeg(ev.total))` nudges the spring; `updateHud(ev)` recolors the total chip and gap message. A `useAll` level at 67 with weights still in the tray shows the "balanced — but every weight must be aboard" toast (`blockedReason: 'use-all'`).
7. **Win** (`game` + `services`). When `ev.won` first flips true, `winSequence()` locks the beam (`setWon(true)`), computes `starsForClear(placedCount, minWeights)`, and calls `recordClear(global, stars, used)`. `progressStore` folds it in with `mergeClear` (max stars, min weights) and fires `saveProgress` → Preferences without blocking. The jingle plays, the camera shakes, and the win overlay offers Next / Retry / Map.
8. **Persist and unlock.** The next launch's `parseProgress` reconstructs the saved `Progress` (dropping any corruption), `isUnlocked` opens the following level, and the map shows the earned stars.

---

## Further reading

- **Per-module API reference** (every export, signature, gotcha):
  [`reference/GAME.md`](reference/GAME.md) ·
  [`reference/RENDER.md`](reference/RENDER.md) ·
  [`reference/SERVICES.md`](reference/SERVICES.md)
- [`LEVEL_DESIGN.md`](LEVEL_DESIGN.md) — authoring & tuning levels.
- [`MONETIZATION.md`](MONETIZATION.md) — ads & IAP wiring and go-live.
- [`TESTING.md`](TESTING.md) — build gate, E2E matrix, the audit + fixes, how to run/drive.
- [`RELEASE.md`](RELEASE.md) — build & ship to both stores.
