# Level Design Guide — Exactly 67

A practical guide for adding and tuning puzzles. Every level in the game is a small piece of hand-authored data validated at build time. This document explains the data shape, the design vocabulary, how the solver scores your work, the safety net that stops you shipping a broken level, and a copy-paste recipe for adding one.

The whole game is one number: the left pan is a fixed `TARGET = 67` (`src/game/types.ts:2`). A level is a tray of signed weights; the player drops a subset onto the right pan and wins when the placed values sum to exactly 67 (and every constraint is satisfied).

---

## 1. The `LevelDef` schema

A level is one `LevelDef` object. Only `weights` is required; the rest are optional constraints that shape the puzzle.

```ts
// src/game/types.ts:9
export interface LevelDef {
  /** Signed weight values. Order is the tray order. */
  weights: number[]
  /** Indices of weights that start on the pan and cannot be removed. */
  locked?: number[]
  /** Piece budget: at most this many weights on the pan (locked included). */
  maxWeights?: number
  /** Every weight must be on the pan to clear the level. */
  useAll?: boolean
  /** Short onboarding line shown above the tray. */
  hint?: string
}
```

| Field | Type | Required | Rules & meaning |
|---|---|---|---|
| `weights` | `number[]` | **yes** | Signed tray values in display order. **Positive = down-weight** (adds), **negative = balloon / lift** (subtracts). Every value must be a **non-zero integer** (`0` and non-integers are rejected by the validator). Ship 1–12 per level; the solver hard-caps at 16. `\|value\|` must be ≤ 99. |
| `locked` | `number[]` | no | Indices into `weights` that **start on the pan and cannot be removed**. `initialPlacement` flips these to placed at level start (`src/game/rules.ts:8`). Each index must be in range and unique. A locked weight may itself be a balloon (e.g. a locked `-20`). |
| `maxWeights` | `number` | no | **Piece budget** — at most this many weights may sit on the pan at once. **Locked pieces count against it.** The place guard refuses once `placedCount >= maxWeights` (`src/game/rules.ts:33`). Must be ≥ `max(1, locked.length)`. |
| `useAll` | `boolean` | no | When `true`, **every** weight must be on the pan to clear. A pan can read balanced (total 67) yet not win because the remaining weights net to zero via balloons; `evaluate` reports `blockedReason: 'use-all'` in that state (`src/game/rules.ts:70`). Cannot be combined with a `maxWeights` smaller than the tray size. |
| `hint` | `string` | no | One onboarding line rendered above the tray. Use it only where a mechanic *debuts* — the shipped packs keep hints rare. |

Notes:

- **Order matters for the player, not the math.** `weights` order is the tray layout; the sum is order-independent, but `locked` / dev-shortcut indices are positional, so don't reorder a tray without re-checking them.
- **Balance is strict equality.** A pan balances only at exactly 67 (`isBalanced`, `src/game/balance.ts:21`). Because weights are integers there is no tolerance band — 66 and 68 are both losses.
- The runtime `Evaluation` shape (`total` / `gap` / `balanced` / `won` / `blockedReason`) is what the beam and HUD consume after each change (`src/game/types.ts:31`). You author `LevelDef`; the engine produces `Evaluation`.

---

## 2. `LevelPack` schema, `PACKS`, and global numbering

Levels are grouped into named packs:

```ts
// src/game/types.ts:22
export interface LevelPack {
  id: string
  name: string
  /** One-line flavor shown on the level map. */
  tagline: string
  levels: LevelDef[]
}
```

### Where packs live

Each pack is one file that exports a `LevelPack`:

- `src/game/levels/pack1.ts` — `pack1`, **Warm-Up** (`src/game/levels/pack1.ts:3`)
- `src/game/levels/pack2.ts` — `pack2`, **Prime Time** (`src/game/levels/pack2.ts:12`)
- `src/game/levels/pack3.ts` — `pack3`, **Heavy Lifting** (`src/game/levels/pack3.ts:14`)

### How they compose

`src/game/levels/index.ts` aggregates the three packs and derives everything else:

```ts
// src/game/levels/index.ts:6
export const PACKS: readonly LevelPack[] = [pack1, pack2, pack3]

// src/game/levels/index.ts:8
export const TOTAL_LEVELS = PACKS.reduce((n, p) => n + p.levels.length, 0)  // = 72
```

`TOTAL_LEVELS` is **derived, not hard-coded** — it tracks the data. Today it is 72 (3 packs × 24 levels).

### Global 1-based numbering

Player-facing level numbers are **1-based and global across all packs**, defined purely by pack order and length:

- `pack1` → globals **1–24**
- `pack2` → globals **25–48**
- `pack3` → globals **49–72**

The mapping is computed on the fly, never stored on a level:

```ts
// src/game/levels/index.ts:21
export function levelByGlobal(global: number): LevelRef | null   // walks packs, accumulates an offset
// src/game/levels/index.ts:35
export function globalOf(packIndex: number, levelIndex: number): number  // inverse
```

`levelByGlobal` returns `null` for `global <= 0` and for anything past `TOTAL_LEVELS`. A `LevelRef` carries the resolved `def`, its `pack`, the 0-based `packIndex` / `levelIndex`, and the 1-based `global` (`src/game/levels/index.ts:10`).

> **Numbering is a save-file contract.** Player progress is keyed by the *string of the global level number* (`src/game/progress.ts`). **Inserting or removing a level shifts the global number of every level after it**, which silently re-points existing saved stars/best-counts at different puzzles. Prefer *appending* to a pack's end, or accept that mid-pack edits invalidate saved progress for later levels. `git`-diff the numbering impact before shipping.

---

## 3. Design vocabulary

### Down-weights vs balloons

- **Down-weight** (positive): pulls the right pan *down*, **adds** to the total.
- **Balloon** (negative): pulls the pan *up*, **subtracts** from the total. It is not a separate object type — a balloon is simply a weight whose value is `< 0`.

The right-pan total is just the signed sum of placed values (`panTotal`, `src/game/balance.ts:13`). The beam tilts by a saturating `13 * tanh((total-67)/18)` (`beamAngleDeg`, `src/game/balance.ts:29`): a gap of 1 still visibly tilts, and a gap of 100 reads as "way over" rather than flipping the scale.

### The "overshoot then pull back" move

The signature idea of the game: use a big down-weight (or a locked one) to *overshoot* past 67, then add a balloon to *pull back* to exactly 67. It turns a single fixed piece into a two-move puzzle:

- Global 6: `72 − 5 = 67` (the balloon debut).
- Pack 1 level 8: overshoot to 80, pull back 13 (`src/game/levels/pack1.ts:23`).
- All of Pack 3 leans on this — its down-weights largely run 40–99, so almost any two overshoot and a balloon is nearly always required (`src/game/levels/pack3.ts:3`).

Good tension comes from **near-miss baits**: decoy pieces that land on 65/66/68/69 (the pack authors annotate these in comments — e.g. `src/game/levels/pack1.ts:12`, `:16`).

### When balloons are introduced

Balloons debut at **global level 6** and not before. Levels 1–5 are positive-only; level 6 is `{ weights: [72, -5], locked: [0], hint: 'Balloons pull the pan UP. 72 − 5 = 67.' }`. This beat is **enforced by the test suite** (`src/game/levels.test.ts:30`): levels 1–5 must be all-positive, level 6 must contain a negative weight *and* a truthy hint, and at least 12 of levels 7–24 must feature a balloon. Reordering Pack 1's opening will fail the build.

### How each constraint changes the puzzle

- **`locked`** — pre-places immovable pieces, so the pan **starts wrong** and must be rescued. It removes the choice of *whether* to use those pieces and forces the player to build *around* a fixed contribution (which may be an unhelpful overshoot or a lifting balloon). Locked *pairs* (`[0, 1]`) exist only in Pack 3 and create a large fixed overshoot to undo.
- **`maxWeights`** — a **piece budget** that outlaws the obvious many-piece stack. It converts "find any subset" into "find a *short* subset," usually forcing a bigger single down-weight plus a balloon instead of a tidy pile of small pieces. Because the budget counts locked pieces, `locked + maxWeights` together can leave very few free slots (see global 43 / 64).
- **`useAll`** — every weight must be aboard, so the whole tray must **cancel to exactly 67**. This flips the puzzle from *selection* to *arrangement/verification*: there is only one subset (the full set), and the design work is making that full sum land on 67 with a satisfying mix of downs and balloons.

---

## 4. The solver & star economy

### The solver

`solveLevel` is an exhaustive bitmask subset search that honors the constraints and returns the **minimum number of weights** (locked included) that total exactly 67:

```ts
// src/game/solver.ts:27
export function solveLevel(level: LevelDef): SolveResult  // { solvable, minWeights }
```

It enumerates every subset `mask` in `0 .. 2ⁿ-1`, skipping any that omits a locked bit, isn't the full set when `useAll`, or exceeds `maxWeights`, and records the smallest popcount whose signed sum is 67. The prune `if (best !== null && count >= best) continue` (`src/game/solver.ts:44`) is why the result is the true **minimum**, not the first found. `minWeights` is `null` when unsolvable.

`MAX_LEVEL_WEIGHTS = 16` (`src/game/solver.ts:5`) caps the tray so brute force stays instant — 2¹⁶ = 65,536 subsets is nothing. `solveLevel` **throws** above 16 weights, so never author a tray that large (the shipping cap of 12 in the tests keeps you well clear).

### Star economy

Stars rate *efficiency* — how close the player got to the solver's minimum:

```ts
// src/game/stars.ts:6
export function starsForClear(used: number, minWeights: number): 1 | 2 | 3 {
  if (used <= minWeights) return 3
  if (used <= minWeights + 2) return 2
  return 1
}
```

- **3 stars** at the minimum (`used === minWeights` in normal play, since `used` can't drop below the true minimum).
- **2 stars** within +2 of the minimum.
- **1 star** for anything else that still clears.

**This is the whole difficulty lever for a 3-star.** Because `minWeights` is the optimal, the difficulty of earning three stars is set by *how tight the optimal solution is relative to the decoys*:

- If a **budget forces the piece count** (`maxWeights === minWeights`) or `useAll` fixes it, **every clear is 3 stars** — the constraint does the work.
- If the minimum is small (say 2) but the tray is full of pieces that reach 67 in 4–5 pieces, hitting 3 stars is a genuine search and most players will first land 1–2 stars.

To tune a 3-star, tune the *gap between the intended optimal route and the seductive longer routes*: add near-miss decoys and a slightly-too-long "easy" path.

---

## 5. The build-time safety net

Content correctness is a hard gate, not a convention. `validatePacks` (`src/game/solver.ts:62`) walks every level and returns a list of human-readable problems — empty means all good. It checks:

1. **Non-empty tray** — `has no weights` if `weights.length === 0`.
2. **Size cap** — `too many weights (n)` if `n > 16`.
3. **Non-zero integer weights** — `weights must be non-zero integers` if any value is `0` or non-integer.
4. **Locked indices in range** — `locked index out of range` if any locked index is `< 0`, `>= n`, or non-integer.
5. **Unique locked indices** — `duplicate locked index` if `locked` has repeats.
6. **Budget ≥ locked count** — `maxWeights smaller than the locked weights` if `maxWeights < max(1, locked.length)`.
7. **`useAll` vs budget conflict** — `useAll conflicts with maxWeights < n` if both are set with `maxWeights < n`.
8. **Solvability** — for any legal-size tray it runs `solveLevel`; if unsolvable it pushes `no exact-67 solution`.

`src/game/levels.test.ts` turns any of these into a failing build:

```ts
// src/game/levels.test.ts:11
expect(validatePacks(PACKS)).toEqual([])
```

The suite also asserts **3 packs × 24 = 72 levels** (`:14`), **1–12 weights and `|value| ≤ 99`** per tray (`:20`), the **balloon-onboarding beat at level 6** (`:30`), that **solver minimums are non-null and reachable** (`≤ tray size`, `:43`), and that **global numbering round-trips** (`:53`).

Because `npm run build` is `tsc --noEmit && vitest run && vite build`, a non-empty `validatePacks` result fails `vitest run` and the `&&` chain **aborts before `vite build` ever runs**. You cannot bundle `dist/` with a malformed or unsolvable level.

---

## 6. Recipe — add a level

1. **Pick the pack** by where the difficulty fits, and open its file: `src/game/levels/pack1.ts` (Warm-Up), `pack2.ts` (Prime Time), or `pack3.ts` (Heavy Lifting). **Append to the end** of the pack's `levels` array unless you deliberately want to renumber later levels (see the save-file warning in §2).

2. **Add a `LevelDef`.** Start from the sum you want and work backwards. Example — a Pack 3 style overshoot-then-pull-back:

   ```ts
   // ... previous levels
   // NN — overshoot to 90, pull back 23; 55+12 = 67 is the tidy alternative.
   { weights: [90, 55, -23, 12] },
   ```

   Add constraints only for intent: `locked: [0]` to pin a piece, `maxWeights: 2` to force a short solution, `useAll: true` to make the whole tray cancel, `hint` only if a mechanic is debuting here.

3. **Run the tests** — `npm test` (i.e. `vitest run`). If you introduced a problem, `validatePacks` names it: e.g. `pack-3 level 25: no exact-67 solution`, or `pack-3 level 25: maxWeights smaller than the locked weights`. Fix until the suite is green.

4. **Confirm it is solvable *the way you intend*.** Green tests only prove *a* solution exists. Verify the intended route is the optimal one by checking `solveLevel(level).minWeights` matches your target piece count — the quickest way is a throwaway node/vitest snippet or a `console.log` in a scratch test.

5. **Tune weights so the intended 3-star minimum equals the solver `minWeights`.** If the solver finds a *shorter* route than you meant, your "hard" path isn't optimal — tighten the tray (remove or resize a decoy) until `minWeights` is your intended count. If you want *every* clear to be 3 stars, set `maxWeights === minWeights` (or use `useAll`). Re-run `npm test` after any change.

6. **Sanity-check numbering & save impact.** If you appended, `TOTAL_LEVELS` and the level-map grid update automatically. If you inserted mid-pack, remember every later level's global number shifted.

---

## 7. Annotated examples (verbatim from the packs)

All four snippets are copied exactly from the source; the `minWeights` figures are the real solver outputs.

### The balloon debut — global 6, `src/game/levels/pack1.ts:19`

```ts
{ weights: [72, -5], locked: [0], hint: 'Balloons pull the pan UP. 72 − 5 = 67.' }
```

- `locked: [0]` pins the `72` on the pan, so the beam *starts overshot* — the level opens in a losing state.
- The only rescue is the `-5` balloon: `72 − 5 = 67`. This teaches the core overshoot-then-pull-back move behind a hint.
- Solver `minWeights = 2`, and there are only two weights, so `used` is always 2 → **every clear is 3 stars**. A pure teaching level.

### The piece-budget debut — global 29 (Pack 2 level 5), `src/game/levels/pack2.ts:30`

```ts
{
  weights: [3, 5, 7, 13, 17, 19, 29, 31],
  maxWeights: 3,
  hint: 'Piece budget: only 3 weights fit on the pan.',
}
```

- The greedy small-prime stack (e.g. `3+5+13+17+29`, five pieces) hits 67 but is **outlawed by `maxWeights: 3`**.
- The budget forces a *short* route: `17+19+31 = 67` or `7+29+31 = 67`.
- Solver `minWeights = 3`, equal to the budget → the constraint pins the piece count, so **every clear is 3 stars**. The puzzle is entirely "find the short subset."

### `useAll` cancellation in the endgame — global 52 (Pack 3 level 4), `src/game/levels/pack3.ts:26`

```ts
{ weights: [95, 60, -44, -30, -14], useAll: true }
```

- `useAll` means all five weights must be aboard: `95 + 60 − 44 − 30 − 14 = 67`. There is no *selection* — the design work is making the whole tray cancel to 67 with two big downs and three balloons.
- Until the last piece is placed the pan can read balanced-but-not-won (`evaluate` sets `blockedReason: 'use-all'`, `src/game/rules.ts:70`).
- Solver `minWeights = 5` (the full set), so `used` is always 5 → **always 3 stars**. Difficulty here is the *arrangement*, not the efficiency.

### For reference — the finale, global 72, `src/game/levels/pack3.ts:66`

```ts
{ weights: [95, 86, 16, 9, -44, -40, -29, -28, -25, -19, -16, -12], locked: [0, 1] }
```

A 12-weight tray with `95` and `86` both locked (a 181 overshoot to undo), solver `minWeights = 6` — the hardest kind of level in the game: a locked pair, a huge deck of balloons, dozens of near-misses, and a single six-piece path through. This is the ceiling to design *toward*, not past: it sits right at the shipping limits (12 weights, `|value| ≤ 99`).
