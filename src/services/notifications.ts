import { Capacitor } from '@capacitor/core'
import type { ActionPerformed, LocalNotificationSchema } from '@capacitor/local-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { dayKey } from '../game/days'
import type { PlannedReminder } from '../game/reminders'
import { habitMinuteOf, planReminders, REMINDER_IDS } from '../game/reminders'

/**
 * Local reminders — "today's 67 is ready" (or tomorrow's gift rung), the streak
 * last call, and a lapse ladder that goes quiet after 30 days. The WHEN and WHAT live in the pure
 * planner (`game/reminders.ts`); this module is the platform side: the in-app
 * toggle, the OS permission, the soft "turn on reminders?" offer cadence, and
 * keeping exactly the planned set pending. Same pattern as haptics/review:
 * guarded, try/catch, never throws, a no-op anywhere but a native build.
 *
 * Every refresh cancels our ids and schedules the plan from scratch, so nothing
 * here tracks what is pending, and a refresh on every session start and every
 * change of game facts keeps the plan honest (no "your streak" for a streak
 * that is gone, no last call once today's daily is solved).
 *
 * THE footgun: since plugin 8.3.0, `schedule()` (and `update()`) pops the iOS
 * permission prompt by itself while permission is undecided. The prompt must
 * only ever follow the player's own tap on our offer (`enableReminders()`), so
 * `schedule()` is called ONLY after `checkPermissions()` said `granted` in the
 * same refresh, and `update()` is never used. services/notifications.test.ts
 * pins it.
 */

export type ReminderPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'
type Route = 'daily' | 'map' | 'menu'

// 'on' / 'off'; absent = the player has never been asked.
const REMINDERS_KEY = 'exactly67.reminders'
// JSON { count, last } — how often, and when last, the soft offer was shown.
const ASKS_KEY = 'exactly67.reminderAsks'
// JSON array of epoch ms: the last few session starts, for the habit time.
const SESSION_STARTS_KEY = 'exactly67.sessionStarts'

/** The soft offer is shown at most this many times, ever … */
const MAX_OFFERS = 3
/** … and never twice within three days. */
const OFFER_SPACING_MS = 3 * 24 * 60 * 60 * 1000
/** A level clear is an offer moment only for a 3★ clear from this global level on. */
const LEVEL_OFFER_MIN_GLOBAL = 5
/** Session starts kept (the planner takes the median of these). */
const SESSION_STARTS_KEPT = 7
/** A return within this long of the last recorded start is the same session (app-switcher flips). */
const SAME_SESSION_MS = 30 * 60 * 1000

let started = false
/** Prefs loaded: until then a refresh has nothing true to plan from. */
let ready = false
let toggle: 'on' | 'off' | null = null
let asks = { count: 0, last: 0 }
let sessionStarts: number[] = []
/** The OS answer from the last check; null until the first one. */
let osPermission: ReminderPermission | null = null
let context = { streak: 0, dailyDoneToday: false, nextLevel: 1, freezes: 0 }
/**
 * Tomorrow's gift rung, stamped with the local day it was true on: it promises
 * the day after THAT day only. A plan made on a later day (the app left open
 * across midnight, facts pushed by a caller that does not know the gift) must
 * not repeat it — an unclaimed day in between resets the ladder.
 */
let gift: { day: number; hints: number; on: string } | null = null

const native = (): boolean => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function readPref(key: string): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key })
    return value
  } catch {
    return null
  }
}

async function writePref(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value })
  } catch {
    // non-fatal: the setting just isn't remembered next launch
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function loadPrefs(): Promise<void> {
  const [rawToggle, rawAsks, rawStarts] = await Promise.all([
    readPref(REMINDERS_KEY),
    readPref(ASKS_KEY),
    readPref(SESSION_STARTS_KEY),
  ])
  toggle = rawToggle === 'on' || rawToggle === 'off' ? rawToggle : null

  const a = parseJson(rawAsks) as { count?: unknown; last?: unknown } | null
  const count = typeof a?.count === 'number' && Number.isFinite(a.count) ? Math.max(0, Math.floor(a.count)) : 0
  const last = typeof a?.last === 'number' && Number.isFinite(a.last) ? a.last : 0
  asks = { count, last }

  const s = parseJson(rawStarts)
  sessionStarts = Array.isArray(s)
    ? s.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).slice(-SESSION_STARTS_KEPT)
    : []
}

function toPermission(display: string | undefined): ReminderPermission {
  if (display === 'granted') return 'granted'
  if (display === 'denied') return 'denied'
  return 'prompt' // 'prompt' and Android's 'prompt-with-rationale': still undecided
}

/** Ask the OS (never prompts). Returns null when the plugin could not answer. */
async function checkOs(): Promise<ReminderPermission | null> {
  try {
    const { display } = await LocalNotifications.checkPermissions()
    osPermission = toPermission(display)
    return osPermission
  } catch {
    return null
  }
}

/** Where a tapped notification should land, or null when it is not a tap on one of ours. */
function routeOf(action: ActionPerformed): Route | null {
  if (!action || action.actionId === 'dismiss') return null
  const n = action.notification
  const route = (n?.extra as { route?: unknown } | undefined)?.route
  if (route === 'daily' || route === 'map' || route === 'menu') return route
  return (REMINDER_IDS as readonly number[]).includes(Number(n?.id)) ? 'daily' : null
}

function toNotification(r: PlannedReminder): LocalNotificationSchema {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    // An absolute instant (iOS: a one-shot time-interval trigger), so after a
    // flight it can land outside 09:00–21:00 of the new zone until the next
    // foreground re-plans. Not `schedule.on`, which would follow the zone: in
    // plugin 8.3.1 every `on` recurs (iOS hard-codes `repeats: true`; Android
    // re-arms it after firing, a year on) and Android reads `month` 0-based
    // where iOS reads it 1-based. A repeat or a month-late nudge is worse.
    schedule: { at: r.at },
    // One stack in Notification Center, however many land before the player returns.
    threadIdentifier: 'daily',
    interruptionLevel: r.interruptionLevel,
    extra: { route: r.route },
    // Android: inexact on purpose. The default (exact) opens the "Alarms &
    // reminders" settings screen on schedule() — never for a puzzle nudge.
    isExactNotification: false,
    // No `sound` (iOS stays silent without one) and no `badge`.
  }
}

async function cancelOurs(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) })
  } catch {
    // nothing pending, or the plugin is unavailable
  }
}

// ── serialised refreshes ─────────────────────────────────────────────────────
// Each refresh is cancel-then-schedule; two interleaved ones could leave a
// stale plan pending (a last call scheduled after the daily was solved), so
// they run one at a time, and calls that arrive while one is queued share it.
let chain: Promise<void> = Promise.resolve()
let queued: Promise<void> | null = null

function serial(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task).catch(() => {})
  chain = run
  return run
}

async function replan(): Promise<void> {
  if (!ready) return // init refreshes once the prefs are in
  const os = await checkOs()
  if (toggle !== 'on' || os !== 'granted') {
    await cancelOurs()
    return
  }
  await cancelOurs()
  try {
    // Yesterday's reminders are old news once the player is back.
    await LocalNotifications.removeAllDeliveredNotifications()
  } catch {
    // non-fatal
  }
  const now = new Date()
  const plan = planReminders({
    now,
    enabled: true,
    habitMinute: habitMinuteOf(sessionStarts),
    // Every refresh runs while the player is in the app, so "last seen" is now.
    lastSessionAt: now,
    ...context,
    giftTomorrow: gift && gift.on === dayKey(now) ? { day: gift.day, hints: gift.hints } : null,
  })
  if (plan.length === 0) return
  try {
    await LocalNotifications.schedule({ notifications: plan.map(toNotification) })
  } catch {
    // non-fatal: the next refresh tries again
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Boot: register the tap listener FIRST (a cold launch from a reminder delivers
 * its tap as soon as a listener exists — the plugin retains it until then), then
 * load the prefs, record this session start and plan. Call once, early in boot;
 * `onTap` may fire before any scene is up, so it should only record the route.
 */
export async function initNotifications(onTap: (route: Route) => void): Promise<void> {
  if (!native() || started) return
  started = true
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const route = routeOf(action)
      if (route) onTap(route)
    })
  } catch {
    // no listener: a tap still opens the app, just not on the right screen
  }
  await loadPrefs()
  ready = true
  noteSessionStart()
  await refreshReminders()
}

/**
 * The player is back (boot, or every return to the foreground): record the
 * start for the habit time. Returns within 30 min of the last one count as the
 * same session. Follow it with `refreshReminders()`.
 */
export function noteSessionStart(): void {
  if (!native() || !ready) return
  const now = Date.now()
  const last = sessionStarts[sessionStarts.length - 1]
  if (last !== undefined && now >= last && now - last < SAME_SESSION_MS) return
  sessionStarts = [...sessionStarts, now].slice(-SESSION_STARTS_KEPT)
  void writePref(SESSION_STARTS_KEY, JSON.stringify(sessionStarts))
}

/** The in-app toggle is on. (The OS permission may still have been revoked in Settings.) */
export function remindersEnabled(): boolean {
  return toggle === 'on'
}

/** The toggle was ever set, or the OS prompt has already been shown. */
export function remindersAsked(): boolean {
  return toggle !== null || osPermission === 'granted' || osPermission === 'denied'
}

/** The OS answer right now. Never prompts. */
export async function reminderPermission(): Promise<ReminderPermission> {
  if (!native()) return 'unsupported'
  return (await checkOs()) ?? 'unsupported'
}

/**
 * Is this a moment to show the soft "turn on reminders?" offer? Only on
 * device, only while neither the player (toggle) nor the OS (prompt shown) has
 * decided, at most 3 offers ever and 3 days apart. A daily clear always
 * qualifies; a level clear only when it is a 3★ clear from level 5 on.
 */
export function shouldOfferReminders(ctx: 'daily-clear' | 'level-clear', stars?: number, global?: number): boolean {
  if (!native() || !ready) return false
  if (toggle !== null) return false // on already, or the player switched them off
  if (osPermission !== 'prompt') return false // the OS prompt was shown (or we could not tell)
  if (asks.count >= MAX_OFFERS) return false
  if (asks.count > 0 && Date.now() - asks.last < OFFER_SPACING_MS) return false
  if (ctx === 'daily-clear') return true
  return stars === 3 && (global ?? 0) >= LEVEL_OFFER_MIN_GLOBAL
}

/** The offer was shown (whatever the answer): count it toward the cap and the spacing. */
export function noteReminderOffered(): void {
  if (!native()) return
  asks = { count: asks.count + 1, last: Date.now() }
  void writePref(ASKS_KEY, JSON.stringify(asks))
}

/**
 * Turn reminders on. ONLY from the player's tap (the offer's yes, or the
 * settings toggle): this is the one place the OS prompt may appear. True once
 * the OS granted and the plan is scheduled; false on a no, a previous no
 * (iOS answers `denied` without asking again), web, or any failure.
 */
export async function enableReminders(): Promise<boolean> {
  if (!native()) return false
  let granted = false
  try {
    const { display } = await LocalNotifications.requestPermissions()
    osPermission = toPermission(display)
    granted = osPermission === 'granted'
  } catch {
    return false
  }
  if (!granted) return false
  toggle = 'on'
  await writePref(REMINDERS_KEY, 'on')
  await refreshReminders()
  return true
}

/** Turn reminders off: remember the choice and cancel everything pending of ours. */
export async function disableReminders(): Promise<void> {
  if (!native()) return
  toggle = 'off'
  await writePref(REMINDERS_KEY, 'off')
  await serial(cancelOurs)
}

/**
 * The latest game facts for the planner. Keeps them in memory and, once the
 * module is up, re-plans when they changed (e.g. today's daily just got solved,
 * so tonight's last call has to go).
 */
export function setReminderContext(ctx: {
  streak: number
  dailyDoneToday: boolean
  nextLevel: number
  /** Streak freezes held; absent = 0. A freeze keeps the lapse copy from announcing a break that never came. */
  freezes?: number
  /**
   * Tomorrow's gift rung (progression.syncReminders knows it); null = nothing to
   * promise. ABSENT = unchanged, unlike the rest: a caller that does not know
   * the gift (a level win pushing the next level) must not wipe it.
   */
  giftTomorrow?: { day: number; hints: number } | null
}): void {
  const next = {
    streak: Number.isFinite(ctx.streak) ? Math.max(0, Math.floor(ctx.streak)) : 0,
    dailyDoneToday: ctx.dailyDoneToday === true,
    nextLevel: Number.isFinite(ctx.nextLevel) ? Math.max(1, Math.floor(ctx.nextLevel)) : 1,
    freezes: Number.isFinite(ctx.freezes) ? Math.max(0, Math.floor(ctx.freezes!)) : 0,
  }
  let nextGift = gift
  if (ctx.giftTomorrow !== undefined) {
    const g = ctx.giftTomorrow
    nextGift =
      g && Number.isInteger(g.day) && Number.isInteger(g.hints) && g.day >= 1 && g.hints >= 1
        ? { day: g.day, hints: g.hints, on: dayKey(new Date()) }
        : null
  }
  const changed =
    next.streak !== context.streak ||
    next.dailyDoneToday !== context.dailyDoneToday ||
    next.nextLevel !== context.nextLevel ||
    next.freezes !== context.freezes ||
    nextGift?.day !== gift?.day ||
    nextGift?.hints !== gift?.hints ||
    nextGift?.on !== gift?.on
  context = next
  gift = nextGift
  if (changed && ready) void refreshReminders()
}

/**
 * Re-plan: cancel ours, then — only with the toggle on AND the OS answering
 * `granted` right now — schedule the fresh plan and clear delivered reminders.
 * Never prompts (see the footgun above). Safe to call any time; concurrent
 * calls collapse into one.
 */
export function refreshReminders(): Promise<void> {
  if (!native()) return Promise.resolve()
  if (queued) return queued
  const run = serial(async () => {
    queued = null // later calls queue a fresh run that sees newer facts
    await replan()
  })
  queued = run
  return run
}
