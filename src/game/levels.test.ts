import { describe, expect, it } from 'vitest'
import { globalOf, levelByGlobal, PACKS, TOTAL_LEVELS } from './levels'
import { countSolutions, solveLevel, validatePacks } from './solver'
import { TARGET } from './types'
import type { LevelDef } from './types'

/**
 * Shipped-content gate: `npm run build` runs this suite, so an unsolvable
 * or malformed level fails the build.
 */

/** Subsets landing within 4 of 67 without hitting it — the near-miss pressure. */
function trapCount(level: LevelDef): number {
  const n = level.weights.length
  let lockedMask = 0
  for (const i of level.locked ?? []) lockedMask |= 1 << i
  let traps = 0
  for (let mask = 0; mask <= (1 << n) - 1; mask++) {
    if ((mask & lockedMask) !== lockedMask || mask === 0) continue
    let count = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += level.weights[i]
        count++
      }
    }
    if (level.maxWeights !== undefined && count > level.maxWeights) continue
    const d = Math.abs(sum - TARGET)
    if (d > 0 && d <= 4) traps++
  }
  return traps
}

/** Mirrors the weighting in tools/generate-levels.ts. */
function difficulty(level: LevelDef): number {
  const { minWeights } = solveLevel(level)
  const ways = countSolutions(level)
  return (
    level.weights.length * 0.8 +
    (minWeights ?? 1) * 2.5 +
    level.weights.filter((w) => w < 0).length * 1.5 +
    Math.min(trapCount(level), 40) * 0.6 +
    (ways === 1 ? 4 : ways === 2 ? 2 : 0) +
    (level.maxWeights !== undefined ? 3 : 0) +
    (level.locked !== undefined ? 2 : 0)
  )
}

describe('shipped level packs', () => {
  it('every level is well-formed and has an exact-67 solution', () => {
    expect(validatePacks(PACKS)).toEqual([])
  })

  it('ships 300 levels across 13 packs', () => {
    expect(PACKS).toHaveLength(13)
    expect(TOTAL_LEVELS).toBe(300)
  })

  /**
   * Progress is persisted keyed by GLOBAL level number, so the first three packs
   * are frozen: resizing or reordering any of them would silently re-point every
   * existing player's stars at different puzzles. New content appends only.
   */
  it('freezes the hand-authored packs at 24 levels each', () => {
    for (const pack of PACKS.slice(0, 3)) expect(pack.levels).toHaveLength(24)
    expect(globalOf(3, 0)).toBe(73)
  })

  it('keeps trays touch-friendly: 1–12 weights, |value| ≤ 99', () => {
    for (const pack of PACKS) {
      for (const level of pack.levels) {
        expect(level.weights.length).toBeGreaterThanOrEqual(1)
        expect(level.weights.length).toBeLessThanOrEqual(12)
        for (const w of level.weights) expect(Math.abs(w)).toBeLessThanOrEqual(99)
      }
    }
  })

  it('holds balloons back until level 6, then features them', () => {
    const first = PACKS[0].levels
    for (let i = 0; i < 5; i++) {
      expect(first[i].weights.every((w) => w > 0), `level ${i + 1} must be positive-only`).toBe(true)
    }
    // The onboarding beat: level 6 introduces the balloon.
    expect(first[5].weights.some((w) => w < 0)).toBe(true)
    expect(first[5].hint).toBeTruthy()
    // From level 7 on, balloons are a regular sight in pack 1.
    const withBalloons = first.slice(6).filter((l) => l.weights.some((w) => w < 0)).length
    expect(withBalloons).toBeGreaterThanOrEqual(12)
  })

  it('solver minimums are reachable within each tray', () => {
    for (const pack of PACKS) {
      for (const level of pack.levels) {
        const { minWeights } = solveLevel(level)
        expect(minWeights).not.toBeNull()
        expect(minWeights!).toBeLessThanOrEqual(level.weights.length)
      }
    }
  })

  /** No pack may be a step down from the one before it — the whole point of 300. */
  it('gets harder pack by pack, all the way through', () => {
    const avg = PACKS.map(
      (p) => p.levels.reduce((n, l) => n + difficulty(l), 0) / p.levels.length,
    )
    for (let i = 1; i < avg.length; i++) {
      expect(
        avg[i],
        `${PACKS[i].name} (${avg[i].toFixed(1)}) must be harder than ${PACKS[i - 1].name} (${avg[i - 1].toFixed(1)})`,
      ).toBeGreaterThan(avg[i - 1])
    }
  })

  /** Every tray is a distinct puzzle — no accidental repeats across 300 levels. */
  it('never ships the same tray twice', () => {
    const seen = new Map<string, string>()
    for (const pack of PACKS) {
      pack.levels.forEach((l, i) => {
        const key =
          l.weights.slice().sort((a, b) => a - b).join(',') +
          `|${l.maxWeights ?? ''}|${(l.locked ?? []).length}`
        const where = `${pack.id} #${i + 1}`
        expect(seen.has(key), `${where} duplicates ${seen.get(key)}`).toBe(false)
        seen.set(key, where)
      })
    }
  })

  /** A level with only one way to win must not also be a lottery to stumble into. */
  it('keeps every level meaningfully searchable (has decoys)', () => {
    for (const pack of PACKS.slice(3)) {
      for (const level of pack.levels) {
        const { minWeights } = solveLevel(level)
        expect(minWeights!, `${pack.id}: solution should not be the whole tray`).toBeLessThan(
          level.weights.length,
        )
      }
    }
  })

  it('global level numbering round-trips', () => {
    expect(levelByGlobal(0)).toBeNull()
    expect(levelByGlobal(TOTAL_LEVELS + 1)).toBeNull()
    for (let g = 1; g <= TOTAL_LEVELS; g++) {
      const ref = levelByGlobal(g)
      expect(ref).not.toBeNull()
      expect(globalOf(ref!.packIndex, ref!.levelIndex)).toBe(g)
    }
    expect(levelByGlobal(1)!.pack).toBe(PACKS[0])
    expect(levelByGlobal(25)!.pack).toBe(PACKS[1])
    expect(levelByGlobal(49)!.pack).toBe(PACKS[2])
    expect(levelByGlobal(73)!.pack).toBe(PACKS[3])
    expect(levelByGlobal(300)!.pack).toBe(PACKS[12])
  })
})
