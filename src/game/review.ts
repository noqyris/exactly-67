/**
 * When to ask for an App Store rating, as pure rules. The OS shows the sheet at
 * most three times in 365 days (and may show it fewer); the game had used one
 * ask in its whole life, and the store page has no ratings. So: up to three asks
 * a year, each at a moment of delight, spaced out so a player is never asked
 * twice in a short run of play.
 *
 * - The first: a 3★ clear from Level 8, or any clear from Level 12.
 * - The second: a 3★ clear at least 14 days after the first.
 * - The third: a 3★ clear at least 120 days after the second.
 * Never more than three in any 365 days. Never on a failure, never behind a
 * button, never incentivised (Apple's HIG) — the caller asks only on a win.
 */

const DAY_MS = 86_400_000

export const REVIEW_MAX_PER_YEAR = 3
export const REVIEW_FIRST_DELIGHT_LEVEL = 8
export const REVIEW_FIRST_MILESTONE_LEVEL = 12
/** Days after the previous ask before the 2nd, and before the 3rd. */
export const REVIEW_GAP_DAYS = [14, 120] as const

export interface ReviewContext {
  /** Epoch ms of every ask so far (any order). */
  asks: readonly number[]
  nowMs: number
  /** The level just cleared (global number) and its stars. */
  global: number
  stars: number
}

/** Asks inside the last 365 days, oldest first. */
function recent(asks: readonly number[], nowMs: number): number[] {
  return asks.filter((t) => t > nowMs - 365 * DAY_MS && t <= nowMs).sort((a, b) => a - b)
}

/** Whether this clear asks for a rating. */
export function reviewDue(c: ReviewContext): boolean {
  const year = recent(c.asks, c.nowMs)
  if (year.length >= REVIEW_MAX_PER_YEAR) return false
  // Nothing asked this year: the first-ask rule (a player whose last ask is more
  // than a year old is a fresh start, like the OS's own window).
  if (year.length === 0) {
    return (c.stars === 3 && c.global >= REVIEW_FIRST_DELIGHT_LEVEL) || c.global >= REVIEW_FIRST_MILESTONE_LEVEL
  }
  const gapDays = REVIEW_GAP_DAYS[Math.min(year.length - 1, REVIEW_GAP_DAYS.length - 1)]
  const last = year[year.length - 1]
  return c.stars === 3 && c.nowMs - last >= gapDays * DAY_MS
}

/** The asks after asking now (newest kept; older than a year dropped). */
export function noteReviewAsked(asks: readonly number[], nowMs: number): number[] {
  return [...recent(asks, nowMs), nowMs]
}

/** Defensive parse of the persisted list: finite, positive epoch ms only. */
export function parseReviewAsks(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0) : []
}
