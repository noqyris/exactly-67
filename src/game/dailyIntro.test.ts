import { describe, expect, it } from 'vitest'
import {
  DAILY_INTRO_MAX_SHOWS,
  DAILY_INTRO_MIN_LEVEL,
  dailyIntroDue,
  emptyDailyIntro,
  noteDailyIntroShown,
  parseDailyIntro,
  type DailyIntroContext,
} from './dailyIntro'

const TODAY = '2026-10-17'
const base: DailyIntroContext = { global: 8, everSolvedDaily: false, doneToday: false, state: emptyDailyIntro(), today: TODAY }
const due = (over: Partial<DailyIntroContext> = {}) => dailyIntroDue({ ...base, ...over })

describe('Daily intro', () => {
  it('from level 8 — balloons are taught by then, and that clear never carries an interstitial', () => {
    expect(DAILY_INTRO_MIN_LEVEL).toBe(8)
    expect(due({ global: 7 })).toBe(false)
    expect(due({ global: 8 })).toBe(true)
    expect(due({ global: 300 })).toBe(true)
  })

  it('never once a Daily was ever solved, or when today’s is done', () => {
    expect(due({ everSolvedDaily: true })).toBe(false)
    expect(due({ doneToday: true })).toBe(false)
  })

  it('at most three times, and never twice on one day', () => {
    expect(DAILY_INTRO_MAX_SHOWS).toBe(3)
    let state = emptyDailyIntro()
    const days = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']
    const seen: boolean[] = []
    for (const today of days) {
      seen.push(dailyIntroDue({ ...base, state, today }))
      if (seen[seen.length - 1]) state = noteDailyIntroShown(state, today)
      // A second clear the same day: not again.
      expect(dailyIntroDue({ ...base, state, today })).toBe(false)
    }
    expect(seen).toEqual([true, true, true, false])
  })

  it('noting a show counts it and stamps the day, without touching its input', () => {
    const before = { shown: 1, day: '2026-10-15' }
    expect(noteDailyIntroShown(before, TODAY)).toEqual({ shown: 2, day: TODAY })
    expect(before).toEqual({ shown: 1, day: '2026-10-15' })
  })

  it('parses defensively: anything unreadable is a fresh state', () => {
    expect(parseDailyIntro(undefined)).toEqual(emptyDailyIntro())
    expect(parseDailyIntro('x')).toEqual(emptyDailyIntro())
    expect(parseDailyIntro([1])).toEqual(emptyDailyIntro())
    expect(parseDailyIntro({ shown: -1, day: 'nope' })).toEqual({ shown: 0, day: null })
    expect(parseDailyIntro({ shown: '2', day: TODAY })).toEqual({ shown: 0, day: TODAY })
    expect(parseDailyIntro({ shown: 2, day: TODAY })).toEqual({ shown: 2, day: TODAY })
  })
})
