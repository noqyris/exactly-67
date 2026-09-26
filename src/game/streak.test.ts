import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayKey,
  daysBetween,
  daysInMonth,
  formatCountdown,
  isDayKey,
  monthDays,
  msUntilNextDay,
  weekdayMon0,
} from './days'
import {
  addFreeze,
  canEarnFreezeByAd,
  canRepair,
  emptyStreak,
  MAX_FREEZES,
  milestoneFor,
  reconcile,
  recordSolve,
  reopenDay,
  repair,
  solvedToday,
  type Streak,
} from './streak'

const D = '2026-09-10'

/** Solve `n` consecutive days starting at `from`; returns the streak and the last day. */
function run(n: number, from = D, s: Streak = emptyStreak()): { s: Streak; last: string } {
  let day = from
  for (let i = 0; i < n; i++) {
    day = addDays(from, i)
    s = recordSolve(reconcile(s, day).streak, day).streak
  }
  return { s, last: day }
}

describe('days', () => {
  it('keys are local calendar days', () => {
    expect(dayKey(new Date(2026, 8, 23, 23, 59))).toBe('2026-09-23')
    expect(dayKey(new Date(2026, 8, 24, 0, 1))).toBe('2026-09-24')
  })

  it('arithmetic is calendar-exact across months, years and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-10', '2026-10-10')).toBe(30)
    expect(daysBetween('2026-10-10', '2026-09-10')).toBe(-30)
  })

  it('crosses a DST change as exactly one day', () => {
    // Europe springs forward on 2026-03-29, the US on 2026-03-08.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('validates keys', () => {
    expect(isDayKey('2026-02-29')).toBe(false)
    expect(isDayKey('2028-02-29')).toBe(true)
    expect(isDayKey('2026-13-01')).toBe(false)
    expect(isDayKey('26-09-01')).toBe(false)
    expect(isDayKey(20260901)).toBe(false)
  })

  it('month helpers', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-09-23')).toBe(30)
    expect(monthDays('2026-09')).toHaveLength(30)
    expect(monthDays('2026-09')[0]).toBe('2026-09-01')
    expect(weekdayMon0('2026-09-21')).toBe(0) // a Monday
    expect(weekdayMon0('2026-09-27')).toBe(6) // a Sunday
  })

  it('counts down to the next local midnight', () => {
    const ms = msUntilNextDay(new Date(2026, 8, 23, 18, 40))
    expect(formatCountdown(ms)).toBe('5h 20m')
    expect(formatCountdown(59_000)).toBe('1m')
  })
})

describe('streak', () => {
  it('counts consecutive solves and tracks the best', () => {
    const { s } = run(5)
    expect(s.current).toBe(5)
    expect(s.best).toBe(5)
  })

  it('a second solve on the same day is not counted twice', () => {
    const { s, last } = run(2)
    const again = recordSolve(s, last)
    expect(again.counted).toBe(false)
    expect(again.streak.current).toBe(2)
    expect(solvedToday(s, last)).toBe(true)
  })

  it('an unsolved today does not break a streak solved yesterday', () => {
    const { s, last } = run(4)
    const { streak, event } = reconcile(s, addDays(last, 1))
    expect(event.kind).toBe('none')
    expect(streak.current).toBe(4)
    expect(solvedToday(streak, addDays(last, 1))).toBe(false)
  })

  it('earns a free freeze on day 3 and every 7th day, capped', () => {
    expect(run(2).s.freezes).toBe(0)
    expect(run(3).s.freezes).toBe(1)
    expect(run(7).s.freezes).toBe(2)
    expect(run(14).s.freezes).toBe(MAX_FREEZES)
  })

  it('milestones pay fixed rewards on known days only', () => {
    expect(milestoneFor(1)).toBeNull()
    expect(milestoneFor(3)).toEqual({ day: 3, hints: 0, freezes: 1, badge: false })
    expect(milestoneFor(7)).toEqual({ day: 7, hints: 2, freezes: 1, badge: false })
    expect(milestoneFor(30)).toMatchObject({ hints: 5, badge: true })
    expect(milestoneFor(365)).toMatchObject({ hints: 20, badge: true })
    expect(milestoneFor(8)).toBeNull()
    expect(recordSolve(run(6).s, addDays(D, 6)).milestone?.day).toBe(7)
  })

  it('a missed day is bridged by a freeze and does not add to the count', () => {
    const { s, last } = run(3) // 1 freeze
    const skip = addDays(last, 2) // missed exactly one day
    const r = reconcile(s, skip)
    expect(r.event).toEqual({ kind: 'frozen', days: 1 })
    expect(r.streak.freezes).toBe(0)
    expect(r.streak.current).toBe(3)
    const solved = recordSolve(r.streak, skip)
    expect(solved.streak.current).toBe(4)
  })

  it('two missed days need two freezes; one is not a partial cover', () => {
    const { s, last } = run(3) // 1 freeze
    const r = reconcile(s, addDays(last, 3))
    expect(r.event).toEqual({ kind: 'broken', lost: 3 })
    expect(r.streak.current).toBe(0)
    expect(r.streak.freezes).toBe(1) // kept for the next streak
    expect(r.streak.lost).toEqual({ streak: 3, day: addDays(last, 3) })
  })

  it('reconcile is idempotent for the same day', () => {
    const { s, last } = run(3)
    const day = addDays(last, 2)
    const once = reconcile(s, day).streak
    expect(reconcile(once, day)).toEqual({ streak: once, event: { kind: 'none' } })
  })

  it('a broken streak can be repaired within the window, once per 30 days', () => {
    const { s, last } = run(9)
    const brokeOn = addDays(last, 4)
    const broken = { ...reconcile({ ...s, freezes: 0 }, brokeOn).streak }
    expect(canRepair(broken, brokeOn)).toBe(true)
    const fixed = repair(broken, brokeOn)!.streak
    expect(fixed.current).toBe(9)
    expect(fixed.lost).toBeNull()
    // The chain continues today.
    expect(recordSolve(fixed, brokeOn).streak.current).toBe(10)
    // Next break inside 30 days: no second repair.
    const again = reconcile({ ...recordSolve(fixed, brokeOn).streak, freezes: 0 }, addDays(brokeOn, 5)).streak
    expect(canRepair(again, addDays(brokeOn, 5))).toBe(false)
  })

  it('repair adds the days solved since the break', () => {
    const { s, last } = run(5)
    const brokeOn = addDays(last, 3)
    const broken = reconcile({ ...s, freezes: 0 }, brokeOn).streak
    const solvedAfter = recordSolve(broken, brokeOn).streak // current 1, lost still open
    expect(repair(solvedAfter, brokeOn)?.streak.current).toBe(6)
  })

  it('the repair window closes after two days', () => {
    const { s, last } = run(5)
    const brokeOn = addDays(last, 3)
    const broken = reconcile({ ...s, freezes: 0 }, brokeOn).streak
    expect(canRepair(broken, addDays(brokeOn, 1))).toBe(true)
    const later = reconcile(broken, addDays(brokeOn, 2)).streak
    expect(later.lost).toBeNull()
    expect(canRepair(later, addDays(brokeOn, 2))).toBe(false)
    expect(repair(later, addDays(brokeOn, 2))).toBeNull()
  })

  /** A `lost`-day streak broken the day after `last`, then `solved` days solved since. */
  function brokenThenSolved(lost: number, solved: number, freezes = 0) {
    const { s, last } = run(lost)
    const brokeOn = addDays(last, 2)
    let b = { ...reconcile({ ...s, freezes: 0 }, brokeOn).streak, freezes }
    for (let i = 0; i < solved; i++) b = recordSolve(b, addDays(brokeOn, i)).streak
    return { s: b, day: addDays(brokeOn, Math.max(0, solved - 1)) }
  }

  it('a repair that jumps onto a milestone pays it: hints to the caller, freezes applied', () => {
    const thirty = brokenThenSolved(29, 1)
    expect(repair(thirty.s, thirty.day)).toMatchObject({ hints: 5, freezes: 0, milestoneDay: 30, streak: { current: 30 } })
    const seven = brokenThenSolved(6, 1)
    const r = repair(seven.s, seven.day)!
    expect(r).toMatchObject({ hints: 2, freezes: 1, milestoneDay: 7 })
    expect(r.streak.freezes).toBe(1)
  })

  it('a repair never pays a milestone again, and freezes stay capped', () => {
    // 7 was paid when the lost streak reached it; 8 is an ordinary day.
    const eight = brokenThenSolved(7, 1)
    expect(repair(eight.s, eight.day)).toMatchObject({ hints: 0, freezes: 0, milestoneDay: null })
    // Nothing solved since the break: the next solve pays lost+1 the usual way.
    const none = brokenThenSolved(6, 0)
    expect(repair(none.s, none.day)).toMatchObject({ hints: 0, freezes: 0, milestoneDay: null, streak: { current: 6 } })
    const full = brokenThenSolved(6, 1, MAX_FREEZES)
    const r = repair(full.s, full.day)!
    expect(r).toMatchObject({ hints: 2, freezes: 0, milestoneDay: 7 })
    expect(r.streak.freezes).toBe(MAX_FREEZES)
  })

  it('one ad freeze a day, never above the cap', () => {
    const s = emptyStreak()
    expect(canEarnFreezeByAd(s, D)).toBe(true)
    const one = addFreeze(s, D)
    expect(one.freezes).toBe(1)
    expect(canEarnFreezeByAd(one, D)).toBe(false)
    expect(canEarnFreezeByAd(one, addDays(D, 1))).toBe(true)
    const full = addFreeze(addFreeze(s), undefined)
    expect(addFreeze(full)).toBe(full)
    expect(canEarnFreezeByAd(full, D)).toBe(false)
  })

  it('a day before the last kept day (clock/time zone moved back) changes nothing', () => {
    const { s, last } = run(30)
    const back = recordSolve(reconcile(s, addDays(last, -1)).streak, addDays(last, -1))
    expect(back.counted).toBe(false)
    expect(back.streak.current).toBe(30)
    expect(back.streak.lost).toBeNull()
  })

  describe('a day reopened after the next day’s reconcile (board opened 23:58, solved 00:01)', () => {
    // A 5-day streak through `last`; `day` is the board opened before midnight,
    // `next` the day the app came back to the foreground and reconciled.
    const { s: five, last } = run(5) // holds 1 freeze (day 3)
    const day = addDays(last, 1)
    const next = addDays(day, 1)

    it('a break caused by missing exactly that day is lifted', () => {
      const broken = reconcile({ ...five, freezes: 0 }, next)
      expect(broken.event).toEqual({ kind: 'broken', lost: 5 })
      const r = reopenDay(broken.streak, day, false)
      expect(r.undone).toBe('broken')
      expect(r.streak).toMatchObject({ current: 5, lost: null, lastDay: last, freezes: 0 })
      expect(recordSolve(r.streak, day).streak.current).toBe(6)
    })

    it('a freeze spent on that day is refunded', () => {
      const frozen = reconcile(five, next)
      expect(frozen.event).toEqual({ kind: 'frozen', days: 1 })
      const r = reopenDay(frozen.streak, day, false)
      expect(r.undone).toBe('frozen')
      expect(r.streak).toMatchObject({ current: 5, lastDay: last, freezes: 1 })
      const solved = recordSolve(r.streak, day).streak
      expect(solved).toMatchObject({ current: 6, freezes: 1, lastDay: day })
      // Idempotent: the solved day is never "refunded" again.
      expect(reopenDay(solved, day, true).undone).toBe('none')
      // A freeze earned back in between is not pushed past the cap.
      const refilled = { ...frozen.streak, freezes: MAX_FREEZES }
      expect(reopenDay(refilled, day, false).streak.freezes).toBe(MAX_FREEZES)
    })

    it('changes nothing it did not cause', () => {
      // Nothing reconciled yet: the streak still ends the day before.
      expect(reopenDay(five, day, false)).toEqual({ streak: five, undone: 'none' })
      // The day was solved: a kept day, not a freeze.
      const solved = recordSolve(five, day).streak
      expect(reopenDay(solved, day, true).streak).toBe(solved)
      // A break that also missed the day before: that one stands.
      const older = reconcile({ ...five, freezes: 0 }, addDays(next, 1)).streak
      expect(reopenDay(older, addDays(day, 1), false).undone).toBe('none')
      // A repair on the next day moved the chain there, and was paid for.
      const broken = reconcile({ ...five, freezes: 0 }, next).streak
      const repaired = { ...broken, current: 5, lost: null, lastDay: day, lastRepair: next }
      expect(reopenDay(repaired, day, false).undone).toBe('none')
    })
  })

  it('never mutates its input', () => {
    const { s } = run(3)
    const copy = JSON.parse(JSON.stringify(s))
    reconcile(s, addDays(D, 20))
    recordSolve(s, addDays(D, 3))
    addFreeze(s)
    reopenDay(s, addDays(D, 3), false)
    expect(s).toEqual(copy)
  })
})
