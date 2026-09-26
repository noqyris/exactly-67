import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, dayKey } from '../game/days'
import { GIFT_AD_BONUS, JAR_CAPACITY, JAR_START_NEW, NEW_INSTALL_HINTS } from '../game/economy'

/**
 * The meta-game wiring: persisted state in, hints paid out. The rules have their
 * own suites (streak/economy tests); this pins how progression.ts applies them —
 * a fresh install vs an upgrade, the jar, pack rewards paid once, the daily gift
 * paid once and climbing its ladder, and streak safety nets spending the one
 * hint stash.
 */

const stored: Record<string, string | null> = {}
let hints = 0
let unlimited = false
let interstitials = true
/** The facts last handed to the reminder planner. */
let reminderFacts: Record<string, unknown> | null = null

vi.mock('./ads', () => ({
  adsRemoved: () => false,
  hintsUnlimited: () => unlimited,
  interstitialsPossible: () => interstitials,
  hintCountValue: () => hints,
  grantHints: (n: number) => {
    hints += n
  },
  spendHints: (n: number) => {
    if (hints < n) return false
    hints -= n
    return true
  },
}))
vi.mock('./notifications', () => ({
  setReminderContext: (ctx: Record<string, unknown>) => {
    reminderFacts = ctx
  },
}))
vi.mock('./storage', () => ({
  loadMetaRaw: async () => stored.meta ?? null,
  saveMetaRaw: async (raw: string) => {
    stored.meta = raw
  },
  loadDailyDone: async () => stored.dailyDone ?? '',
  loadFreeHintDate: async () => stored.freeDate ?? '',
  loadProgress: async () => {
    const { parseProgress } = await import('../game/progress')
    return parseProgress(stored.progress ?? null)
  },
  saveProgress: async (p: unknown) => {
    stored.progress = JSON.stringify(p)
  },
}))

type Progression = typeof import('./progression')

const TODAY = dayKey(new Date())

async function boot(): Promise<Progression> {
  vi.resetModules()
  const store = await import('./progressStore')
  await store.initProgress()
  const p = await import('./progression')
  await p.initProgression()
  return p
}

/** Clear levels [from, to] with the given stars, before boot. */
function progressWith(from: number, to: number, stars = 3) {
  const s: Record<string, number> = {}
  const b: Record<string, number> = {}
  for (let g = from; g <= to; g++) {
    s[g] = stars
    b[g] = 1
  }
  stored.progress = JSON.stringify({ stars: s, best: b })
}

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k]
  hints = 0
  unlimited = false
  interstitials = true
  reminderFacts = null
})

afterEach(() => {
  vi.useRealTimers()
})

/** Pin the clock (local time) — Date only, so promises and timers run as usual. */
function clockAt(d: Date) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
}

describe('boot', () => {
  it('a brand-new install: starter hints, an endowed jar, today’s gift already given, first run', async () => {
    const p = await boot()
    expect(hints).toBe(NEW_INSTALL_HINTS)
    expect(p.jarStars()).toBe(JAR_START_NEW)
    expect(p.giftDue()).toBe(false)
    expect(p.isFirstRun()).toBe(true)
  })

  it('an upgrade from 1.2.x: no starter hints, empty jar, a recent daily keeps a live streak', async () => {
    progressWith(1, 10)
    hints = 4
    stored.dailyDone = addDays(TODAY, -1)
    // Two days back: yesterday's UTC date can still be today's local day east of UTC.
    stored.freeDate = addDays(TODAY, -2)
    const p = await boot()
    expect(hints).toBe(4)
    expect(p.jarStars()).toBe(0)
    expect(p.isFirstRun()).toBe(false)
    expect(p.streak().current).toBe(1)
    expect(p.giftDue()).toBe(true)
  })

  it('an upgrade that already got today’s silent 1.2.x hint gets no gift on top', async () => {
    progressWith(1, 3)
    stored.freeDate = new Date().toISOString().slice(0, 10) // 1.2.x wrote the UTC date
    const p = await boot()
    expect(p.giftDue()).toBe(false)
  })

  describe('the 1.2.x hint date is UTC, the gift day local', () => {
    const tz = process.env.TZ
    afterEach(() => {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    })

    it('east of UTC: paid after local midnight, before the UTC rollover — no second gift', async () => {
      process.env.TZ = 'Europe/Belgrade' // UTC+2 in September
      clockAt(new Date('2026-09-23T08:00:00Z')) // 10:00 local; paid at 00:30 local = the 22nd in UTC
      expect(new Date().getHours()).toBe(10) // the zone really moved
      progressWith(1, 3)
      stored.freeDate = '2026-09-22'
      const p = await boot()
      expect(p.giftDue()).toBe(false)
    })

    it('west of UTC: paid in the evening, already tomorrow in UTC — no second gift', async () => {
      process.env.TZ = 'America/Los_Angeles' // UTC-7 in September
      clockAt(new Date('2026-09-24T03:00:00Z')) // 20:00 local on the 23rd
      expect(new Date().getHours()).toBe(20)
      progressWith(1, 3)
      stored.freeDate = '2026-09-24'
      const p = await boot()
      expect(p.giftDue()).toBe(false)
    })

    it('a date from before local midnight is yesterday’s hint: the gift is due', async () => {
      process.env.TZ = 'America/Los_Angeles'
      clockAt(new Date('2026-09-24T03:00:00Z'))
      progressWith(1, 3)
      stored.freeDate = '2026-09-22'
      const p = await boot()
      expect(p.giftDue()).toBe(true)
    })
  })

  it('an Americas evening solve in 1.2.x (UTC date a day ahead) is that board, not today’s', async () => {
    progressWith(1, 3)
    const tomorrow = addDays(TODAY, 1)
    stored.dailyDone = tomorrow
    const p = await boot()
    expect(p.dailyDoneToday()).toBe(false)
    expect(p.dailySolvedOn(tomorrow)).toBe(true)
    expect(p.streak()).toMatchObject({ current: 1, lastDay: tomorrow })
    // Today's own board is still there to play; it counts nothing twice.
    expect(p.recordDailyWin(TODAY).counted).toBe(false)
    expect(p.streak().current).toBe(1)
  })

  it('packs finished before 1.3.0 are not paid again on a replay', async () => {
    progressWith(1, 24)
    const p = await boot()
    const win = p.recordLevelWin(5, 3, 1)
    expect(win.pack).toBeNull()
  })

  it('meta written once is read back, not re-migrated', async () => {
    await boot()
    const hintsAfterFirst = hints
    await boot()
    expect(hints).toBe(hintsAfterFirst)
  })
})

describe('level wins', () => {
  it('only NEW stars go into the jar; a full jar reports how many opened', async () => {
    const p = await boot() // jar starts at 5
    expect(p.recordLevelWin(1, 2, 2)).toMatchObject({ gained: 2, jarBefore: JAR_START_NEW, jarAfter: 7, opened: 0 })
    // Replaying for a better score adds only the difference.
    expect(p.recordLevelWin(1, 3, 1).gained).toBe(1)
    // Replaying at the same score adds nothing.
    expect(p.recordLevelWin(1, 3, 1).gained).toBe(0)
    let opened = 0
    for (let g = 2; g <= 6; g++) opened += p.recordLevelWin(g, 3, 1).opened
    expect(opened).toBe(1)
    expect(p.jarStars()).toBe((8 + 15) % JAR_CAPACITY)
  })

  it('finishing a pack pays its reward exactly once, with the medal', async () => {
    progressWith(1, 23)
    stored.meta = JSON.stringify({ giftDay: TODAY })
    const p = await boot()
    const win = p.recordLevelWin(24, 3, 1)
    expect(win.pack).toMatchObject({ index: 0, medal: 'gold', reward: true })
    expect(p.recordLevelWin(24, 3, 1).pack).toBeNull()
  })

  it('Unlimited owners have no jar', async () => {
    unlimited = true
    const p = await boot()
    const before = p.jarStars()
    expect(p.recordLevelWin(1, 3, 1).opened).toBe(0)
    expect(p.jarStars()).toBe(before)
    expect(p.giftDue()).toBe(false)
  })
})

describe('daily challenge', () => {
  it('today’s solve counts toward the streak once; a past day only toward the month', async () => {
    const p = await boot()
    const first = p.recordDailyWin(TODAY)
    expect(first.counted).toBe(true)
    expect(first.streak).toBe(1)
    expect(p.dailyDoneToday()).toBe(true)
    expect(p.recordDailyWin(TODAY).counted).toBe(false)
    const past = addDays(TODAY, -3)
    const replay = p.recordDailyWin(past)
    expect(replay.counted).toBe(false)
    expect(p.dailySolvedOn(past)).toBe(true)
    expect(p.streak().current).toBe(1)
  })
})

describe('a board opened before midnight, solved after it', () => {
  it('counts for its own day when it was opened as today’s puzzle', async () => {
    progressWith(1, 2)
    const y = addDays(TODAY, -1)
    stored.meta = JSON.stringify({ streak: { current: 5, best: 5, lastDay: addDays(TODAY, -2) }, giftDay: TODAY })
    const p = await boot()
    // Boot already reconciled past a missed "yesterday" — no freezes, so broken…
    expect(p.streak().current).toBe(0)
    // …but the board for yesterday was opened before midnight: its solve counts
    // for yesterday, and the day is ticked, not missed.
    const win = p.recordDailyWin(y, true)
    expect(win.counted).toBe(true)
    expect(p.dailySolvedOn(y)).toBe(true)
  })

  // Opened at 23:58, backgrounded, resumed at 00:01: the foreground refreshDay()
  // reconciles the new day while the old one is still unsolved.
  for (const freezes of [0, 1]) {
    it(`survives a return to the foreground past midnight (${freezes} freeze${freezes === 1 ? '' : 's'})`, async () => {
      progressWith(1, 2)
      clockAt(new Date(2026, 8, 23, 23, 58))
      stored.meta = JSON.stringify({
        streak: { current: 5, best: 5, lastDay: '2026-09-22', freezes },
        giftDay: '2026-09-23',
      })
      const p = await boot()
      expect(p.dailyDoneToday()).toBe(false)
      clockAt(new Date(2026, 8, 24, 0, 1))
      p.refreshDay()
      const win = p.recordDailyWin('2026-09-23', true)
      expect(win).toMatchObject({ counted: true, streak: 6 })
      expect(p.streak()).toMatchObject({ current: 6, best: 6, freezes, lost: null, lastDay: '2026-09-23' })
      expect(p.repairOpen()).toBe(false)
      // The menu is not told about a break or a freeze that was taken back.
      expect(p.takeStreakNotice()).toBeNull()
    })
  }

  it('a calendar replay of yesterday never counts toward the streak', async () => {
    progressWith(1, 2)
    const p = await boot()
    expect(p.recordDailyWin(addDays(TODAY, -1), false).counted).toBe(false)
  })
})

describe('gift and safety nets', () => {
  it('the gift pays once a day', async () => {
    progressWith(1, 2)
    const p = await boot()
    expect(p.giftDue()).toBe(true)
    expect(p.claimGift(3)).toBe(true)
    expect(hints).toBe(3)
    expect(p.claimGift(3)).toBe(false)
    expect(hints).toBe(3)
    expect(p.giftDue()).toBe(false)
  })

  it('climbs 1, 2, 4, 6, 8 on days in a row, then starts over; a missed day resets it', async () => {
    progressWith(1, 2)
    const paid: number[] = []
    for (let d = 0; d < 7; d++) {
      clockAt(new Date(2026, 8, 10 + d, 10))
      const p = await boot()
      const gift = p.giftInfo()
      const before = hints
      expect(p.claimGift(gift.hints)).toBe(true)
      paid.push(hints - before)
    }
    expect(paid).toEqual([1, 2, 4, 6, 8, 1, 2])
    // The 17th goes by without a claim: the 18th is day 1 again.
    clockAt(new Date(2026, 8, 18, 10))
    const p = await boot()
    expect(p.giftInfo()).toEqual({ day: 1, hints: 1, next: { day: 2, hints: 2 } })
  })

  it('a second claim the same day pays nothing and does not climb', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({ giftDay: addDays(TODAY, -1), giftStreak: 2 })
    const p = await boot()
    expect(p.giftInfo()).toEqual({ day: 3, hints: 4, next: { day: 4, hints: 6 } })
    // The video's flat bonus rides on top of the rung; the climb is the same.
    expect(p.claimGift(4 + GIFT_AD_BONUS)).toBe(true)
    expect(hints).toBe(6)
    expect(p.claimGift(4)).toBe(false)
    expect(hints).toBe(6)
    expect(p.giftInfo()).toEqual({ day: 3, hints: 4, next: { day: 4, hints: 6 } })
    expect(JSON.parse(stored.meta!)).toMatchObject({ giftDay: TODAY, giftStreak: 3 })
  })

  it('a brand-new install’s pre-claimed gift is day 1: tomorrow pays 2', async () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const p = await boot()
    expect(p.giftDue()).toBe(false)
    expect(p.giftInfo()).toEqual({ day: 1, hints: 1, next: { day: 2, hints: 2 } })
    expect(hints).toBe(NEW_INSTALL_HINTS)
    clockAt(tomorrow)
    const next = await boot()
    expect(next.giftDue()).toBe(true)
    expect(next.giftInfo()).toMatchObject({ day: 2, hints: 2 })
  })

  it('an upgrade whose silent 1.2.x hint covered today starts the ladder tomorrow at day 1', async () => {
    progressWith(1, 3)
    stored.freeDate = new Date().toISOString().slice(0, 10)
    const p = await boot()
    expect(p.giftDue()).toBe(false)
    expect(p.giftInfo().next).toEqual({ day: 1, hints: 1 })
  })

  it('hands tomorrow’s rung to the reminders only once today’s gift is claimed', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({ giftDay: addDays(TODAY, -1), giftStreak: 1 })
    const p = await boot()
    p.syncReminders()
    expect(reminderFacts).toMatchObject({ giftTomorrow: null }) // unclaimed today: nothing is certain
    expect(p.claimGift(2)).toBe(true)
    expect(reminderFacts).toMatchObject({ giftTomorrow: { day: 3, hints: 4 } }) // the claim re-plans
    p.syncReminders()
    expect(reminderFacts).toMatchObject({ giftTomorrow: { day: 3, hints: 4 } })
  })

  it('never promises an Unlimited owner a gift', async () => {
    unlimited = true
    const p = await boot() // fresh install: today's gift pre-claimed
    p.syncReminders()
    expect(reminderFacts).toMatchObject({ giftTomorrow: null })
    expect(p.claimGift(1)).toBe(false)
  })

  it('a freeze costs 2 hints, and never goes past the cap', async () => {
    progressWith(1, 2)
    const p = await boot()
    hints = 5
    expect(p.buyFreeze()).toBe(true)
    expect(p.buyFreeze()).toBe(true)
    expect(hints).toBe(1)
    expect(p.buyFreeze()).toBe(false)
    expect(p.streak().freezes).toBe(2)
  })

  it('the no-ads nudge needs between-level ads that can actually come', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({ offers: { interstitials: 8 }, giftDay: TODAY })
    const p = await boot()
    expect(p.noAdsNudgeNow()).toBe(true)
    interstitials = false // consent withdrawn: there are none to remove
    expect(p.noAdsNudgeNow()).toBe(false)
  })

  it('one ad freeze a day', async () => {
    progressWith(1, 2)
    const p = await boot()
    expect(p.freezeAdOpen()).toBe(true)
    p.earnFreezeByAd()
    expect(p.freezeAdOpen()).toBe(false)
  })

  it('a broken streak repairs for hints within its window', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({
      streak: { current: 6, best: 6, lastDay: addDays(TODAY, -3), freezes: 0 },
      giftDay: TODAY,
    })
    const p = await boot()
    expect(p.streak().current).toBe(0)
    expect(p.repairOpen()).toBe(true)
    expect(p.lostStreak()).toBe(6)
    hints = 2
    expect(p.repairStreak('hints')).toBeNull() // costs 3
    hints = 3
    expect(p.repairStreak('hints')).toEqual({ streak: 6, bonusHints: 0, bonusFreezes: 0, milestoneDay: null })
    expect(hints).toBe(0)
    expect(p.streak().current).toBe(6)
    expect(p.repairOpen()).toBe(false)
    expect(p.repairStreak('ad')).toBeNull()
  })

  it('a repair that lands on a milestone pays it', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({
      streak: { current: 29, best: 29, lastDay: addDays(TODAY, -2), freezes: 0 },
      giftDay: TODAY,
    })
    const p = await boot()
    expect(p.recordDailyWin(TODAY).streak).toBe(1) // a new chain since the break
    expect(p.repairStreak('ad')).toEqual({ streak: 30, bonusHints: 5, bonusFreezes: 0, milestoneDay: 30 })
    expect(hints).toBe(5)
  })

  it('a repair onto day 7 pays its hints and its freeze', async () => {
    progressWith(1, 2)
    stored.meta = JSON.stringify({
      streak: { current: 6, best: 6, lastDay: addDays(TODAY, -2), freezes: 0 },
      giftDay: TODAY,
    })
    const p = await boot()
    p.recordDailyWin(TODAY)
    expect(p.repairStreak('ad')).toEqual({ streak: 7, bonusHints: 2, bonusFreezes: 1, milestoneDay: 7 })
    expect(hints).toBe(2)
    expect(p.streak().freezes).toBe(1)
  })
})
