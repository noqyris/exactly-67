# Module reference — `src/game` (pure logic)

Per-file, per-export API reference for the framework-free rules core. Deeper than
[`ARCHITECTURE.md` §2](../ARCHITECTURE.md) — this lists **every export with its
signature, behavior, and gotchas**. Anchors are `file:line`.

> **The layer rule:** `src/game` imports **nothing** from `render`/`services`, no
> Phaser, no DOM. Its only edges are internal (`types ← balance ← rules`, `types
> ← solver`, `levels/* ← types`); `stars.ts` and `progress.ts` import nothing.
> This is what keeps the core unit-testable in a plain Node/Vitest environment.

---

## `types.ts` — contracts + the one constant

| Export | Signature / shape | Notes |
|---|---|---|
| `TARGET` | `const TARGET = 67` (`:2`) | The fixed left-pan value. The whole game is "make the right pan equal this". |
| `LevelDef` | `{ weights: number[]; locked?: number[]; maxWeights?: number; useAll?: boolean; hint?: string }` (`:9`) | Only `weights` is required (signed non-zero ints, tray order). The rest are optional constraints. |
| `LevelPack` | `{ id: string; name: string; tagline: string; levels: LevelDef[] }` (`:22`) | `tagline` is the one-line flavor on the level map. |
| `Evaluation` | `{ total: number; gap: number; balanced: boolean; won: boolean; blockedReason?: 'use-all' }` (`:31`) | The runtime output the HUD + beam consume after every pan change. `blockedReason` has exactly one possible value. |

- `weights[i] > 0` = **down-weight** (candy block), `weights[i] < 0` = **balloon**
  (lift). The right-pan total is just the signed sum of placed values.
- `locked` indices start on the pan and can never be removed; they still count
  toward `maxWeights` and toward the "used" count for stars.

---

## `balance.ts` — stateless math over a total

No level or placement knowledge — pure functions of a number.

| Export | Signature | Behavior |
|---|---|---|
| `MAX_BEAM_ANGLE_DEG` | `const = 13` (`:4`) | Max visual tilt in degrees (right side down = positive). |
| `panTotal` | `(values: readonly number[]) => number` (`:13`) | Signed sum; empty → `0`. |
| `gapToTarget` | `(total: number) => number` (`:17`) | `total - 67`. |
| `isBalanced` | `(total: number) => boolean` (`:21`) | Strict `total === 67`. Weights are non-zero integers, so equality is **exact** — no float tolerance. |
| `beamAngleDeg` | `(total: number) => number` (`:29`) | `13 * tanh((total-67)/18)`. |

**`beamAngleDeg` gotchas:** it takes the **total, not the gap** (computes the gap
internally). It is `0` at 67, antisymmetric about 67, monotonic, and **saturates**
at ±13° instead of flipping — a gap of 1 tilts ~1°, a gap of 100 reads as max tilt,
not a spin. `ANGLE_SOFTNESS = 18` (`:11`) is a **private** module constant.

---

## `rules.ts` — the placement state machine

State is `Placement = boolean[]` (`:6`), parallel-indexed to `LevelDef.weights`;
`placed[i] === true` means `weights[i]` is on the right pan.

| Export | Signature | Behavior |
|---|---|---|
| `Placement` | `type = boolean[]` (`:6`) | — |
| `initialPlacement` | `(level) => Placement` (`:8`) | All-false, then every `locked` index flipped true. |
| `isLocked` | `(level, index) => boolean` (`:14`) | `locked.includes(index)`. |
| `placedCount` | `(placed) => number` (`:18`) | Counts **locked pieces too**. |
| `placedValues` | `(level, placed) => number[]` (`:22`) | Values currently on the pan. |
| `rightTotal` | `(level, placed) => number` (`:26`) | `panTotal(placedValues(...))`. |
| `PlaceRefusal` | `type = 'already-placed' \| 'budget-full'` (`:30`) | — |
| `canPlace` | `(level, placed, index) => { ok: boolean; reason?: PlaceRefusal }` (`:33`) | Refuses `already-placed`, or `budget-full` when `maxWeights` set and `placedCount >= maxWeights`. **Budget counts locked pieces.** Does **not** bounds-check `index`. |
| `canRemove` | `(level, placed, index) => boolean` (`:46`) | True only if placed **and not locked**. |
| `place` | `(level, placed, index) => Placement` (`:50`) | See immutability contract below. |
| `remove` | `(level, placed, index) => Placement` (`:57`) | See immutability contract below. |
| `evaluate` | `(level, placed) => Evaluation` (`:70`) | **The single source of truth.** |

**Immutability contract (load-bearing):** `place`/`remove` return a **new** array
on success and the **same array reference** when the guard fails. Callers may use
reference-equality to detect no-ops, but must never assume a fresh array is always
returned.

**`evaluate()`** is the one function every consumer calls after any change:

```
total    = rightTotal(level, placed)
balanced = isBalanced(total)                       // total === 67
allPlaced = placed.every(Boolean)
won      = balanced && !(useAll === true && !allPlaced)
blockedReason = (balanced && useAll && !allPlaced) ? 'use-all' : undefined
```

The beam angle, HUD chip color, gap message, and win trigger all derive from this
one `Evaluation`, so nothing can disagree about whether a level is cleared.

**The `useAll` "balanced but not won" subtlety:** a `useAll` level can read
`balanced: true` at 67 yet `won: false` — the remaining tray pieces net to zero
(via balloons) but must still come aboard. Example `[59,47,31,-29,-41,3,-3]`,
`useAll`: placing `59+47+31-29-41 = 67` leaves `3` and `-3` (net 0) → `balanced`,
`blockedReason: 'use-all'`, `won: false`. This is the **only** `blockedReason`.

---

## `solver.ts` — brute-force subset solver + build gate

Offline analysis, not a runtime hot path.

| Export | Signature | Behavior |
|---|---|---|
| `MAX_LEVEL_WEIGHTS` | `const = 16` (`:5`) | Hard ceiling; brute force stays instant at 2¹⁶ subsets. |
| `SolveResult` | `{ solvable: boolean; minWeights: number \| null }` (`:7`) | — |
| `solveLevel` | `(level) => SolveResult` (`:67`) | Minimum piece count summing to 67 under the level's constraints, or `null`. |
| `minimalSolution` | `(level) => number[] \| null` (`:78`) | Indices of one minimal exact-67 subset (locked included). **Powers the rewarded hint.** |
| `validatePacks` | `(packs) => string[]` (`:94`) | The **build gate**: list of problems, `[]` = all good. |

- The internal `search()` (`:34`) enumerates `mask = 0..(1<<n)-1`, keeping a mask
  only if it contains **all locked bits**, equals `full` when `useAll`, and has
  `popcount <= maxWeights`. It records the minimum popcount whose signed sum is
  67. **Throws** if `weights.length > 16` (`:36`).
- Prune `if (best !== null && count >= best) continue` (`:52`) skips any subset no
  smaller than the current best before summing — that's why a linear `0..full`
  scan yields the true minimum.
- `validatePacks` checks: no weights, too many weights (>16), non-zero-integer
  weights, locked index in range / no duplicates, `maxWeights >= max(1,
  locked.length)`, `useAll` vs `maxWeights < n` conflict, and solvability. It does
  **not** enforce `|value| <= 99` or the 12-weight shipping cap — those are
  asserted separately in `levels.test.ts`.

---

## `stars.ts` — efficiency rating

| Export | Signature | Behavior |
|---|---|---|
| `starsForClear` | `(used: number, minWeights: number) => 1 \| 2 \| 3` (`:6`) | `used <= min → 3`, `used <= min+2 → 2`, else `1`. |

`used` = weights on the pan at clear (locked included). Since `min` is the true
minimum, `used` can never be below it in normal play, so `<=` is effectively `==`
for 3 stars. **Never returns 0** — "0 stars" means "not cleared", which lives only
in `Progress`.

---

## `progress.ts` — persisted model (pure)

Reading/writing the store lives in `services/storage.ts`; this is the pure merge
logic, keyed by the **string** of the 1-based global level number.

| Export | Signature | Behavior |
|---|---|---|
| `Progress` | `{ stars: Record<string, number>; best: Record<string, number> }` (`:6`) | — |
| `emptyProgress` | `() => Progress` (`:13`) | `{ stars: {}, best: {} }`. |
| `mergeClear` | `(progress, globalLevel, stars, weightsUsed) => Progress` (`:18`) | Immutable + monotonic: `stars = max(prev, stars)`, `best = min(prev, weightsUsed)`. Never regresses. |
| `starsFor` | `(progress, globalLevel) => number` (`:36`) | `0` if uncleared. |
| `bestFor` | `(progress, globalLevel) => number \| undefined` (`:40`) | — |
| `isCleared` | `(progress, globalLevel) => boolean` (`:44`) | Defined purely as `starsFor > 0`. |
| `isUnlocked` | `(progress, globalLevel) => boolean` (`:52`) | Level 1 always open; else open if cleared or the **immediately previous** level is cleared. Only looks one step back. |
| `totalStars` | `(progress) => number` (`:60`) | Sum of all star values. |
| `parseProgress` | `(raw: string \| null \| undefined) => Progress` (`:65`) | Defensive parse (see below). |

**`parseProgress` (the single defensive boundary over persisted data):**
null/empty/bad-JSON/non-object → `emptyProgress()`. It keeps only entries whose key
matches `/^\d+$/` **and** whose value is a real number (`typeof v === 'number'`),
integer, and in range (stars 1–3, best 1–99). Everything else — booleans, arrays,
numeric strings, out-of-range — is silently dropped rather than throwing.

> The `typeof v === 'number'` guard (`:73`) was added after an audit found that
> `Number()` coercion would smuggle `true → 1`, `[3] → 3`, `"3" → 3` past the range
> check, injecting unearned clears from a tampered/corrupt save. See
> [`TESTING.md` — audit finding #3](../TESTING.md#the-5-confirmed-bugs-all-fixed).

---

## `levels/` — content + global numbering

| File | Content |
|---|---|
| `pack1.ts` / `pack2.ts` / `pack3.ts` | Three `LevelPack`s of 24 levels each: `pack-1` "Warm-Up", `pack-2` "Prime Time", `pack-3` "Heavy Lifting". |
| `index.ts` | Aggregation + global-number resolution. |

**`index.ts` exports:**

| Export | Signature | Behavior |
|---|---|---|
| `PACKS` | `readonly LevelPack[]` | `[pack1, …, pack25]` (packs 1–3 hand-authored, 4–25 generated). Pack order defines global numbering (1–24 / 25–48 / … / 577–600). Append only — never reorder or resize. |
| `TOTAL_LEVELS` | `number` | `PACKS.reduce(...)` = 600. **Derived**, not hard-coded. |
| `LevelRef` | `{ def; pack; packIndex; levelIndex; global }` (`:10`) | `levelIndex` is 0-based in the pack; `global` is the 1-based player-facing number. |
| `levelByGlobal` | `(global: number) => LevelRef \| null` (`:21`) | Walks packs accumulating an offset. Global 0 → `null` (levelIndex < 0); global > 600 → `null`. |
| `globalOf` | `(packIndex: number, levelIndex: number) => number` (`:35`) | Inverse: sum of prior pack lengths + `levelIndex + 1`. |

**Global numbering** is **not** stored on levels — it is derived from pack order
and lengths, so inserting/reordering a level automatically re-numbers everything.

### Mechanic debut beats (Pack 1, behind a `hint`)

| Global | Mechanic |
|---|---|
| 1 | Drag/tap to place |
| 6 | Balloons (first negative weight) — also the first `locked` use |
| 11 | `useAll` (every weight must be aboard) |
| 14 | `maxWeights` piece budget |
| 18 | Featured `locked` build-around tutorial |

Pack 3 stacks these constraints with no hints. See
[`LEVEL_DESIGN.md`](../LEVEL_DESIGN.md) to author or tune levels.

---

## Testing this layer

The whole `game/` layer is exercised by the Vitest suite (`*.test.ts` alongside
the sources) — **53 tests** covering balance math, the placement state machine,
`evaluate`/`useAll`, the solver + `validatePacks`, star boundaries, and progress
merge/unlock/parse. `validatePacks(PACKS)` returning `[]` is the hard **build
gate** (`npm run build` runs the suite before `vite build`). See
[`TESTING.md`](../TESTING.md).
