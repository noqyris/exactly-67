import type { LevelDef, LevelPack } from './types'
import { TARGET } from './types'

/** Brute force stays instant up to here (2^16 subsets); levels must fit. */
export const MAX_LEVEL_WEIGHTS = 16

export interface SolveResult {
  solvable: boolean
  /** Fewest weights on the pan (locked included) that total exactly 67. */
  minWeights: number | null
}

function popcount(mask: number): number {
  let n = 0
  while (mask) {
    mask &= mask - 1
    n++
  }
  return n
}

/**
 * Exhaustive subset search over the signed weights, honoring the level's
 * constraints: locked weights are in every candidate subset, `useAll`
 * forces the full set, `maxWeights` caps the subset size.
 */
interface Search {
  /** Fewest weights that total 67, or null if unsolvable. */
  best: number | null
  /** Bitmask of that minimal subset (0 when unsolvable). */
  bestMask: number
}

function search(level: LevelDef): Search {
  const n = level.weights.length
  if (n > MAX_LEVEL_WEIGHTS) {
    throw new Error(`Level has ${n} weights; solver supports at most ${MAX_LEVEL_WEIGHTS}`)
  }

  let lockedMask = 0
  for (const i of level.locked ?? []) lockedMask |= 1 << i

  const full = (1 << n) - 1
  let best: number | null = null
  let bestMask = 0

  for (let mask = 0; mask <= full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    if (level.useAll && mask !== full) continue
    const count = popcount(mask)
    if (level.maxWeights !== undefined && count > level.maxWeights) continue
    if (best !== null && count >= best) continue

    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += level.weights[i]
    }
    if (sum === TARGET) {
      best = count
      bestMask = mask
    }
  }

  return { best, bestMask }
}

export function solveLevel(level: LevelDef): SolveResult {
  const { best } = search(level)
  return { solvable: best !== null, minWeights: best }
}

/**
 * Indices of one minimal exact-67 subset (locked pieces included), or null if
 * the level has no solution. Powers the rewarded "hint": highlight a weight
 * that belongs to a winning build. Same exhaustive search as `solveLevel`, so
 * it honors `locked` / `useAll` / `maxWeights` and stays instant (≤ 2^16).
 */
export function minimalSolution(level: LevelDef): number[] | null {
  const { best, bestMask } = search(level)
  if (best === null) return null
  const indices: number[] = []
  for (let i = 0; i < level.weights.length; i++) {
    if (bestMask & (1 << i)) indices.push(i)
  }
  return indices
}

/**
 * Static sanity + solvability check for shipped content. Returns a list of
 * human-readable problems; empty means every level is well-formed and has
 * at least one exact-67 solution. Run from tests so a bad level fails the
 * build (`npm run build` runs the test suite).
 */
export function validatePacks(packs: readonly LevelPack[]): string[] {
  const problems: string[] = []

  packs.forEach((pack) => {
    pack.levels.forEach((level, li) => {
      const where = `${pack.id} level ${li + 1}`
      const n = level.weights.length

      if (n === 0) problems.push(`${where}: has no weights`)
      if (n > MAX_LEVEL_WEIGHTS) problems.push(`${where}: too many weights (${n})`)
      if (level.weights.some((w) => w === 0 || !Number.isInteger(w))) {
        problems.push(`${where}: weights must be non-zero integers`)
      }

      const locked = level.locked ?? []
      if (locked.some((i) => i < 0 || i >= n || !Number.isInteger(i))) {
        problems.push(`${where}: locked index out of range`)
      }
      if (new Set(locked).size !== locked.length) {
        problems.push(`${where}: duplicate locked index`)
      }
      if (level.maxWeights !== undefined) {
        if (level.maxWeights < Math.max(1, locked.length)) {
          problems.push(`${where}: maxWeights smaller than the locked weights`)
        }
        if (level.useAll && level.maxWeights < n) {
          problems.push(`${where}: useAll conflicts with maxWeights < ${n}`)
        }
      }

      if (n > 0 && n <= MAX_LEVEL_WEIGHTS) {
        const result = solveLevel(level)
        if (!result.solvable) problems.push(`${where}: no exact-67 solution`)
      }
    })
  })

  return problems
}
