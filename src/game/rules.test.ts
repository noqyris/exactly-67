import { describe, expect, it } from 'vitest'
import {
  canPlace,
  canRemove,
  evaluate,
  initialPlacement,
  place,
  placedCount,
  remove,
  rightTotal,
} from './rules'
import type { LevelDef } from './types'

const plain: LevelDef = { weights: [40, 32, -5, 10] }

describe('initialPlacement', () => {
  it('starts empty without locked weights', () => {
    expect(initialPlacement(plain)).toEqual([false, false, false, false])
  })

  it('pre-places locked weights', () => {
    const level: LevelDef = { weights: [72, -5], locked: [0] }
    expect(initialPlacement(level)).toEqual([true, false])
  })
})

describe('place / remove', () => {
  it('placing and removing updates the total', () => {
    let placed = initialPlacement(plain)
    placed = place(plain, placed, 0)
    placed = place(plain, placed, 1)
    expect(rightTotal(plain, placed)).toBe(72)
    placed = place(plain, placed, 2)
    expect(rightTotal(plain, placed)).toBe(67)
    placed = remove(plain, placed, 2)
    expect(rightTotal(plain, placed)).toBe(72)
  })

  it('is immutable: returns new arrays and never mutates input', () => {
    const before = initialPlacement(plain)
    const after = place(plain, before, 0)
    expect(before[0]).toBe(false)
    expect(after[0]).toBe(true)
    expect(after).not.toBe(before)
  })

  it('refuses to place an already placed weight', () => {
    const placed = place(plain, initialPlacement(plain), 0)
    expect(canPlace(plain, placed, 0)).toEqual({ ok: false, reason: 'already-placed' })
    expect(place(plain, placed, 0)).toEqual(placed)
  })

  it('enforces the piece budget, counting locked weights', () => {
    const level: LevelDef = { weights: [50, 10, 7, 20], locked: [0], maxWeights: 3 }
    let placed = initialPlacement(level)
    placed = place(level, placed, 1)
    placed = place(level, placed, 2)
    expect(placedCount(placed)).toBe(3)
    expect(canPlace(level, placed, 3)).toEqual({ ok: false, reason: 'budget-full' })
    expect(place(level, placed, 3)).toEqual(placed)
  })

  it('never removes locked weights', () => {
    const level: LevelDef = { weights: [72, -5], locked: [0] }
    const placed = initialPlacement(level)
    expect(canRemove(level, placed, 0)).toBe(false)
    expect(remove(level, placed, 0)).toEqual(placed)
  })

  it('cannot remove a weight that is not on the pan', () => {
    const placed = initialPlacement(plain)
    expect(canRemove(plain, placed, 1)).toBe(false)
  })
})

describe('evaluate', () => {
  it('wins at exactly 67', () => {
    let placed = initialPlacement(plain)
    placed = place(plain, placed, 0)
    placed = place(plain, placed, 1)
    placed = place(plain, placed, 2)
    const ev = evaluate(plain, placed)
    expect(ev).toMatchObject({ total: 67, gap: 0, balanced: true, won: true })
  })

  it('reports overshoot and undershoot gaps', () => {
    let placed = initialPlacement(plain)
    placed = place(plain, placed, 0)
    expect(evaluate(plain, placed)).toMatchObject({ total: 40, gap: -27, won: false })
    placed = place(plain, placed, 1)
    expect(evaluate(plain, placed)).toMatchObject({ total: 72, gap: 5, won: false })
  })

  it('useAll: balanced at 67 is not a win until every weight is aboard', () => {
    // 60 + 7 = 67 balances early; the remaining pair nets to zero.
    const level: LevelDef = { weights: [60, 7, 8, -8], useAll: true }
    let placed = initialPlacement(level)
    placed = place(level, placed, 0)
    placed = place(level, placed, 1)
    let ev = evaluate(level, placed)
    expect(ev.balanced).toBe(true)
    expect(ev.won).toBe(false)
    expect(ev.blockedReason).toBe('use-all')

    placed = place(level, placed, 2)
    placed = place(level, placed, 3)
    ev = evaluate(level, placed)
    expect(ev).toMatchObject({ total: 67, balanced: true, won: true })
    expect(ev.blockedReason).toBeUndefined()
  })
})
