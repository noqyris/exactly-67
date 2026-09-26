import { describe, expect, it } from 'vitest'
import { levelByGlobal, PACKS } from './levels'
import { evaluate, initialPlacement, place } from './rules'
import { countSolutions, solveLevel } from './solver'
import { presentTray, trayExempt, trayViolations, violationCount } from './tray'
import type { LevelDef } from './types'

/** Every shipped level with its global number, straight from the RAW packs. */
function everyLevel(): { g: number; raw: LevelDef }[] {
  const out: { g: number; raw: LevelDef }[] = []
  for (const pack of PACKS) for (const raw of pack.levels) out.push({ g: out.length + 1, raw })
  return out
}

const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b)
const lockedValues = (def: LevelDef) => sorted((def.locked ?? []).map((i) => def.weights[i]))

describe('trayViolations', () => {
  it('flags a tray won by tapping the first weights left to right', () => {
    // Level 3 as authored: 30 then 37 is the answer.
    expect(trayViolations({ weights: [30, 37, 35] })).toEqual({ prefix: 1, suffix: 0, run: 1 })
  })

  it('flags the mirror image, tapped right to left', () => {
    expect(trayViolations({ weights: [35, 30, 37] })).toEqual({ prefix: 0, suffix: 1, run: 1 })
  })

  it('flags a fewest-piece build sitting side by side mid-tray', () => {
    // 35, 65, 102 and 20, 57, 87 never win, but 30 and 37 are neighbours.
    expect(trayViolations({ weights: [35, 30, 37, 20] })).toEqual({ prefix: 0, suffix: 0, run: 1 })
  })

  it('passes a tray whose answer is split up', () => {
    expect(trayViolations({ weights: [37, 35, 30] })).toEqual({ prefix: 0, suffix: 0, run: 0 })
  })

  it('stops tapping where the budget refuses, as the real rules do', () => {
    // 60 + 5 + 2 would win left to right, but a budget of 2 refuses the third tap.
    expect(trayViolations({ weights: [60, 5, 2, 57, 10] }).prefix).toBe(1)
    expect(trayViolations({ weights: [60, 5, 2, 57, 10], maxWeights: 2 }).prefix).toBe(0)
  })

  it('never blames the tray for an answer that is the whole tray', () => {
    // Every order ends on 67 once everything is aboard; no order can fix that.
    expect(trayViolations({ weights: [30, 20, 17] })).toEqual({ prefix: 0, suffix: 0, run: 0 })
  })

  it('counts from the locked pieces already aboard', () => {
    // Locked 50: tapping 17 first wins at once.
    expect(trayViolations({ weights: [50, 17, 9, 8, 30], locked: [0] }).prefix).toBe(1)
  })
})

describe('presentTray', () => {
  it('returns a passing tray untouched — the same object', () => {
    const def: LevelDef = { weights: [37, 35, 30] }
    expect(presentTray(def, 3)).toBe(def)
  })

  it('never touches exempt levels: two free weights or fewer, or useAll', () => {
    const two: LevelDef = { weights: [40, 27] }
    const locked: LevelDef = { weights: [72, -5, 9], locked: [0, 2] }
    const all: LevelDef = { weights: [40, 30, -3], useAll: true }
    for (const def of [two, locked, all]) {
      expect(trayExempt(def)).toBe(true)
      expect(presentTray(def, 7)).toBe(def)
    }
  })

  it('de-orders a tray and remaps its locked index', () => {
    const def: LevelDef = { weights: [50, 17, 9, 8, 30], locked: [0], maxWeights: 3, hint: 'x' }
    const shown = presentTray(def, 42)
    expect(violationCount(trayViolations(shown))).toBe(0)
    expect(sorted(shown.weights)).toEqual(sorted(def.weights))
    expect(lockedValues(shown)).toEqual([50])
    expect(shown.maxWeights).toBe(3)
    expect(shown.hint).toBe('x')
    // The authored def is left alone.
    expect(def).toEqual({ weights: [50, 17, 9, 8, 30], locked: [0], maxWeights: 3, hint: 'x' })
  })

  it('is deterministic: same level and seed, same tray', () => {
    const def: LevelDef = { weights: [26, 31, 18, -8, 42, 15, 9] }
    expect(presentTray(def, 15)).toEqual(presentTray(def, 15))
  })

  /**
   * Pinned so a change to the search or the PRNG is a decision, not an accident:
   * it re-deals the tray of every de-ordered level for every existing player.
   */
  it('deals the same Warm-Up trays it always has', () => {
    expect(levelByGlobal(3)!.def.weights).toEqual([37, 35, 30])
    expect(levelByGlobal(5)!.def.weights).toEqual([22, 4, 44, 25, 20])
    expect(levelByGlobal(15)!.def.weights).toEqual([42, -8, 26, 9, 15, 18, 31])
    expect(levelByGlobal(18)!.def).toMatchObject({ weights: [29, 52, -20, 33, 18, 35], locked: [2] })
  })
})

describe('the presented shipped levels', () => {
  const levels = everyLevel()

  it('are the same puzzles: same pieces, locks, budget, hint, minimum and ways', () => {
    for (const { g, raw } of levels) {
      const shown = levelByGlobal(g)!.def
      const where = `level ${g}`
      expect(sorted(shown.weights), where).toEqual(sorted(raw.weights))
      expect(lockedValues(shown), `${where} locked`).toEqual(lockedValues(raw))
      expect(shown.maxWeights, where).toBe(raw.maxWeights)
      expect(shown.useAll, where).toBe(raw.useAll)
      expect(shown.hint, where).toBe(raw.hint)
      expect(solveLevel(shown), where).toEqual(solveLevel(raw))
      expect(countSolutions(shown), where).toBe(countSolutions(raw))
    }
  })

  it('are deterministic: levelByGlobal is presentTray seeded by the global number', () => {
    for (const { g, raw } of levels) {
      expect(levelByGlobal(g)!.def, `level ${g}`).toEqual(presentTray(raw, g))
    }
  })

  it('never hand the player the answer in tray order', () => {
    const still: string[] = []
    let fixed = 0
    for (const { g, raw } of levels) {
      const shown = levelByGlobal(g)!.def
      if (violationCount(trayViolations(raw)) > 0 && !trayExempt(raw)) {
        expect(shown, `level ${g} was ordered but not re-dealt`).not.toBe(raw)
        fixed++
      }
      const v = trayViolations(shown)
      if (violationCount(v) > 0) {
        still.push(`L${g}${trayExempt(raw) ? ' (exempt)' : ''} ${JSON.stringify(v)} [${shown.weights}]`)
      }
    }
    // 70 authored trays were answer-first when this landed (20 of Warm-Up's 24).
    expect(fixed).toBeGreaterThan(0)
    // Exempt levels are listed too: the shipped ones (1, 2, 6) pass anyway,
    // because their answer is the whole free tray, which no order can give away.
    expect(still, still.join('\n')).toEqual([])
  })

  it('keep the tutorials exactly as written: level 1 and the balloon debut', () => {
    const one = levelByGlobal(1)!.def
    expect(one).toBe(PACKS[0].levels[0])
    expect(one.weights).toEqual([67])

    // Level 6: 72 locked aboard, the balloon is the only move and it wins.
    const six = levelByGlobal(6)!.def
    expect(six).toBe(PACKS[0].levels[5])
    expect(six).toMatchObject({ weights: [72, -5], locked: [0] })
    const start = initialPlacement(six)
    expect(evaluate(six, start)).toMatchObject({ total: 72, won: false })
    expect(evaluate(six, place(six, start, 1))).toMatchObject({ total: 67, won: true })
  })

  it('keep the locked debut (level 18): the stuck balloon starts aboard', () => {
    const def = levelByGlobal(18)!.def
    expect(def.hint).toMatch(/stuck on the pan/)
    const start = initialPlacement(def)
    expect(evaluate(def, start).total).toBe(-20)
    expect(def.weights[def.locked![0]]).toBe(-20)
  })
})

describe('the Daily Challenge board', () => {
  it('is de-ordered too: a year of boards never wins by tapping along, and stays the same puzzle', async () => {
    const { dailyLevelFor } = await import('./daily')
    const { solveLevel } = await import('./solver')
    const { evaluate } = await import('./rules')
    const start = Date.UTC(2026, 0, 1)
    let violations = 0
    for (let d = 0; d < 365; d++) {
      const key = new Date(start + d * 86400000).toISOString().slice(0, 10)
      const level = dailyLevelFor(key)
      expect(dailyLevelFor(key)).toEqual(level) // deterministic per date
      expect(solveLevel(level).solvable).toBe(true)
      const n = level.weights.length
      for (let k = 1; k < n; k++) {
        const left = level.weights.map((_, i) => i < k)
        const right = level.weights.map((_, i) => i >= n - k)
        if (evaluate(level, left).won || evaluate(level, right).won) violations++
      }
    }
    expect(violations).toBe(0)
  })
})
