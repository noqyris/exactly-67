import { describe, expect, it } from 'vitest'
import { globalOf, levelByGlobal, PACKS, TOTAL_LEVELS } from './levels'
import { solveLevel, validatePacks } from './solver'

/**
 * Shipped-content gate: `npm run build` runs this suite, so an unsolvable
 * or malformed level fails the build.
 */
describe('shipped level packs', () => {
  it('every level is well-formed and has an exact-67 solution', () => {
    expect(validatePacks(PACKS)).toEqual([])
  })

  it('ships 3 packs of 24 levels', () => {
    expect(PACKS).toHaveLength(3)
    for (const pack of PACKS) expect(pack.levels).toHaveLength(24)
    expect(TOTAL_LEVELS).toBe(72)
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

  it('global level numbering round-trips', () => {
    expect(levelByGlobal(0)).toBeNull()
    expect(levelByGlobal(73)).toBeNull()
    for (let g = 1; g <= TOTAL_LEVELS; g++) {
      const ref = levelByGlobal(g)
      expect(ref).not.toBeNull()
      expect(globalOf(ref!.packIndex, ref!.levelIndex)).toBe(g)
    }
    expect(levelByGlobal(1)!.pack).toBe(PACKS[0])
    expect(levelByGlobal(25)!.pack).toBe(PACKS[1])
    expect(levelByGlobal(49)!.pack).toBe(PACKS[2])
  })
})
