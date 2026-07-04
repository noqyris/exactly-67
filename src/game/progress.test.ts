import { describe, expect, it } from 'vitest'
import {
  bestFor,
  emptyProgress,
  isUnlocked,
  mergeClear,
  parseProgress,
  starsFor,
  totalStars,
} from './progress'

describe('mergeClear', () => {
  it('records a first clear', () => {
    const p = mergeClear(emptyProgress(), 1, 3, 2)
    expect(starsFor(p, 1)).toBe(3)
    expect(bestFor(p, 1)).toBe(2)
  })

  it('keeps the best of both runs, independently', () => {
    let p = mergeClear(emptyProgress(), 5, 1, 6)
    // Later run: better stars, worse count — stars improve, best count stays.
    p = mergeClear(p, 5, 3, 7)
    expect(starsFor(p, 5)).toBe(3)
    expect(bestFor(p, 5)).toBe(6)
    // Even later: worse stars, better count — count improves, stars stay.
    p = mergeClear(p, 5, 1, 3)
    expect(starsFor(p, 5)).toBe(3)
    expect(bestFor(p, 5)).toBe(3)
  })

  it('does not mutate the input', () => {
    const before = emptyProgress()
    mergeClear(before, 1, 3, 1)
    expect(starsFor(before, 1)).toBe(0)
  })
})

describe('unlocking', () => {
  it('level 1 is always unlocked, later levels follow clears', () => {
    const fresh = emptyProgress()
    expect(isUnlocked(fresh, 1)).toBe(true)
    expect(isUnlocked(fresh, 2)).toBe(false)
    const p = mergeClear(fresh, 1, 2, 3)
    expect(isUnlocked(p, 2)).toBe(true)
    expect(isUnlocked(p, 3)).toBe(false)
  })
})

describe('totalStars', () => {
  it('sums across levels', () => {
    let p = mergeClear(emptyProgress(), 1, 3, 1)
    p = mergeClear(p, 2, 2, 4)
    expect(totalStars(p)).toBe(5)
  })
})

describe('parseProgress', () => {
  it('round-trips', () => {
    const p = mergeClear(mergeClear(emptyProgress(), 1, 3, 2), 2, 1, 8)
    expect(parseProgress(JSON.stringify(p))).toEqual(p)
  })

  it('degrades bad data to a fresh start', () => {
    expect(parseProgress(null)).toEqual(emptyProgress())
    expect(parseProgress('')).toEqual(emptyProgress())
    expect(parseProgress('not json {')).toEqual(emptyProgress())
    expect(parseProgress('[1,2,3]')).toEqual(emptyProgress())
  })

  it('drops corrupt entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      stars: { '1': 3, '2': 99, x: 2, '3': 'nope' },
      best: { '1': 2, '2': -4 },
    })
    expect(parseProgress(raw)).toEqual({ stars: { '1': 3 }, best: { '1': 2 } })
  })
})
