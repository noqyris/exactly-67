import type { LevelDef } from './types'
import { countSolutions, solveLevel } from './solver'

/**
 * Daily Challenge — a fresh puzzle every calendar day, the same one for
 * everyone (an "appointment mechanic": research's top retention lever for a
 * logic puzzle). Deterministic from the date, so no server is needed and every
 * device gets an identical board. Pure + framework-free, like the rest of
 * `src/game`, and every generated board is solver-verified before it ships out.
 */

/** UTC calendar day, e.g. "2026-08-12". Callers pass `new Date()` day. */
export function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** A tiny deterministic PRNG (mulberry32) seeded from the date string. */
function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Split `total` into `k` positive integers each within [lo, hi], or null. */
function splitInto(total: number, k: number, rng: () => number, lo: number, hi: number): number[] | null {
  if (total < k * lo || total > k * hi) return null
  const parts: number[] = []
  let left = total
  for (let i = 0; i < k; i++) {
    const remaining = k - i - 1
    const min = Math.max(lo, left - remaining * hi)
    const max = Math.min(hi, left - remaining * lo)
    if (min > max) return null
    const v = i === k - 1 ? left : int(rng, min, max)
    parts.push(v)
    left -= v
  }
  return left === 0 ? parts : null
}

/** Construct one candidate: a guaranteed 67-subset (downs + balloons) plus decoys. */
function candidate(rng: () => number): LevelDef {
  const balloons: number[] = []
  const nB = int(rng, 1, 2)
  let balloonSum = 0
  for (let i = 0; i < nB; i++) {
    const b = -int(rng, 8, 40)
    balloons.push(b)
    balloonSum += b
  }
  const need = 67 - balloonSum // > 67, covered by the positives
  const nP = int(rng, 2, 3)
  const positives = splitInto(need, nP, rng, 10, 90)
  if (!positives) return candidate(rng)

  const weights = [...balloons, ...positives]
  const nDecoy = int(rng, 1, 2)
  for (let i = 0; i < nDecoy; i++) {
    weights.push(rng() < 0.5 ? int(rng, 10, 90) : -int(rng, 5, 40))
  }
  return { weights: shuffle(weights, rng) }
}

/**
 * The daily puzzle for a given date key. Deterministic: same date → same board
 * for every player. Guaranteed solvable, a genuine subset choice (has decoys),
 * and crisp (1–3 winning ways) — the solver vets each candidate.
 */
export function dailyLevelFor(dateKey: string): LevelDef {
  const rng = seededRng(dateKey)
  for (let attempt = 0; attempt < 800; attempt++) {
    const level = candidate(rng)
    if (level.weights.some((w) => Math.abs(w) > 99 || w === 0)) continue
    if (level.weights.length < 4 || level.weights.length > 8) continue
    const { solvable, minWeights } = solveLevel(level)
    if (!solvable || minWeights == null) continue
    if (minWeights < 3) continue // too trivial (1–2 pieces)
    if (minWeights >= level.weights.length) continue // no decoys = no real choice
    const ways = countSolutions(level)
    if (ways < 1 || ways > 3) continue // crisp, not mushy
    return level
  }
  // Deterministic fallback — a known-good subset puzzle (never expected to hit).
  return { weights: [45, 30, -8, 25, 14] }
}
