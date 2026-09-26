import { describe, expect, it } from 'vitest'
import { dailyLevelFor, todayKey } from './daily'
import { countSolutions, solveLevel } from './solver'

/** Enumerate a year of date keys to exercise the generator broadly. */
function* dateKeys(): Generator<string> {
  const start = Date.UTC(2026, 0, 1)
  for (let d = 0; d < 400; d++) {
    yield new Date(start + d * 86400000).toISOString().slice(0, 10)
  }
}

describe('daily challenge', () => {
  it('todayKey is the LOCAL calendar day, not the UTC one', () => {
    // Local constructors: whatever zone the suite runs in, 23:30 and 00:05 on
    // these dates are those dates on the player's own clock.
    expect(todayKey(new Date(2026, 7, 12, 23, 30))).toBe('2026-08-12')
    expect(todayKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('is deterministic — same date yields the same board', () => {
    for (const key of ['2026-08-12', '2027-02-28', '2026-12-31']) {
      expect(dailyLevelFor(key).weights).toEqual(dailyLevelFor(key).weights)
    }
  })

  it('every day is a valid, real subset puzzle', () => {
    for (const key of dateKeys()) {
      const level = dailyLevelFor(key)
      const n = level.weights.length
      // structural
      expect(n).toBeGreaterThanOrEqual(4)
      expect(n).toBeLessThanOrEqual(8)
      for (const w of level.weights) {
        expect(w).not.toBe(0)
        expect(Math.abs(w)).toBeLessThanOrEqual(99)
      }
      expect(level.weights.some((w) => w < 0), `${key} needs a balloon`).toBe(true)
      // solvable + a genuine choice + crisp
      const { solvable, minWeights } = solveLevel(level)
      expect(solvable, `${key} must be solvable`).toBe(true)
      expect(minWeights!).toBeGreaterThanOrEqual(3)
      expect(minWeights!, `${key} must have decoys`).toBeLessThan(n)
      const ways = countSolutions(level)
      expect(ways).toBeGreaterThanOrEqual(1)
      expect(ways, `${key} should be crisp`).toBeLessThanOrEqual(3)
    }
  })

  it('varies day to day (not the same board repeated)', () => {
    const boards = ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'].map((k) =>
      dailyLevelFor(k).weights.join(','),
    )
    expect(new Set(boards).size).toBeGreaterThan(1)
  })
})
