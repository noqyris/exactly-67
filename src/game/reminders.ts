/**
 * Re-engagement reminders — the pure planner behind `services/notifications.ts`.
 *
 * Given what the game knows right now (when the player was last here, their
 * usual play time, their Daily Challenge streak), decide which local
 * notifications should be pending and exactly when. The service cancels ours
 * and re-schedules this plan on every refresh, so the plan is always computed
 * from scratch and nothing here has to remember what was scheduled before.
 *
 * The ladder, in local days from today:
 *   +1  6701  "today's puzzle is ready"   (streak copy while a 2+ streak is alive;
 *                                          every other day the gift's next rung, when promised)
 *    0  6799  streak last call at 21:00   (only a 3+ streak with today's daily not done)
 *   +2  6702  +3  6703                    (a lapsed streak just restarts — no guilt —
 *                                          unless freezes still hold it: then it is still standing)
 *   +7  6707  +14 6714  +30 6730          (passive: no sound, no screen wake)
 *   then silence, until the player comes back and the ladder restarts.
 *
 * Rules the plan always honours:
 *   - Quiet hours: only 09:00–21:00 local. Slots sit at the player's habit time
 *     (median start minute of their last 7 sessions, clamped; 18:30 by default).
 *   - Never within 12 h of the last session: a slot that close moves to 21:00
 *     of its day, or is dropped if even that is too close.
 *   - Never in the past or the next minute: iOS fires a past `at` immediately.
 *   - At most one reminder per calendar day, the streak last call excepted.
 *   - Copy rotates by the target day's number, so the same text never runs two
 *     days in a row; no app name in titles, never prices, ads or sales.
 *
 * Days are LOCAL calendar days (the Daily Challenge rolls over at the player's
 * midnight), and every date is built from local components
 * (`new Date(y, m, d + k, h, min)`) so a slot across a DST change still lands
 * at the same wall-clock time. Pure + framework-free, like the rest of
 * `src/game`: no Capacitor, no DOM.
 */

/** Every id this module can plan. The service cancels exactly these, never anyone else's. */
export const REMINDER_IDS = [6701, 6702, 6703, 6707, 6714, 6730, 6799] as const
export type ReminderId = (typeof REMINDER_IDS)[number]

export interface ReminderInput {
  now: Date
  /** In-app toggle on AND OS permission granted — the caller decides. */
  enabled: boolean
  /** Minutes after local midnight, from habitMinuteOf(); null = no history yet. */
  habitMinute: number | null
  lastSessionAt: Date
  /** Current daily streak (0 = none). */
  streak: number
  dailyDoneToday: boolean
  /** The "Level N" the player would continue at. */
  nextLevel: number
  /** Streak freezes held now (absent = 0). Each one covers one missed day. */
  freezes?: number
  /**
   * Tomorrow's rung of the daily-gift ladder — given only once today's gift is
   * claimed (a day without a claim resets the ladder to day 1) and never for an
   * Unlimited owner (no gift). Absent/null = nothing to promise.
   */
  giftTomorrow?: { day: number; hints: number } | null
}

export interface PlannedReminder {
  id: ReminderId
  at: Date
  title: string
  body: string
  interruptionLevel: 'active' | 'passive'
  route: 'daily' | 'map' | 'menu'
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Quiet hours: nothing before 09:00 … */
export const EARLIEST_MINUTE = 9 * 60
/** … and nothing after 21:00, local. */
export const LATEST_MINUTE = 21 * 60
/** Habit time for a player with no session history yet: 18:30. */
export const DEFAULT_HABIT_MINUTE = 18 * 60 + 30
/** How many recent session starts the habit time is the median of. */
export const HABIT_SAMPLES = 7
/** No regular reminder closer than this to the last session. */
const MIN_GAP_MS = 12 * HOUR_MS
/** The streak last call needs this much distance from the last session. */
const LAST_CALL_GAP_MS = 4 * HOUR_MS
/** The last call's slot: 21:00, three hours before the midnight deadline. */
const LAST_CALL_MINUTE = 21 * 60
/** Anything sooner than this is dropped — a past `at` fires at once on iOS. */
const LEAD_MS = MINUTE_MS

/** A daily streak must be at least this long before its copy mentions it. */
const STREAK_COPY_MIN = 2
/** … and at least this long to earn a last call on the day it would break. */
const LAST_CALL_MIN_STREAK = 3

type Copy = readonly [title: string, body: string]

// Placeholders: {n} streak, {n1} streak + 1, {next} the level to continue at,
// {gd} the gift's ladder day tomorrow, {gh} its hints.
const COPY = {
  fresh: [
    ["Today's 67 is ready", 'A fresh board just dropped. Can you balance it?'],
    ['New puzzle, same magic number', 'Fill the pan to exactly 67.'],
    ['The scale is wobbling', "Today's puzzle needs someone to level it."],
  ],
  streak: [
    ['Day {n1} is waiting', 'Your {n}-day streak and a fresh puzzle, all set.'],
    ['{n} days level. Make it {n1}?', "Today's 67 is ready when you are."],
    ['The flame wants feeding', 'A new board is ready. Balance it to 67.'],
  ],
  // Missed days all covered by freezes: the streak survived, and today's solve
  // makes it {n1} (a frozen day bridges, never adds). Count-free on purpose:
  // one freeze or two may have been spent by the time it fires.
  kept: [
    ['Frozen, not broken', 'Your {n}-day streak is still alive. Make it {n1} today.'],
    ['Your {n}-day streak held', "Frozen while you were away. Today's 67 keeps it going."],
  ],
  // Tomorrow's gift, mixed into 6701 only: it is the one slot where the rung is
  // still true. Streak-neutral, so it holds whatever the streak does meanwhile.
  gift: [
    ['Day {gd} gift: {gh} hints', "Open today's gift, then balance today's 67."],
    ['Your gift grew to {gh} hints', "Day {gd} of the daily gift, and a fresh 67 to balance."],
    ['{gh} hints are waiting', 'Your day-{gd} gift is ready. Come and take it.'],
  ],
  lastCall: [
    ["A few hours left on today's 67", 'Keep your {n}-day streak level.'],
    ['Your {n}-day streak is still standing', 'One quick puzzle keeps it that way.'],
  ],
  day2: [
    ['New day, new 67', "Today's puzzle is ready for you."],
    ['Balloons up, weights down', "Today's 67 is waiting."],
  ],
  day3: [
    ['Fresh start, fresh 67', "Start a new streak with today's puzzle."],
    ['Every streak starts at 1', "Today's board is a good one."],
  ],
  day7: [
    ['The scale kept your spot', 'New puzzles every day. Drop in anytime.'],
    ['Still exactly 67', "Some things never change. Today's puzzle is ready."],
  ],
  day14: [
    ['Got a minute and a pan?', 'Level {next} is right where you left it.'],
    ['600 levels, one number', 'Pick up at level {next}.'],
  ],
  day30: [
    ["We'll stop the reminders here", 'The scale stays level for you. Come back anytime.'],
    ['Last nudge, promise', "Today's 67 will be here whenever you are."],
  ],
} as const satisfies Record<string, readonly Copy[]>

interface Rung {
  id: ReminderId
  dayOffset: number
  copy: readonly Copy[]
  interruptionLevel: 'active' | 'passive'
  route: 'daily' | 'map' | 'menu'
}

/** The lapse ladder after day +1 (6701 is built separately: its copy depends on the streak). */
const LADDER: readonly Rung[] = [
  { id: 6702, dayOffset: 2, copy: COPY.day2, interruptionLevel: 'active', route: 'daily' },
  { id: 6703, dayOffset: 3, copy: COPY.day3, interruptionLevel: 'active', route: 'daily' },
  { id: 6707, dayOffset: 7, copy: COPY.day7, interruptionLevel: 'passive', route: 'daily' },
  { id: 6714, dayOffset: 14, copy: COPY.day14, interruptionLevel: 'passive', route: 'map' },
  { id: 6730, dayOffset: 30, copy: COPY.day30, interruptionLevel: 'passive', route: 'daily' },
]

function clampMinute(minute: number): number {
  return Math.min(LATEST_MINUTE, Math.max(EARLIEST_MINUTE, Math.round(minute)))
}

/**
 * The player's habit time: the median local start minute of their last 7
 * sessions, clamped into quiet hours. `null` when there is no history, so the
 * planner falls back to 18:30. A median, not a mean, so one 3 a.m. insomnia
 * session does not drag the reminder away from the evening they usually play.
 */
export function habitMinuteOf(recentStarts: number[]): number | null {
  const minutes = recentStarts
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .slice(-HABIT_SAMPLES)
    .map((t) => {
      const d = new Date(t)
      return d.getHours() * 60 + d.getMinutes()
    })
    .sort((a, b) => a - b)
  if (minutes.length === 0) return null
  const mid = minutes.length >> 1
  const median = minutes.length % 2 === 1 ? minutes[mid] : (minutes[mid - 1] + minutes[mid]) / 2
  return clampMinute(median)
}

/** `minute` past local midnight, `k` local days after `today` — DST-safe. */
function localAt(today: Date, k: number, minute: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + k, Math.floor(minute / 60), minute % 60)
}

/** A day counter for a local calendar date, independent of DST and time zone. */
function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

/** The variant for `day`: consecutive days always differ (every pool has 2+). */
function pick(copy: readonly Copy[], day: Date): Copy {
  return copy[dayNumber(day) % copy.length]
}

const PLACEHOLDER = /\{(n1|n|next|gd|gh)\}/g

function fill(text: string, i: ReminderInput): string {
  const values: Record<string, number> = {
    n: i.streak,
    n1: i.streak + 1,
    next: i.nextLevel,
    gd: i.giftTomorrow?.day ?? 0,
    gh: i.giftTomorrow?.hints ?? 0,
  }
  return text.replace(PLACEHOLDER, (_, key: string) => String(values[key]))
}

/**
 * Tomorrow's gift is worth a mention only from day 2 up: that is the climb the
 * player keeps by coming back ("grew to 4 hints"), and every variant says
 * "hints". A ladder starting over at 1 hint is no news.
 */
function giftPromised(i: ReminderInput): boolean {
  const g = i.giftTomorrow
  return !!g && Number.isInteger(g.day) && Number.isInteger(g.hints) && g.day >= 2 && g.hints >= 2
}


/**
 * Where a regular slot actually lands, or null to drop it: at habit time,
 * pushed to 21:00 when habit time is within 12 h of the last session, and
 * never sooner than a minute from now.
 */
function placeSlot(today: Date, k: number, habit: number, last: number, now: number): Date | null {
  let at = localAt(today, k, habit)
  if (at.getTime() - last < MIN_GAP_MS) {
    at = localAt(today, k, LATEST_MINUTE)
    if (at.getTime() - last < MIN_GAP_MS) return null
  }
  return at.getTime() < now + LEAD_MS ? null : at
}

/** The reminders that should be pending right now, soonest first. [] when disabled. */
export function planReminders(i: ReminderInput): PlannedReminder[] {
  const now = i.now.getTime()
  if (!i.enabled || !Number.isFinite(now)) return []
  const lastRaw = i.lastSessionAt.getTime()
  const last = Number.isFinite(lastRaw) ? lastRaw : now
  const habit = clampMinute(i.habitMinute ?? DEFAULT_HABIT_MINUTE)
  const freezes = Number.isFinite(i.freezes) ? Math.max(0, Math.floor(i.freezes!)) : 0
  const today = i.now
  const plan: PlannedReminder[] = []

  /**
   * The copy for a slot `k` days out. By the time it fires the streak has
   * missed k days, or k − 1 when today's daily is done (day k itself is still
   * open). reconcile() spends one freeze per missed day and never covers part
   * of a gap, so the streak is still alive then exactly when missed ≤ freezes —
   * and while it is, fresh-start copy ("start a new streak") would be a lie.
   */
  const copyFor = (k: number, broken: readonly Copy[]): readonly Copy[] => {
    const missed = i.dailyDoneToday ? k - 1 : k
    if (i.streak < STREAK_COPY_MIN || missed > freezes) return broken
    return missed === 0 ? COPY.streak : COPY.kept
  }

  const add = (id: ReminderId, at: Date, copy: Copy, rung: Pick<Rung, 'interruptionLevel' | 'route'>): void => {
    plan.push({
      id,
      at,
      title: fill(copy[0], i),
      body: fill(copy[1], i),
      interruptionLevel: rung.interruptionLevel,
      route: rung.route,
    })
  }

  // 6799 — the streak last call. Tonight at 21:00, three hours before the
  // streak breaks at midnight; only for a streak worth saving that today's
  // daily has not already saved, and never right after the player was here.
  if (i.streak >= LAST_CALL_MIN_STREAK && !i.dailyDoneToday) {
    const at = localAt(today, 0, LAST_CALL_MINUTE)
    if (at.getTime() - last >= LAST_CALL_GAP_MS && at.getTime() >= now + LEAD_MS) {
      add(6799, at, pick(COPY.lastCall, at), { interruptionLevel: 'active', route: 'daily' })
    }
  }

  // 6701 — tomorrow's puzzle. The streak copy only while the streak will still
  // be alive tomorrow (today's daily is done, or a freeze covers today):
  // otherwise, by the time this fires the streak has broken and "your 5-day
  // streak" would be a lie. Tomorrow's gift rung is interleaved with that copy
  // — it is true only for tomorrow, so no later rung ever names it: by day +2
  // an unclaimed day has reset the ladder. Whenever a rung is promised the
  // reminder IS about the gift (the owner's ask: the push names the hint
  // streak), and a tap lands on the menu, where the gift card opens.
  const tomorrow = placeSlot(today, 1, habit, last, now)
  if (tomorrow) {
    if (giftPromised(i)) add(6701, tomorrow, pick(COPY.gift, tomorrow), { interruptionLevel: 'active', route: 'menu' })
    else add(6701, tomorrow, pick(copyFor(1, COPY.fresh), tomorrow), { interruptionLevel: 'active', route: 'daily' })
  }

  for (const rung of LADDER) {
    const at = placeSlot(today, rung.dayOffset, habit, last, now)
    if (at) add(rung.id, at, pick(copyFor(rung.dayOffset, rung.copy), at), rung)
  }

  return plan.sort((a, b) => a.at.getTime() - b.at.getTime())
}
