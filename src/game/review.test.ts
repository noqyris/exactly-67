import { describe, expect, it } from 'vitest'
import { noteReviewAsked, parseReviewAsks, REVIEW_MAX_PER_YEAR, reviewDue } from './review'

const DAY = 86_400_000
const NOW = 400 * DAY
const due = (asks: number[], global: number, stars: number, nowMs = NOW) => reviewDue({ asks, nowMs, global, stars })

describe('asking for a rating', () => {
  it('first: a 3★ clear from Level 8, or any clear from Level 12', () => {
    expect(due([], 7, 3)).toBe(false)
    expect(due([], 8, 3)).toBe(true)
    expect(due([], 11, 2)).toBe(false)
    expect(due([], 12, 1)).toBe(true)
  })

  it('second: only a 3★ clear, and only 14 days after the first', () => {
    const first = NOW - 13 * DAY
    expect(due([first], 40, 3)).toBe(false)
    expect(due([NOW - 14 * DAY], 40, 3)).toBe(true)
    expect(due([NOW - 30 * DAY], 40, 2)).toBe(false)
  })

  it('third: 120 days after the second; never a fourth inside a year', () => {
    const asks = [NOW - 200 * DAY, NOW - 119 * DAY]
    expect(due(asks, 90, 3)).toBe(false)
    expect(due([NOW - 200 * DAY, NOW - 120 * DAY], 90, 3)).toBe(true)
    expect(REVIEW_MAX_PER_YEAR).toBe(3)
    expect(due([NOW - 300 * DAY, NOW - 200 * DAY, NOW - 10 * DAY], 90, 3)).toBe(false)
  })

  it('a year after the oldest ask, the window has room again', () => {
    const asks = [NOW - 380 * DAY, NOW - 360 * DAY, NOW - 200 * DAY]
    // Two asks remain inside the year: the third-ask spacing applies.
    expect(due(asks, 90, 3)).toBe(true)
  })

  it('recording an ask keeps the year and drops older ones, without touching its input', () => {
    const before = [NOW - 400 * DAY, NOW - 10 * DAY]
    expect(noteReviewAsked(before, NOW)).toEqual([NOW - 10 * DAY, NOW])
    expect(before).toHaveLength(2)
  })

  it('parses defensively', () => {
    expect(parseReviewAsks(undefined)).toEqual([])
    expect(parseReviewAsks([1, 'x', -5, Number.NaN, 2])).toEqual([1, 2])
  })
})
