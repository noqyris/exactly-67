import { addDays, daysBetween } from './days'

/**
 * The Daily Challenge streak — consecutive local days with the day's puzzle
 * solved (hints allowed). The retention engine: a streak is the one mechanic the
 * logic-puzzle leaders (NYT Games, Easybrain) all share, and Duolingo's data on
 * it is the strongest there is (+14% D7 from the streak wager; users on a 7-day
 * streak 2.4x as likely to come back). See docs/RETENTION.md.
 *
 * Safety nets come BEFORE they are needed, never sold at the moment of loss:
 *   - freezes: hold up to 2; one is spent automatically per missed day. Earned
 *     free on day 3 and every 7th day, +1 a day by rewarded ad, or bought for
 *     hints. A frozen day keeps the streak alive but does not add to it.
 *   - repair: when a streak breaks with no freeze left, it can be restored for
 *     REPAIR_WINDOW_DAYS (an ad or hints), at most once per REPAIR_COOLDOWN_DAYS.
 *
 * Pure: day keys in, a new object out (inputs are never mutated).
 */

export const MAX_FREEZES = 2
/** The day the break is noticed plus the next one: roughly 48 hours. */
export const REPAIR_WINDOW_DAYS = 2
export const REPAIR_COOLDOWN_DAYS = 30
export const REPAIR_HINT_COST = 3
export const FREEZE_HINT_COST = 2

export interface Streak {
  /** Consecutive days, counting solves only (frozen days bridge, never add). */
  current: number
  best: number
  /** Last day that keeps the chain: solved, or covered by a freeze. */
  lastDay: string | null
  freezes: number
  /** A broken streak that may still be repaired, and the day it broke. */
  lost: { streak: number; day: string } | null
  lastRepair: string | null
  /** Day a freeze was last earned by rewarded ad (one per day). */
  freezeAdDay: string | null
}

export function emptyStreak(): Streak {
  return { current: 0, best: 0, lastDay: null, freezes: 0, lost: null, lastRepair: null, freezeAdDay: null }
}

export type ReconcileEvent =
  | { kind: 'none' }
  | { kind: 'frozen'; days: number }
  | { kind: 'broken'; lost: number }

/**
 * Bring the streak up to `today`: spend freezes on the days missed since the
 * last kept day, or break it when there are not enough. Call before showing or
 * changing the streak (idempotent for the same `today`). A partial cover never
 * happens: either every missed day is frozen, or the streak breaks and the
 * freezes are kept for the next one.
 */
export function reconcile(s: Streak, today: string): { streak: Streak; event: ReconcileEvent } {
  let next = { ...s }
  // An unrepaired break stops being repairable once its window has passed.
  if (next.lost && daysBetween(next.lost.day, today) >= REPAIR_WINDOW_DAYS) next.lost = null
  if (next.current === 0 || next.lastDay === null) return { streak: next, event: { kind: 'none' } }
  const gap = daysBetween(next.lastDay, today)
  if (gap <= 1) return { streak: next, event: { kind: 'none' } }
  const missed = gap - 1
  if (missed <= next.freezes) {
    next = { ...next, freezes: next.freezes - missed, lastDay: addDays(today, -1) }
    return { streak: next, event: { kind: 'frozen', days: missed } }
  }
  next = { ...next, lost: { streak: next.current, day: today }, current: 0 }
  return { streak: next, event: { kind: 'broken', lost: s.current } }
}

/**
 * Undo what a reconcile against the day AFTER `day` did to `day` itself. For a
 * board opened as "today's puzzle" before midnight and solved after it: when the
 * app came back to the foreground in between, the new day's reconcile already
 * counted `day` as missed. A break caused by missing exactly `day` is lifted
 * (the lost streak comes back, nothing to repair), and a freeze spent on `day`
 * is refunded — so the solve that follows counts, and no safety net is used up
 * on a day that was played. Call before recordSolve(…, day). `daySolved`: `day`
 * was solved before now, so its place in the chain is a solve, not a freeze.
 * `undone` names what was reversed ('none' when nothing was).
 */
export function reopenDay(s: Streak, day: string, daySolved: boolean): { streak: Streak; undone: ReconcileEvent['kind'] } {
  const before = addDays(day, -1)
  const after = addDays(day, 1)
  // Broken on the next day with the chain ending the day before: the one
  // missing day was `day`.
  if (s.current === 0 && s.lost && s.lost.day === after && s.lastDay === before) {
    return { streak: { ...s, current: s.lost.streak, lost: null }, undone: 'broken' }
  }
  // A kept but unsolved `day` was covered by a freeze — unless a repair made on
  // the next day moved the chain there (a repair forgives the gap up to
  // yesterday, and was paid for: nothing to refund).
  if (s.current > 0 && s.lastDay === day && !daySolved && s.lastRepair !== after) {
    return { streak: { ...s, freezes: Math.min(MAX_FREEZES, s.freezes + 1), lastDay: before }, undone: 'frozen' }
  }
  return { streak: s, undone: 'none' }
}

/** True when today's puzzle already counts toward the streak. */
export function solvedToday(s: Streak, today: string): boolean {
  return s.current > 0 && s.lastDay === today
}

export interface MilestoneReward {
  /** The streak length that earned it. */
  day: number
  hints: number
  freezes: number
  /** A badge day: worth a share card. */
  badge: boolean
}

const MILESTONE_HINTS: Readonly<Record<number, number>> = { 7: 2, 14: 3, 30: 5, 50: 5, 100: 10, 200: 10, 365: 20 }
const BADGE_DAYS: ReadonlySet<number> = new Set([30, 50, 100, 200, 365])

/** What reaching `day` pays, or null for an ordinary day. */
export function milestoneFor(day: number): MilestoneReward | null {
  const hints = MILESTONE_HINTS[day] ?? 0
  const freezes = day === 3 || (day > 0 && day % 7 === 0) ? 1 : 0
  const badge = BADGE_DAYS.has(day)
  if (!hints && !freezes && !badge) return null
  return { day, hints, freezes, badge }
}

export interface SolveResult {
  streak: Streak
  /** False when today was already counted (a replay of today's board). */
  counted: boolean
  milestone: MilestoneReward | null
}

/**
 * Count today's solve. Call on a reconciled streak. The milestone's freezes are
 * applied here (capped at MAX_FREEZES); its hints are the caller's to grant, so
 * the caller can offer "watch an ad to double" first.
 */
export function recordSolve(s: Streak, today: string): SolveResult {
  if (solvedToday(s, today)) return { streak: s, counted: false, milestone: null }
  // A day at or before the last kept day (the clock or the time zone moved
  // back, e.g. a flight west after a solve past midnight): nothing to count,
  // and above all nothing to reset.
  if (s.lastDay !== null && daysBetween(s.lastDay, today) <= 0) return { streak: s, counted: false, milestone: null }
  const continues = s.current > 0 && s.lastDay !== null && daysBetween(s.lastDay, today) === 1
  const current = continues ? s.current + 1 : 1
  const milestone = milestoneFor(current)
  const freezes = Math.min(MAX_FREEZES, s.freezes + (milestone?.freezes ?? 0))
  return {
    streak: { ...s, current, best: Math.max(s.best, current), lastDay: today, freezes },
    counted: true,
    milestone,
  }
}

/** A broken streak that can still be restored today. */
export function canRepair(s: Streak, today: string): boolean {
  if (!s.lost) return false
  if (daysBetween(s.lost.day, today) >= REPAIR_WINDOW_DAYS) return false
  return s.lastRepair === null || daysBetween(s.lastRepair, today) >= REPAIR_COOLDOWN_DAYS
}

export interface RepairOutcome {
  streak: Streak
  /** Hints of the milestones the repair jumped over — the caller's to grant. */
  hints: number
  /** Freezes of those milestones, as applied here (after the cap). */
  freezes: number
  /** The highest milestone jumped over, or null. */
  milestoneDay: number | null
}

/**
 * Restore a broken streak: the lost length comes back, plus any days solved
 * since the break, and the gap is forgiven (the chain continues from today, or
 * from yesterday when today is not solved yet). Null when not repairable.
 *
 * The jump lands past days neither chain reached one solve at a time (lost 29 +
 * 1 solved since = 30, a day recordSolve never sees), so their milestones are
 * paid here: freezes applied like recordSolve's, hints left to the caller.
 * Milestones either chain already reached were paid then, and are not again.
 */
export function repair(s: Streak, today: string): RepairOutcome | null {
  if (!canRepair(s, today) || !s.lost) return null
  const yesterday = addDays(today, -1)
  const lastDay = s.lastDay !== null && s.lastDay >= yesterday ? s.lastDay : yesterday
  const current = s.lost.streak + s.current
  let hints = 0
  let earned = 0
  let milestoneDay: number | null = null
  for (let n = Math.max(s.lost.streak, s.current) + 1; n <= current; n++) {
    const m = milestoneFor(n)
    if (!m) continue
    hints += m.hints
    earned += m.freezes
    milestoneDay = n
  }
  const freezes = Math.min(MAX_FREEZES, s.freezes + earned)
  return {
    streak: { ...s, current, best: Math.max(s.best, current), lastDay, freezes, lost: null, lastRepair: today },
    hints,
    freezes: freezes - s.freezes,
    milestoneDay,
  }
}

export function canAddFreeze(s: Streak): boolean {
  return s.freezes < MAX_FREEZES
}

/** Whether the once-a-day "watch an ad for a freeze" is still open today. */
export function canEarnFreezeByAd(s: Streak, today: string): boolean {
  return canAddFreeze(s) && s.freezeAdDay !== today
}

/** Add one freeze (capped). `viaAdOn` marks today's ad freeze as used. */
export function addFreeze(s: Streak, viaAdOn?: string): Streak {
  if (!canAddFreeze(s)) return s
  return { ...s, freezes: s.freezes + 1, freezeAdDay: viaAdOn ?? s.freezeAdDay }
}
