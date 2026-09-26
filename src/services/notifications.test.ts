import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planReminders, REMINDER_IDS } from '../game/reminders'

/**
 * The reminder service is where a mistake reaches the player's lock screen, and
 * the costly ones are silent in a browser (where the whole module no-ops):
 *   - since plugin 8.3.0 `schedule()` pops the iOS permission prompt on its own
 *     while permission is undecided, so one refresh at boot would ask every new
 *     player cold, before they ever saw our offer;
 *   - Android's exact-alarm default opens a settings screen on schedule();
 *   - a stale plan left pending (a "last call" after the daily was solved).
 * The plugin, Preferences and the platform check are doubled here so a test can
 * look like an iPhone and watch exactly which native calls go out, in order.
 */

// Local wall-clock assertions below: pin the zone like the planner suite does.
process.env.TZ = 'Europe/Belgrade'

const S = vi.hoisted(() => ({
  native: true,
  /** What checkPermissions() answers. */
  display: 'prompt' as string,
  /** What the OS prompt answers when requestPermissions() shows it. */
  answer: 'granted' as string,
  scheduleFails: false,
  calls: [] as string[],
  scheduled: [] as Array<Record<string, any>>,
  scheduleCount: 0,
  cancelled: [] as number[][],
  listener: null as null | ((action: unknown) => void),
  prefs: new Map<string, string>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => S.native, getPlatform: () => (S.native ? 'ios' : 'web') },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      S.calls.push('prefs.get')
      return { value: S.prefs.get(key) ?? null }
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      S.prefs.set(key, value)
    },
  },
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: async (event: string, fn: (action: unknown) => void) => {
      S.calls.push(`addListener:${event}`)
      S.listener = fn
      return { remove: async () => {} }
    },
    checkPermissions: async () => {
      S.calls.push('checkPermissions')
      return { display: S.display }
    },
    requestPermissions: async () => {
      S.calls.push('requestPermissions')
      if (S.display === 'prompt') S.display = S.answer
      return { display: S.display }
    },
    schedule: async ({ notifications }: { notifications: Array<Record<string, any>> }) => {
      S.calls.push('schedule')
      if (S.scheduleFails) throw new Error('schedule failed')
      S.scheduled = notifications
      S.scheduleCount++
      return { notifications: notifications.map((n) => ({ id: n.id })) }
    },
    update: async () => {
      S.calls.push('update')
      return { notifications: [] }
    },
    cancel: async ({ notifications }: { notifications: Array<{ id: number }> }) => {
      S.calls.push('cancel')
      S.cancelled.push(notifications.map((n) => n.id))
    },
    removeAllDeliveredNotifications: async () => {
      S.calls.push('removeAllDelivered')
    },
  },
}))

type Service = typeof import('./notifications')

/** A fresh module (fresh in-memory state) booted against the given stored prefs. */
async function boot(prefs: Record<string, string> = {}): Promise<{ m: Service; taps: string[] }> {
  for (const [k, v] of Object.entries(prefs)) S.prefs.set(k, v)
  const m = await import('./notifications')
  const taps: string[] = []
  await m.initNotifications((route) => taps.push(route))
  return { m, taps }
}

const ON = { 'exactly67.reminders': 'on' }
const scheduledIds = () => S.scheduled.map((n) => n.id as number)
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 23, 12, 0)) // Wed 23 Sep 2026, noon in Belgrade
  Object.assign(S, {
    native: true,
    display: 'prompt',
    answer: 'granted',
    scheduleFails: false,
    calls: [],
    scheduled: [],
    scheduleCount: 0,
    cancelled: [],
    listener: null,
  })
  S.prefs.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the permission footgun (schedule() prompts while undecided)', () => {
  it('never schedules and never prompts while permission is undecided, even with the toggle on', async () => {
    const { m } = await boot(ON)
    m.setReminderContext({ streak: 5, dailyDoneToday: false, nextLevel: 12 })
    await m.refreshReminders()
    await m.refreshReminders()
    expect(S.calls).toContain('checkPermissions')
    expect(S.calls).not.toContain('schedule')
    expect(S.calls).not.toContain('update')
    expect(S.calls).not.toContain('requestPermissions')
    expect(S.cancelled.at(-1)).toEqual([...REMINDER_IDS])
  })

  it('never schedules once the OS said no', async () => {
    S.display = 'denied'
    const { m } = await boot(ON)
    await m.refreshReminders()
    expect(S.calls).not.toContain('schedule')
    expect(S.calls).not.toContain('requestPermissions')
  })

  it('prompts only from enableReminders(), and schedules after a yes', async () => {
    const { m } = await boot()
    expect(S.calls).not.toContain('requestPermissions')
    expect(await m.enableReminders()).toBe(true)
    expect(S.calls.filter((c) => c === 'requestPermissions')).toHaveLength(1)
    expect(S.prefs.get('exactly67.reminders')).toBe('on')
    expect(m.remindersEnabled()).toBe(true)
    expect(S.calls.indexOf('schedule')).toBeGreaterThan(S.calls.indexOf('requestPermissions'))
    expect(scheduledIds().length).toBeGreaterThan(0)
  })

  it('a no leaves reminders off, schedules nothing, and stops further offers', async () => {
    S.answer = 'denied'
    const { m } = await boot()
    expect(m.shouldOfferReminders('daily-clear')).toBe(true)
    expect(await m.enableReminders()).toBe(false)
    expect(S.calls).not.toContain('schedule')
    expect(S.prefs.has('exactly67.reminders')).toBe(false)
    expect(m.remindersEnabled()).toBe(false)
    expect(m.remindersAsked()).toBe(true)
    expect(m.shouldOfferReminders('daily-clear')).toBe(false)
    expect(await m.reminderPermission()).toBe('denied')
  })
})

describe('scheduling', () => {
  it('schedules the plan with the safe options, after cancelling ours', async () => {
    S.display = 'granted'
    await boot(ON)
    expect(S.calls.indexOf('cancel')).toBeLessThan(S.calls.indexOf('schedule'))
    expect(S.calls).toContain('removeAllDelivered')
    expect(scheduledIds()).toEqual([6701, 6702, 6703, 6707, 6714, 6730])
    const soon = Date.now() + 60_000
    for (const n of S.scheduled) {
      expect(REMINDER_IDS).toContain(n.id)
      expect(n.isExactNotification).toBe(false)
      expect(n.threadIdentifier).toBe('daily')
      expect(['active', 'passive']).toContain(n.interruptionLevel)
      expect(['daily', 'map']).toContain(n.extra.route)
      expect(n).not.toHaveProperty('sound')
      expect(n).not.toHaveProperty('badge')
      expect(n).not.toHaveProperty('isExactMandatory')
      expect(n.schedule.at).toBeInstanceOf(Date)
      expect(n.schedule.at.getTime()).toBeGreaterThanOrEqual(soon)
      // A one-shot instant and nothing else: plugin 8.3.1 turns any `on` into a
      // recurring trigger (iOS `repeats: true`, Android re-arms), and `repeats`
      // would re-send a reminder forever.
      expect(Object.keys(n.schedule)).toEqual(['at'])
    }
  })

  it('cancels every reminder id and schedules nothing with the toggle never set or off', async () => {
    S.display = 'granted'
    await boot()
    expect(S.calls).not.toContain('schedule')
    expect(S.cancelled.at(-1)).toEqual([...REMINDER_IDS])

    vi.resetModules()
    S.calls = []
    S.prefs.clear()
    await boot({ 'exactly67.reminders': 'off' })
    expect(S.calls).not.toContain('schedule')
    expect(S.calls).toContain('cancel')
  })

  it('disableReminders() remembers "off" and cancels every reminder id', async () => {
    S.display = 'granted'
    const { m } = await boot(ON)
    S.calls = []
    await m.disableReminders()
    expect(S.prefs.get('exactly67.reminders')).toBe('off')
    expect(m.remindersEnabled()).toBe(false)
    expect(S.cancelled.at(-1)).toEqual([...REMINDER_IDS])
    await m.refreshReminders()
    expect(S.calls).not.toContain('schedule')
  })

  it('re-plans when the game facts change: solving the daily takes tonight’s last call away', async () => {
    S.display = 'granted'
    const { m } = await boot(ON)
    m.setReminderContext({ streak: 5, dailyDoneToday: false, nextLevel: 30 })
    await m.refreshReminders()
    expect(scheduledIds()).toContain(6799)
    expect(S.scheduled.find((n) => n.id === 6799)!.body + S.scheduled.find((n) => n.id === 6799)!.title).toContain(
      '5-day streak',
    )

    const before = S.scheduleCount
    m.setReminderContext({ streak: 6, dailyDoneToday: true, nextLevel: 30 })
    m.setReminderContext({ streak: 6, dailyDoneToday: true, nextLevel: 31 })
    await m.refreshReminders()
    expect(S.scheduleCount).toBe(before + 1) // three requests, one re-plan with the newest facts
    expect(scheduledIds()).not.toContain(6799)
    expect(S.scheduled.find((n) => n.id === 6714)!.body).toMatch(/31/)
  })

  it('re-plans when the freezes change, so the lapse copy never announces a break a freeze prevents', async () => {
    S.display = 'granted'
    const { m } = await boot(ON)
    const text = (id: number) => {
      const n = S.scheduled.find((s) => s.id === id)!
      return `${n.title} ${n.body}`
    }
    m.setReminderContext({ streak: 5, dailyDoneToday: true, nextLevel: 30 })
    await m.refreshReminders()
    expect(text(6702)).not.toMatch(/5-day streak/) // no freeze: broken by day +2

    const before = S.scheduleCount
    m.setReminderContext({ streak: 5, dailyDoneToday: true, nextLevel: 30, freezes: 2 })
    await m.refreshReminders()
    expect(S.scheduleCount).toBe(before + 1)
    expect(text(6702)).toMatch(/5-day streak/)
    expect(text(6703)).toMatch(/5-day streak/)
    expect(text(6703)).not.toMatch(/new streak|starts at 1|fresh start/i)

    // Nonsense reads as none, and an unchanged context does not re-plan.
    m.setReminderContext({ streak: 5, dailyDoneToday: true, nextLevel: 30, freezes: NaN })
    await m.refreshReminders()
    expect(text(6702)).not.toMatch(/5-day streak/)
    S.calls = []
    m.setReminderContext({ streak: 5, dailyDoneToday: true, nextLevel: 30, freezes: -1 })
    m.setReminderContext({ streak: 5, dailyDoneToday: true, nextLevel: 30 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(S.calls).toEqual([])
  })

  it('names tomorrow’s gift only on the day it was true, and keeps it through callers that do not know it', async () => {
    const GIFT = /gift|hints/i
    const facts = { streak: 0, dailyDoneToday: false }
    const gift = { day: 3, hints: 4 }
    /** A noon from `day` on whose 6701 (tomorrow) rotates onto a gift variant — asked of the planner itself. */
    const giftNoon = (day: number): Date => {
      for (let d = day; d < day + 7; d++) {
        const now = new Date(2026, 8, d, 12)
        const plan = planReminders({ now, enabled: true, habitMinute: null, lastSessionAt: now, ...facts, nextLevel: 1, giftTomorrow: gift })
        const r = plan.find((n) => n.id === 6701)!
        if (GIFT.test(`${r.title} ${r.body}`)) return now
      }
      throw new Error('no gift day in a week')
    }
    const text6701 = () => {
      const n = S.scheduled.find((x) => x.id === 6701)!
      return `${n.title} ${n.body}`
    }

    S.display = 'granted'
    const first = giftNoon(23)
    vi.setSystemTime(first)
    const { m } = await boot(ON)
    m.setReminderContext({ ...facts, nextLevel: 5, giftTomorrow: gift })
    await m.refreshReminders()
    expect(text6701()).toMatch(/\b4 hints\b/)

    // A caller that does not know the gift (a level win) leaves it alone …
    m.setReminderContext({ ...facts, nextLevel: 6 })
    await m.refreshReminders()
    expect(text6701()).toMatch(/\b4 hints\b/)
    // … and null takes it away.
    m.setReminderContext({ ...facts, nextLevel: 6, giftTomorrow: null })
    await m.refreshReminders()
    expect(text6701()).not.toMatch(GIFT)

    // Pushed yesterday and never refreshed since: an unclaimed day in between
    // has reset the ladder, so a later plan does not repeat the promise.
    m.setReminderContext({ ...facts, nextLevel: 6, giftTomorrow: gift })
    await m.refreshReminders()
    vi.setSystemTime(giftNoon(first.getDate() + 1))
    m.setReminderContext({ ...facts, nextLevel: 7 })
    await m.refreshReminders()
    expect(text6701()).not.toMatch(GIFT)

    // Nonsense reads as none.
    m.setReminderContext({ ...facts, nextLevel: 7, giftTomorrow: { day: Number.NaN, hints: 4 } })
    await m.refreshReminders()
    expect(text6701()).not.toMatch(GIFT)
  })

  it('plans at the player’s habit time from the recorded session starts', async () => {
    S.display = 'granted'
    const evenings = [1, 2, 3, 4, 5, 6, 7].map((d) => new Date(2026, 8, 10 + d, 20, 15).getTime())
    vi.setSystemTime(new Date(2026, 8, 23, 8, 0))
    await boot({ ...ON, 'exactly67.sessionStarts': JSON.stringify(evenings) })
    const stored = JSON.parse(S.prefs.get('exactly67.sessionStarts')!) as number[]
    expect(stored).toHaveLength(7)
    expect(stored.at(-1)).toBe(Date.now()) // this session, the oldest one dropped
    const at: Date = S.scheduled.find((n) => n.id === 6702)!.schedule.at
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([25, 20, 15])
  })

  it('treats a return within 30 minutes as the same session', async () => {
    const { m } = await boot()
    const first = JSON.parse(S.prefs.get('exactly67.sessionStarts')!) as number[]
    vi.setSystemTime(Date.now() + 10 * 60 * 1000)
    m.noteSessionStart()
    expect(JSON.parse(S.prefs.get('exactly67.sessionStarts')!)).toEqual(first)
    vi.setSystemTime(Date.now() + 25 * 60 * 1000)
    m.noteSessionStart()
    expect(JSON.parse(S.prefs.get('exactly67.sessionStarts')!)).toHaveLength(first.length + 1)
  })

  it('never throws when the plugin fails', async () => {
    S.display = 'granted'
    S.scheduleFails = true
    const { m } = await boot(ON)
    await expect(m.refreshReminders()).resolves.toBeUndefined()
    await expect(m.enableReminders()).resolves.toBe(true)
  })
})

describe('tapping a reminder', () => {
  it('registers the tap listener before anything else, then routes by extra.route', async () => {
    const { taps } = await boot()
    expect(S.calls[0]).toBe('addListener:localNotificationActionPerformed')
    const tap = (notification: unknown, actionId = 'tap') => S.listener!({ actionId, notification })
    tap({ id: 6714, extra: { route: 'map' } })
    tap({ id: 6701, extra: { route: 'daily' } })
    tap({ id: 6799 }) // ours, no route: the daily is the safe landing
    tap({ id: 6701, extra: { route: 'map' } }, 'dismiss')
    tap({ id: 1234, extra: {} }) // not ours
    expect(taps).toEqual(['map', 'daily', 'daily'])
  })
})

describe('the soft offer', () => {
  it('offers after a daily clear, or a 3★ level clear from level 5', async () => {
    const { m } = await boot()
    expect(m.shouldOfferReminders('daily-clear')).toBe(true)
    expect(m.shouldOfferReminders('level-clear', 3, 5)).toBe(true)
    expect(m.shouldOfferReminders('level-clear', 2, 40)).toBe(false)
    expect(m.shouldOfferReminders('level-clear', 3, 4)).toBe(false)
    expect(m.shouldOfferReminders('level-clear')).toBe(false)
  })

  it('offers at most 3 times, at least 3 days apart, and remembers it', async () => {
    const { m } = await boot()
    for (let i = 1; i <= 3; i++) {
      expect(m.shouldOfferReminders('daily-clear')).toBe(true)
      m.noteReminderOffered()
      expect(JSON.parse(S.prefs.get('exactly67.reminderAsks')!)).toEqual({ count: i, last: Date.now() })
      vi.setSystemTime(Date.now() + 3 * DAY - 60_000)
      expect(m.shouldOfferReminders('daily-clear')).toBe(false)
      vi.setSystemTime(Date.now() + 60_000)
    }
    expect(m.shouldOfferReminders('daily-clear')).toBe(false)

    // The cap survives a relaunch.
    vi.resetModules()
    vi.setSystemTime(Date.now() + 30 * DAY)
    const again = await boot()
    expect(again.m.shouldOfferReminders('daily-clear')).toBe(false)
  })

  it('never offers once the player or the OS has decided', async () => {
    S.display = 'granted'
    expect((await boot()).m.shouldOfferReminders('daily-clear')).toBe(false)

    vi.resetModules()
    S.display = 'prompt'
    expect((await boot({ 'exactly67.reminders': 'off' })).m.shouldOfferReminders('daily-clear')).toBe(false)

    vi.resetModules()
    S.prefs.clear()
    const on = await boot(ON)
    expect(on.m.remindersAsked()).toBe(true)
    expect(on.m.shouldOfferReminders('daily-clear')).toBe(false)
  })
})

describe('off device', () => {
  it('is a silent no-op in a browser', async () => {
    S.native = false
    const { m } = await boot(ON)
    m.setReminderContext({ streak: 9, dailyDoneToday: false, nextLevel: 3 })
    await m.refreshReminders()
    m.noteSessionStart()
    m.noteReminderOffered()
    expect(m.shouldOfferReminders('daily-clear')).toBe(false)
    expect(await m.reminderPermission()).toBe('unsupported')
    expect(await m.enableReminders()).toBe(false)
    await m.disableReminders()
    expect(S.calls.filter((c) => c !== 'prefs.get')).toEqual([])
    expect(S.prefs.get('exactly67.reminders')).toBe('on') // untouched
  })
})
