import { evaluate, initialPlacement, place } from './rules'
import { allSolutions } from './solver'
import type { LevelDef } from './types'

/**
 * The presentation shuffle: the tray order a player actually sees.
 *
 * Authors write a tray in whatever order the arithmetic came to them, and that
 * is usually the answer first — `[30, 37, 35]` is "30 + 37" with a decoy tacked
 * on. Played as written, 20 of the 24 Warm-Up levels were cleared by tapping
 * the first few weights left to right, which reads as the game solving itself.
 *
 * So the tray is de-ordered at the one place levels are handed out
 * (`levelByGlobal`), not in the data: the packs stay exactly as authored and
 * validated, and this module only permutes positions. Same weights, same
 * locked pieces (their indices remapped), same budget, `useAll` and hint, so the
 * solver's minimum, the stars and the solution count are unchanged.
 *
 * Deterministic on purpose: the permutation comes from a PRNG seeded by the
 * global level number, so every device and every session shows the same tray.
 * That is what keeps "way 2 of 4" and a shared win meaning the same thing for
 * two players, and a video capture re-rendering identically.
 */

/** How many seeded permutations to try before settling for the least bad one. */
export const TRAY_TRIES = 500

/** What reads as "laid out in order" in a tray. All zero = the tray passes. */
export interface TrayViolations {
  /** Tapping the free weights left to right wins before the last one. */
  prefix: number
  /** Tapping them right to left does. */
  suffix: number
  /** Fewest-piece solutions sitting side by side (two or more free pieces in a row). */
  run: number
}

/**
 * Levels no order can fix, so the shuffle leaves them alone: with two free
 * weights or fewer every order is some prefix or suffix, and a `useAll` level's
 * only answer is the whole tray.
 */
export function trayExempt(def: LevelDef): boolean {
  const free = def.weights.length - (def.locked ?? []).length
  return def.useAll === true || free <= 2
}

/** Sum of a violation report — the shuffle's cost function. */
export function violationCount(v: TrayViolations): number {
  return v.prefix + v.suffix + v.run
}

/** The fewest-piece winning builds, as index sets into `def.weights`. */
function minimalSets(def: LevelDef): number[][] {
  // allSolutions is sorted by piece count, so the minimal ones lead.
  const all = allSolutions(def)
  return all.filter((s) => s.length === all[0].length)
}

/** Free (non-locked) indices in tray order. */
function freeIndices(def: LevelDef): number[] {
  const locked = new Set(def.locked ?? [])
  return def.weights.map((_, i) => i).filter((i) => !locked.has(i))
}

/**
 * Tap `order` one piece at a time through the real rules and count the taps
 * that win. The final tap puts the whole tray aboard, which is the same set in
 * every order, so it is not the tray's fault and is not counted. A refused tap
 * (the budget is full) ends the run: every later tap would be refused too.
 */
function tapWins(def: LevelDef, order: number[]): number {
  let placed = initialPlacement(def)
  let wins = 0
  for (let k = 0; k < order.length - 1; k++) {
    const next = place(def, placed, order[k])
    if (next === placed) break
    placed = next
    if (evaluate(def, placed).won) wins++
  }
  return wins
}

/** Violations of `def` given its minimal solutions in `def`'s own indexing. */
function check(def: LevelDef, minimal: number[][]): TrayViolations {
  const free = freeIndices(def)
  const pos = new Map(free.map((i, p) => [i, p]))
  let run = 0
  for (const set of minimal) {
    const at = set.filter((i) => pos.has(i)).map((i) => pos.get(i)!)
    // One free piece is not an ordering, and neither is the whole tray (it is
    // the same set in every order); two or more side by side short of that is.
    const inRow = Math.max(...at) - Math.min(...at) === at.length - 1
    if (at.length >= 2 && at.length < free.length && inRow) run++
  }
  return {
    prefix: tapWins(def, free),
    suffix: tapWins(def, free.slice().reverse()),
    run,
  }
}

/** How `def`'s tray reads as ordered, as a player would tap it. */
export function trayViolations(def: LevelDef): TrayViolations {
  return check(def, minimalSets(def))
}

/**
 * mulberry32, the core `daily.ts` uses: integer ops and one exact division, so
 * every JS engine produces the same stream from the same seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `def` with its tray rearranged: position `p` shows the old `from[p]`. */
function permute(def: LevelDef, from: number[]): LevelDef {
  const out: LevelDef = { ...def, weights: from.map((i) => def.weights[i]) }
  if (def.locked) {
    const to = new Map(from.map((old, p) => [old, p]))
    out.locked = def.locked.map((i) => to.get(i)!).sort((a, b) => a - b)
  }
  return out
}

/**
 * The tray a player sees for `def`, seeded by its global level number. A tray
 * that already passes is returned as is (the same object); otherwise the first
 * seeded permutation that passes, or, when none of `TRAY_TRIES` does, the one
 * with the fewest violations (ties keep the earlier, so the authored order wins
 * a tie). Exempt levels (`trayExempt`) are never touched.
 */
export function presentTray(def: LevelDef, seed: number): LevelDef {
  if (trayExempt(def)) return def
  // Solutions are sets of pieces, so they survive a permutation: find them once
  // on the authored tray and carry the indices across instead of re-solving.
  const minimal = minimalSets(def)
  let best = def
  let bestCost = violationCount(check(def, minimal))
  const random = mulberry32(seed)
  const n = def.weights.length
  for (let t = 1; t < TRAY_TRIES && bestCost > 0; t++) {
    const from = def.weights.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[from[i], from[j]] = [from[j], from[i]]
    }
    const candidate = permute(def, from)
    const to = new Map(from.map((old, p) => [old, p]))
    const cost = violationCount(check(candidate, minimal.map((s) => s.map((i) => to.get(i)!))))
    if (cost < bestCost) {
      best = candidate
      bestCost = cost
    }
  }
  return best
}
