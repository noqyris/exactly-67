import { describe, expect, it } from 'vitest'
import { starsForClear } from './stars'
import { solveLevel, validatePacks } from './solver'
import type { LevelDef, LevelPack } from './types'

describe('solveLevel', () => {
  it('solves a single exact weight', () => {
    expect(solveLevel({ weights: [67] })).toEqual({ solvable: true, minWeights: 1 })
  })

  it('finds the minimum count, not just any solution', () => {
    // 67 = 20+47 (2 weights) and 10+20+30+7 (4 weights); minimum is 2.
    const level: LevelDef = { weights: [20, 47, 10, 30, 7] }
    expect(solveLevel(level)).toEqual({ solvable: true, minWeights: 2 })
  })

  it('uses balloons to come back down from an overshoot', () => {
    expect(solveLevel({ weights: [72, -5] })).toEqual({ solvable: true, minWeights: 2 })
    // No positive subset hits 67 without the balloon.
    expect(solveLevel({ weights: [72] })).toEqual({ solvable: false, minWeights: null })
  })

  it('reports unsolvable sets', () => {
    expect(solveLevel({ weights: [2, 4, 8, 16] })).toEqual({ solvable: false, minWeights: null })
  })

  it('locked weights are part of every solution', () => {
    // Without the lock, 67 alone would be minimal (1). Locked 30 forces 30+37.
    const level: LevelDef = { weights: [30, 67, 37], locked: [0] }
    expect(solveLevel(level)).toEqual({ solvable: true, minWeights: 2 })
  })

  it('a lock can make an otherwise solvable set unsolvable', () => {
    const level: LevelDef = { weights: [67, 1], locked: [1] }
    expect(solveLevel(level)).toEqual({ solvable: false, minWeights: null })
  })

  it('honors the piece budget', () => {
    // Only 3-weight solutions exist (22+22+23); budget of 2 kills them.
    const level: LevelDef = { weights: [22, 22, 23], maxWeights: 2 }
    expect(solveLevel(level)).toEqual({ solvable: false, minWeights: null })
    expect(solveLevel({ ...level, maxWeights: 3 })).toEqual({ solvable: true, minWeights: 3 })
  })

  it('useAll requires the full set to sum to 67', () => {
    expect(solveLevel({ weights: [60, 7, 8, -8], useAll: true })).toEqual({
      solvable: true,
      minWeights: 4,
    })
    expect(solveLevel({ weights: [60, 7, 8], useAll: true })).toEqual({
      solvable: false,
      minWeights: null,
    })
  })

  it('rejects oversized levels loudly', () => {
    expect(() => solveLevel({ weights: new Array(17).fill(1) })).toThrow()
  })
})

describe('validatePacks', () => {
  const pack = (levels: LevelDef[]): LevelPack => ({
    id: 'test',
    name: 'Test',
    tagline: '',
    levels,
  })

  it('accepts a well-formed solvable pack', () => {
    expect(validatePacks([pack([{ weights: [67] }, { weights: [72, -5] }])])).toEqual([])
  })

  it('flags unsolvable levels', () => {
    const problems = validatePacks([pack([{ weights: [1, 2, 3] }])])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no exact-67 solution')
  })

  it('flags structural problems', () => {
    const problems = validatePacks([
      pack([
        { weights: [] },
        { weights: [67, 0] },
        { weights: [67], locked: [5] },
        { weights: [30, 37], locked: [0, 0] },
        { weights: [30, 37], useAll: true, maxWeights: 1 },
      ]),
    ])
    expect(problems.some((p) => p.includes('no weights'))).toBe(true)
    expect(problems.some((p) => p.includes('non-zero integers'))).toBe(true)
    expect(problems.some((p) => p.includes('out of range'))).toBe(true)
    expect(problems.some((p) => p.includes('duplicate locked'))).toBe(true)
    expect(problems.some((p) => p.includes('useAll conflicts'))).toBe(true)
  })
})

describe('starsForClear', () => {
  it('gives 3 stars for the minimum, sliding down from there', () => {
    expect(starsForClear(2, 2)).toBe(3)
    expect(starsForClear(3, 2)).toBe(2)
    expect(starsForClear(4, 2)).toBe(2)
    expect(starsForClear(5, 2)).toBe(1)
  })
})
