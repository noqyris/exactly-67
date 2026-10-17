/**
 * The Daily intro: a row on a level's win card that sends a player who has never
 * solved a Daily Challenge into today's puzzle.
 *
 * Every reason to come back tomorrow — the Daily, the streak, the gift ladder —
 * lives on the menu, and the first run skips the menu; the level win card offered
 * only Retry, Map and Next. A player who keeps tapping Next ended day 0 with no
 * streak and no "come back tomorrow" promise. Starting a streak early is what
 * buys retention (Duolingo, 2020: making one lesson enough to extend a streak
 * raised the share of new learners on a streak by 19% and D14 by 3.3%).
 *
 * From level 8 (balloons are taught by then — all a Daily uses — and the L8 clear
 * never carries an interstitial), at most three times, never twice on one day,
 * and never again once any Daily was solved. See docs/RETENTION.md.
 */
import { isDayKey } from './days'

export const DAILY_INTRO_MIN_LEVEL = 8
export const DAILY_INTRO_MAX_SHOWS = 3

export interface DailyIntroState {
  /** Win cards that carried the row, ever. */
  shown: number
  /** Local day it was last shown. */
  day: string | null
}

export function emptyDailyIntro(): DailyIntroState {
  return { shown: 0, day: null }
}

export interface DailyIntroContext {
  /** The level just cleared (global number). */
  global: number
  /** Any Daily Challenge was ever solved (a solved day on record, or a best streak). */
  everSolvedDaily: boolean
  /** Today's puzzle is already solved. */
  doneToday: boolean
  state: DailyIntroState
  today: string
}

/** Whether this level's win card carries the Daily intro row. */
export function dailyIntroDue(c: DailyIntroContext): boolean {
  if (c.global < DAILY_INTRO_MIN_LEVEL) return false
  if (c.everSolvedDaily || c.doneToday) return false
  if (c.state.shown >= DAILY_INTRO_MAX_SHOWS) return false
  return c.state.day !== c.today
}

/** The row was shown on a win card today. */
export function noteDailyIntroShown(state: DailyIntroState, today: string): DailyIntroState {
  return { shown: state.shown + 1, day: today }
}

/** Defensive parse of the persisted state; anything unreadable is a fresh one. */
export function parseDailyIntro(raw: unknown): DailyIntroState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyDailyIntro()
  const r = raw as Record<string, unknown>
  const shown = typeof r.shown === 'number' && Number.isInteger(r.shown) && r.shown >= 0 && r.shown <= 100 ? r.shown : 0
  return { shown, day: isDayKey(r.day) ? r.day : null }
}
