import { describe, expect, it } from 'vitest'
import { cellState, dayMark, nextLevel, packIndexOf, packLocked, packUnlockLevel } from './journey'
import { emptyProgress, mergeClear } from './progress'
import type { Progress } from './progress'

/** Levels 1..n cleared at 3 stars. */
function clearedTo(n: number): Progress {
  let p = emptyProgress()
  for (let g = 1; g <= n; g++) p = mergeClear(p, g, 3, 1)
  return p
}

const SIZES = [24, 24, 24]

describe('nextLevel', () => {
  it('is level 1 on a fresh install and the first uncleared level after', () => {
    expect(nextLevel(emptyProgress(), 72)).toBe(1)
    expect(nextLevel(clearedTo(43), 72)).toBe(44)
  })

  it('skips nothing: a gap in the clears is the next level, not the end of the run', () => {
    const p = mergeClear(clearedTo(10), 12, 2, 3)
    expect(nextLevel(p, 72)).toBe(11)
  })

  it('stops at the last level once every one is cleared', () => {
    expect(nextLevel(clearedTo(72), 72)).toBe(72)
  })
})

describe('packIndexOf', () => {
  it('maps global levels to their pack by the packs’ sizes', () => {
    expect(packIndexOf(SIZES, 1)).toBe(0)
    expect(packIndexOf(SIZES, 24)).toBe(0)
    expect(packIndexOf(SIZES, 25)).toBe(1)
    expect(packIndexOf(SIZES, 48)).toBe(1)
    expect(packIndexOf(SIZES, 49)).toBe(2)
    expect(packIndexOf([24, 10, 5], 35)).toBe(2)
  })

  it('clamps a level past the end to the last pack', () => {
    expect(packIndexOf(SIZES, 999)).toBe(2)
  })
})

describe('cellState', () => {
  it('cleared, the open one, the one after it, then the locked road', () => {
    const p = clearedTo(43)
    expect(cellState(p, 43)).toBe('cleared')
    expect(cellState(p, 44)).toBe('open')
    expect(cellState(p, 45)).toBe('next')
    expect(cellState(p, 46)).toBe('locked')
    expect(cellState(p, 600)).toBe('locked')
  })

  it('level 1 is open on a fresh install and level 2 is next', () => {
    expect(cellState(emptyProgress(), 1)).toBe('open')
    expect(cellState(emptyProgress(), 2)).toBe('next')
    expect(cellState(emptyProgress(), 3)).toBe('locked')
  })

  it('every level is open (or cleared) in an every-level-open test build', () => {
    const p = clearedTo(3)
    expect(cellState(p, 2, true)).toBe('cleared')
    expect(cellState(p, 500, true)).toBe('open')
  })
})

describe('packLocked', () => {
  it('a pack opens with the last level of the pack before it', () => {
    expect(packLocked(clearedTo(47), 49, 24)).toBe(true)
    expect(packLocked(clearedTo(48), 49, 24)).toBe(false)
    expect(packUnlockLevel(49)).toBe(48)
  })

  it('the first pack is never locked', () => {
    expect(packLocked(emptyProgress(), 1, 24)).toBe(false)
    expect(packUnlockLevel(1)).toBe(1)
  })

  it('a stray clear inside a later pack opens that pack', () => {
    const p = mergeClear(clearedTo(10), 60, 1, 4)
    expect(packLocked(p, 49, 24)).toBe(false)
    expect(packLocked(p, 25, 24)).toBe(true)
  })

  it('nothing is locked in an every-level-open test build', () => {
    expect(packLocked(emptyProgress(), 577, 24, true)).toBe(false)
  })
})

describe('dayMark', () => {
  const TODAY = '2026-10-17'
  it('a past day is solved or missed, today is solved or today, later is future', () => {
    expect(dayMark('2026-10-03', TODAY, true)).toBe('solved')
    expect(dayMark('2026-10-03', TODAY, false)).toBe('missed')
    expect(dayMark(TODAY, TODAY, false)).toBe('today')
    expect(dayMark(TODAY, TODAY, true)).toBe('solved')
    expect(dayMark('2026-10-18', TODAY, false)).toBe('future')
  })
})
