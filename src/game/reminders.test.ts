import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlannedReminder, ReminderInput } from './reminders'
import { DEFAULT_HABIT_MINUTE, habitMinuteOf, planReminders, REMINDER_IDS } from './reminders'

/**
 * The reminder planner is all local-time arithmetic, so every rule is pinned in
 * two real time zones on opposite sides of UTC with different DST dates. The
 * planner reads the zone through `Date`, so each suite sets `process.env.TZ`
 * before it builds a single date (Node re-reads TZ on assignment) and the first
 * test of each suite proves the switch took effect — a suite that silently ran
 * in the machine's zone would prove nothing.
 */

const ORIGINAL_TZ = process.env.TZ

/** Local wall-clock time as "YYYY-MM-DD HH:MM" — what the player's lock screen shows. */
function wall(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const dayKey = (d: Date) => wall(d).slice(0, 10)
const byId = (plan: PlannedReminder[], id: number) => plan.find((r) => r.id === id)

function input(over: Partial<ReminderInput> = {}): ReminderInput {
  const now = over.now ?? new Date(2026, 8, 23, 12, 0) // Wed 23 Sep 2026, noon local
  return {
    now,
    enabled: true,
    habitMinute: null,
    lastSessionAt: now,
    streak: 0,
    dailyDoneToday: false,
    nextLevel: 42,
    ...over,
  }
}

function battery(tz: string, januaryOffset: number, dst: { spring: [number, number]; fall: [number, number] }) {
  describe(`planReminders in ${tz}`, () => {
    beforeAll(() => {
      process.env.TZ = tz
    })
    afterAll(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ
      else process.env.TZ = ORIGINAL_TZ
    })

    it('really runs in this zone', () => {
      expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(januaryOffset)
    })

    it('plans nothing when reminders are off', () => {
      expect(planReminders(input({ enabled: false, streak: 9 }))).toEqual([])
    })

    it('lays out the ladder at 18:30 by default, soonest first, with no last call for a new player', () => {
      const plan = planReminders(input())
      expect(plan.map((r) => r.id)).toEqual([6701, 6702, 6703, 6707, 6714, 6730])
      expect(plan.map((r) => wall(r.at))).toEqual([
        '2026-09-24 18:30',
        '2026-09-25 18:30',
        '2026-09-26 18:30',
        '2026-09-30 18:30',
        '2026-10-07 18:30',
        '2026-10-23 18:30',
      ])
      expect(DEFAULT_HABIT_MINUTE).toBe(18 * 60 + 30)
      for (const r of plan) expect(REMINDER_IDS).toContain(r.id)
    })

    it('marks the long-lapse rungs passive and sends only 6714 to the map', () => {
      const plan = planReminders(input())
      const level = Object.fromEntries(plan.map((r) => [r.id, r.interruptionLevel]))
      expect(level).toEqual({ 6701: 'active', 6702: 'active', 6703: 'active', 6707: 'passive', 6714: 'passive', 6730: 'passive' })
      expect(plan.filter((r) => r.route === 'map').map((r) => r.id)).toEqual([6714])
      expect(`${byId(plan, 6714)!.title} ${byId(plan, 6714)!.body}`).toContain('42')
    })

    it('keeps every slot inside 09:00–21:00, whatever the habit', () => {
      const bad: string[] = []
      for (const habitMinute of [0, 3 * 60, 8 * 60 + 59, 12 * 60 + 7, 20 * 60 + 59, 21 * 60 + 1, 23 * 60 + 59, 5000, -40]) {
        for (const r of planReminders(input({ habitMinute, streak: 5 }))) {
          const minute = r.at.getHours() * 60 + r.at.getMinutes()
          if (minute < 9 * 60 || minute > 21 * 60) bad.push(`${habitMinute} → ${r.id} ${wall(r.at)}`)
        }
      }
      expect(bad).toEqual([])
      expect(wall(byId(planReminders(input({ habitMinute: 3 * 60 })), 6702)!.at)).toBe('2026-09-25 09:00')
      expect(wall(byId(planReminders(input({ habitMinute: 23 * 60 })), 6702)!.at)).toBe('2026-09-25 21:00')
      expect(wall(byId(planReminders(input({ habitMinute: 12 * 60 + 7 })), 6702)!.at)).toBe('2026-09-25 12:07')
    })

    it('moves a slot within 12 h of the last session to 21:00 that day', () => {
      const late = new Date(2026, 8, 23, 23, 30)
      const plan = planReminders(input({ now: late, lastSessionAt: late, habitMinute: 9 * 60 }))
      expect(wall(byId(plan, 6701)!.at)).toBe('2026-09-24 21:00') // 09:00 is only 9.5 h away
      expect(wall(byId(plan, 6702)!.at)).toBe('2026-09-25 09:00') // far enough, untouched
    })

    it('drops a slot when even 21:00 is within 12 h of the last session', () => {
      const now = new Date(2026, 8, 23, 12, 0)
      const lastSessionAt = new Date(2026, 8, 24, 10, 0) // a clock that ran ahead
      const plan = planReminders(input({ now, lastSessionAt }))
      expect(byId(plan, 6701)).toBeUndefined()
      expect(byId(plan, 6702)).toBeDefined()
    })

    it('never plans a regular reminder within 12 h of the session, nor anything in the next minute', () => {
      const bad: string[] = []
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 29, 59]) {
          const now = new Date(2026, 8, 23, h, m, 45)
          for (const habitMinute of [null, 9 * 60, 13 * 60, 21 * 60]) {
            for (const r of planReminders(input({ now, habitMinute, streak: 4 }))) {
              const ahead = r.at.getTime() - now.getTime()
              if (ahead < 60_000 || (r.id !== 6799 && ahead < 12 * 3600_000)) bad.push(`${wall(now)} → ${r.id} ${wall(r.at)}`)
            }
          }
        }
      }
      expect(bad).toEqual([])
    })

    it('sends a last call at 21:00 today only for a 3+ streak whose daily is still open', () => {
      const noon = input({ streak: 3 })
      const call = byId(planReminders(noon), 6799)!
      expect(wall(call.at)).toBe('2026-09-23 21:00')
      expect(call.route).toBe('daily')
      expect(call.interruptionLevel).toBe('active')
      expect(`${call.title} ${call.body}`).toContain('3-day streak')

      expect(byId(planReminders(input({ streak: 2 })), 6799)).toBeUndefined()
      expect(byId(planReminders(input({ streak: 3, dailyDoneToday: true })), 6799)).toBeUndefined()
      expect(byId(planReminders(input({ streak: 30, enabled: false })), 6799)).toBeUndefined()
    })

    it('keeps the last call 4 h clear of the last session', () => {
      const at = (h: number, m: number) => new Date(2026, 8, 23, h, m)
      expect(byId(planReminders(input({ streak: 5, now: at(17, 0) })), 6799)).toBeDefined() // exactly 4 h
      expect(byId(planReminders(input({ streak: 5, now: at(17, 1) })), 6799)).toBeUndefined()
      // An early session keeps the call even when the plan is refreshed later on.
      expect(byId(planReminders(input({ streak: 5, now: at(19, 0), lastSessionAt: at(8, 0) })), 6799)).toBeDefined()
    })

    it('drops a last call that would fire within the next minute (iOS fires a past time at once)', () => {
      const early = new Date(2026, 8, 23, 8, 0)
      const just = input({ streak: 5, lastSessionAt: early, now: new Date(2026, 8, 23, 20, 59, 30) })
      expect(byId(planReminders(just), 6799)).toBeUndefined()
      const room = input({ streak: 5, lastSessionAt: early, now: new Date(2026, 8, 23, 20, 58, 0) })
      expect(byId(planReminders(room), 6799)).toBeDefined()
      const after = input({ streak: 5, lastSessionAt: early, now: new Date(2026, 8, 23, 22, 0) })
      expect(byId(planReminders(after), 6799)).toBeUndefined()
    })

    it('plans at most one reminder per calendar day, the last call excepted', () => {
      const plan = planReminders(input({ streak: 7 }))
      expect(plan.map((r) => r.id)).toContain(6799)
      const days = plan.filter((r) => r.id !== 6799).map((r) => dayKey(r.at))
      expect(new Set(days).size).toBe(days.length)
      expect(days).not.toContain(dayKey(byId(plan, 6799)!.at))
    })

    it('switches 6701 to streak copy only while a 2+ streak will still be alive tomorrow', () => {
      const fresh = byId(planReminders(input({ streak: 1, dailyDoneToday: true })), 6701)!
      expect(`${fresh.title} ${fresh.body}`).not.toMatch(/streak|days level|Day \d/)

      for (let d = 0; d < 3; d++) {
        const now = new Date(2026, 8, 23 + d, 12)
        const streaky = byId(planReminders(input({ now, streak: 4, dailyDoneToday: true })), 6701)!
        const text = `${streaky.title} ${streaky.body}`
        expect(text).toMatch(/Day 5 is waiting|4-day streak|4 days level\. Make it 5\?|flame wants feeding/)
      }

      // Daily not done today: by the time 6701 fires the streak is gone, so no streak talk.
      const lapsed = byId(planReminders(input({ streak: 9, dailyDoneToday: false })), 6701)!
      expect(`${lapsed.title} ${lapsed.body}`).not.toMatch(/streak|days level|Day \d|flame wants feeding/)

      // … unless a freeze covers today: then it is alive tomorrow, still at 9.
      const frozen = byId(planReminders(input({ streak: 9, dailyDoneToday: false, freezes: 1 })), 6701)!
      expect(`${frozen.title} ${frozen.body}`).toMatch(/9-day streak/)
    })

    it('never announces a fresh start while freezes still hold the streak', () => {
      const FRESH_START = /new streak|starts at 1|fresh start/i
      const ALIVE_TALK = /Frozen|still alive|held|\d+-day streak|days level|Day \d|flame/
      const bad: string[] = []
      for (const streak of [2, 5]) {
        for (const dailyDoneToday of [true, false]) {
          for (const freezes of [0, 1, 2, 3, 10]) {
            for (let d = 0; d < 4; d++) {
              const now = new Date(2026, 8, 23 + d, 12)
              for (const r of planReminders(input({ now, streak, dailyDoneToday, freezes }))) {
                if (r.id === 6799) continue // today: not a lapse rung
                const k = Math.round(
                  (Date.UTC(r.at.getFullYear(), r.at.getMonth(), r.at.getDate()) -
                    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
                    86_400_000,
                )
                // Days missed by the time it fires; reconcile() spends one freeze per missed day.
                const alive = (dailyDoneToday ? k - 1 : k) <= freezes
                const text = `${r.title} ${r.body}`
                const tag = `${streak}/${dailyDoneToday ? 'done' : 'open'}/${freezes} freezes, +${k} ${r.id}: ${text}`
                if (alive && (FRESH_START.test(text) || !ALIVE_TALK.test(text))) bad.push(`alive, ${tag}`)
                if (!alive && ALIVE_TALK.test(text)) bad.push(`broken, ${tag}`)
              }
            }
          }
        }
      }
      expect(bad).toEqual([])

      // The two freezes a player can hold carry a done-today streak through day +3 …
      const held = planReminders(input({ streak: 5, dailyDoneToday: true, freezes: 2 }))
      for (const id of [6702, 6703]) expect(`${byId(held, id)!.title} ${byId(held, id)!.body}`).toMatch(/5-day streak/)
      // … and one freeze only through day +2: day +3 has really broken, so it may start over.
      const one = planReminders(input({ streak: 5, dailyDoneToday: true, freezes: 1 }))
      expect(`${byId(one, 6702)!.title} ${byId(one, 6702)!.body}`).toMatch(/5-day streak/)
      expect(`${byId(one, 6703)!.title} ${byId(one, 6703)!.body}`).toMatch(FRESH_START)
    })

    it('reads a missing or nonsense freeze count as none, and a 1-day streak as not worth a mention', () => {
      const base = planReminders(input({ streak: 5, dailyDoneToday: true }))
      for (const freezes of [0, -2, NaN, Infinity]) {
        expect(planReminders(input({ streak: 5, dailyDoneToday: true, freezes }))).toEqual(base)
      }
      const single = planReminders(input({ streak: 1, dailyDoneToday: true, freezes: 2 }))
      for (const r of single) expect(`${r.title} ${r.body}`).not.toMatch(/Frozen|still alive|held|-day streak/)
    })

    it('never shows the same text for a reminder two days running, and fills every placeholder', () => {
      const bad: string[] = []
      for (const over of [
        { streak: 0 },
        { streak: 6, dailyDoneToday: true },
        { streak: 6 },
        { streak: 6, dailyDoneToday: true, freezes: 2 },
        { streak: 6, freezes: 2 },
      ]) {
        let previous = new Map<number, string>()
        for (let d = 0; d < 45; d++) {
          const plan = planReminders(input({ ...over, now: new Date(2026, 8, 1 + d, 12) }))
          const current = new Map(plan.map((r) => [r.id, `${r.title}|${r.body}`]))
          for (const [id, text] of current) {
            if (/[{}]/.test(text)) bad.push(`unfilled: ${text}`)
            if (previous.get(id) === text) bad.push(`day ${d}, ${id} repeats: ${text}`)
          }
          previous = current
        }
      }
      expect(bad).toEqual([])
    })

    it('keeps the app name, prices, ads and sales out of every variant', () => {
      const seen = new Set<string>()
      for (let d = 0; d < 12; d++) {
        for (const over of [{ streak: 0 }, { streak: 5, dailyDoneToday: true }, { streak: 5 }, { streak: 5, freezes: 2 }]) {
          const now = new Date(2026, 8, 1 + d, 12)
          for (const r of planReminders(input({ ...over, now, lastSessionAt: new Date(2026, 8, 1 + d, 8) }))) {
            seen.add(r.title)
            seen.add(r.body)
            expect(r.title).not.toMatch(/Exactly 67/) // the app name ("Still exactly 67" is the pun, not the name)
          }
        }
      }
      expect(seen.size).toBe(40) // all 20 variants seen, titles and bodies
      for (const text of seen) expect(text).not.toMatch(/\$|€|price|\bads?\b|no ads|sale|discount|offer/i)
    })

    describe('tomorrow’s gift rung', () => {
      const giftTomorrow = { day: 3, hints: 4 }
      const GIFT = /gift|hints/i
      const text = (r: PlannedReminder) => `${r.title} ${r.body}`

      it('is what 6701 says whenever a rung is promised — naming the rung and its hints — and it opens the menu', () => {
        for (const over of [{ streak: 0 }, { streak: 6, dailyDoneToday: true }]) {
          for (let d = 0; d < 12; d++) {
            const now = new Date(2026, 8, 1 + d, 12)
            const r = byId(planReminders(input({ ...over, now, giftTomorrow })), 6701)!
            // The owner's ask: the push is about the hint streak, every time.
            expect(text(r)).toMatch(GIFT)
            expect(text(r)).toMatch(/\b4 hints\b/)
            expect(text(r)).toMatch(/Day 3|day-3/)
            // The gift card lives on the menu, not on the daily board.
            expect(r.route).toBe('menu')
          }
        }
      })

      it('never promises more growth at the top of the ladder (day 5 → the ladder starts over)', () => {
        for (let d = 0; d < 12; d++) {
          const now = new Date(2026, 8, 1 + d, 12)
          const r = byId(planReminders(input({ streak: 3, dailyDoneToday: true, now, giftTomorrow: { day: 5, hints: 8 } })), 6701)!
          expect(text(r)).not.toMatch(/grow(ing)?\b|keep it/i)
        }
      })

      it('without a promised rung, 6701 stays the puzzle copy and opens the daily', () => {
        const now = new Date(2026, 8, 3, 12)
        const r = byId(planReminders(input({ streak: 0, now })), 6701)!
        expect(text(r)).not.toMatch(GIFT)
        expect(r.route).toBe('daily')
      })

      it('never names it on a later rung: by day +2 an unclaimed day has reset the ladder', () => {
        const bad: string[] = []
        for (let d = 0; d < 12; d++) {
          for (const over of [{ streak: 0 }, { streak: 6, dailyDoneToday: true }, { streak: 6, freezes: 2 }, { streak: 4 }]) {
            const now = new Date(2026, 8, 1 + d, 12)
            for (const r of planReminders(input({ ...over, now, giftTomorrow }))) {
              if (r.id !== 6701 && GIFT.test(text(r))) bad.push(`${r.id}: ${text(r)}`)
            }
          }
        }
        expect(bad).toEqual([])
      })

      it('is no promise without the fact, on day 1, or for nonsense', () => {
        for (let d = 0; d < 6; d++) {
          const now = new Date(2026, 8, 1 + d, 12)
          const base = planReminders(input({ streak: 5, dailyDoneToday: true, now }))
          for (const g of [null, undefined, { day: 1, hints: 1 }, { day: Number.NaN, hints: 4 }, { day: 3, hints: 2.5 }]) {
            expect(planReminders(input({ streak: 5, dailyDoneToday: true, now, giftTomorrow: g }))).toEqual(base)
          }
        }
      })

      it('keeps the streak rules: no fresh start while freezes hold it, no streak talk once broken', () => {
        const FRESH_START = /new streak|starts at 1|fresh start/i
        const STREAK_TALK = /Frozen|still alive|held|\d+-day streak|days level|flame/
        const bad: string[] = []
        for (let d = 0; d < 12; d++) {
          const now = new Date(2026, 8, 1 + d, 12)
          for (const over of [{ streak: 5, freezes: 1 }, { streak: 5, dailyDoneToday: true }, { streak: 5 }, { streak: 0 }]) {
            const r = byId(planReminders(input({ ...over, now, giftTomorrow })), 6701)!
            if (!GIFT.test(text(r))) continue
            // The gift copy is streak-neutral, so it stays true whatever the streak does.
            if (FRESH_START.test(text(r)) || STREAK_TALK.test(text(r))) bad.push(text(r))
          }
        }
        expect(bad).toEqual([])
      })

      it('keeps the app name, prices, ads and sales out, and fills every placeholder', () => {
        const seen = new Set<string>()
        for (let d = 0; d < 12; d++) {
          const now = new Date(2026, 8, 1 + d, 12)
          for (const r of planReminders(input({ now, giftTomorrow: { day: 5, hints: 8 } }))) {
            expect(`${r.title}|${r.body}`).not.toMatch(/[{}]/)
            if (GIFT.test(text(r))) seen.add(`${r.title}|${r.body}`)
          }
        }
        expect(seen.size).toBe(3) // every gift variant seen
        for (const t of seen) expect(t).not.toMatch(/Exactly 67|\$|€|price|\bads?\b|sale|discount|offer/i)
      })
    })

    it(`holds the wall-clock time across the spring DST change`, () => {
      const [month, day] = dst.spring
      const now = new Date(2026, month, day - 2, 12, 0)
      const plan = planReminders(input({ now, habitMinute: 18 * 60 + 30 }))
      for (const r of plan) expect([r.at.getHours(), r.at.getMinutes()]).toEqual([18, 30])
      // Two local days that contain the change are one hour short.
      const gap = byId(plan, 6703)!.at.getTime() - byId(plan, 6701)!.at.getTime()
      expect(gap).toBe(47 * 3600_000)
    })

    it(`holds the wall-clock time across the autumn DST change`, () => {
      const [month, day] = dst.fall
      const now = new Date(2026, month, day - 2, 12, 0)
      const plan = planReminders(input({ now, habitMinute: 9 * 60 + 15 }))
      for (const r of plan) expect([r.at.getHours(), r.at.getMinutes()]).toEqual([9, 15])
      const gap = byId(plan, 6703)!.at.getTime() - byId(plan, 6701)!.at.getTime()
      expect(gap).toBe(49 * 3600_000)
    })
  })

  describe(`habitMinuteOf in ${tz}`, () => {
    beforeAll(() => {
      process.env.TZ = tz
    })
    afterAll(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ
      else process.env.TZ = ORIGINAL_TZ
    })

    const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime()

    it('is null with no history', () => {
      expect(habitMinuteOf([])).toBeNull()
      expect(habitMinuteOf([NaN, Infinity])).toBeNull()
    })

    it('takes the median local start minute, not the mean', () => {
      expect(habitMinuteOf([at(1, 19), at(2, 20), at(3, 9, 30)])).toBe(19 * 60)
      expect(habitMinuteOf([at(3, 20), at(1, 18)])).toBe(19 * 60) // even count: the middle two averaged
      expect(habitMinuteOf([at(1, 19), at(2, 19, 10), at(3, 19, 20), at(4, 3)])).toBe(19 * 60 + 5)
    })

    it('uses only the 7 most recent sessions, in whatever order they arrive', () => {
      const old = [at(1, 10), at(2, 10), at(3, 10), at(4, 10)]
      const recent = [at(10, 20), at(11, 20), at(12, 20), at(13, 20)]
      // Eight starts: the oldest 10:00 falls out, leaving four 20:00s against three 10:00s.
      expect(habitMinuteOf([...recent, ...old].reverse())).toBe(20 * 60)
    })

    it('clamps into quiet hours', () => {
      expect(habitMinuteOf([at(1, 2), at(2, 3), at(3, 1)])).toBe(9 * 60)
      expect(habitMinuteOf([at(1, 23), at(2, 23, 30), at(3, 22)])).toBe(21 * 60)
    })
  })
}

battery('Europe/Belgrade', -60, { spring: [2, 29], fall: [9, 25] })
battery('America/Los_Angeles', 480, { spring: [2, 8], fall: [10, 1] })
