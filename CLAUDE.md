# Exactly 67

A balance-scale number puzzle for iOS: the left pan holds a fixed **67**, and you fill the right pan with signed weights until its total is **exactly 67** and the beam locks level. Positive weights are down-weights (pan sinks); negative weights are balloons that lift/pull the pan up. 72 hand-authored levels across 3 packs.

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
| `npm run ios:sync` | `npm run build && cap sync ios` | Build web, copy into the native iOS project, sync plugins. Needs Node >= 22. |
| `npm run ios:open` | `cap open ios` | Open `ios/App/App.xcodeproj` in Xcode. |

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
| `levels/` | `pack1/2/3.ts` (24 levels each) → aggregated in `index.ts` as `PACKS`, `TOTAL_LEVELS` (72), `levelByGlobal`/`globalOf`. |

Internal deps only: `balance ← rules`, `types ← everything`, `solver` and `stars` are only exercised together in tests. `rules.ts` never imports `solver`/`stars`/`progress` — the UI orchestrator wires those together.

### `src/render` — Phaser scenes + Graphics-only vector art
| File | Role |
|---|---|
| `../main.ts` | Boot: awaits font + settings, builds `Phaser.Game`, scenes `[MenuScene, LevelMapScene, GameScene]` (Menu auto-starts). |
| `layout.ts` | `DPR` (clamped 1–3), `u(n)=n*DPR`, `contentFrame()` (caps play area to 680×940), `safeArea()`, `prefersReducedMotion()`. |
| `palette.ts` | Single color/typography source: `INK`, `BG`, candy fills, `weightColor(value)`, `FONT`. |
| `MenuScene.ts` / `LevelMapScene.ts` / `GameScene.ts` | The three scenes. `GameScene` (~700 LOC) is the play loop. |
| `ScaleView.ts` | The beam: under-damped angular spring toward a target angle; upright hanging pans; `setWon()` locks level. |
| `WeightView.ts` | One draggable weight (`value>0` = candy block, `value<0` = balloon), Graphics-only. |
| `ui.ts` | Shared helpers: `makeButton`, `makeIconButton`, `drawStar`, icon glyphs, `TEXT.ink/cream` style factory. |

### `src/services` — platform abstraction
| File | Role |
|---|---|
| `audio.ts` | Web Audio **synth** — every SFX generated from oscillators + gain envelopes at play time. No audio files. |
| `haptics.ts` | Toggle-gated `@capacitor/haptics` wrapper; fire-and-forget, silently no-ops on web. |
| `storage.ts` | `@capacitor/preferences` wrapper. Keys: `exactly67.progress` (JSON), `exactly67.sound`, `exactly67.haptics` (`'on'`/`'off'`). |
| `progressStore.ts` | In-memory cache of `Progress` so scenes read synchronously; write-through on every clear. |

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

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — deeper engineering reference: layer diagram, the pure-logic core, render/scene flow, services & persistence, native iOS, and an end-to-end "playing a level" walkthrough.
- [`docs/LEVEL_DESIGN.md`](docs/LEVEL_DESIGN.md) — how to author and tune levels: the `LevelDef` schema, constraints, solver & star economy, the build gate, and annotated example levels.
- `README.md` — project overview + command summary.
- `src/game/levels/pack1.ts` … `pack3.ts` — annotated level data and difficulty ramp.
- `store/` — App Store release collateral: `STORE_LISTING.md`, `PRIVACY_POLICY.md`, `SUBMISSION.md` (runbook), `icon-1024.png`, `screenshots/`.
- `ios/App/fastlane/` — `Fastfile` (8 lanes), `Appfile`, `Deliverfile`, `metadata/`, `screenshots/`.
- `docs/` also hosts the GitHub Pages support/privacy site (`index.html`, `privacy.html`) — the privacy URL the store listing points to.