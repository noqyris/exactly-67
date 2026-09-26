import { addDays, daysBetween, isDayKey } from './days'
import type { AdCaps, Jar, Medal, Offers, RewardPlacement } from './economy'
import { PLACEMENT_CAPS } from './economy'
import type { Streak } from './streak'
import { emptyStreak, MAX_FREEZES } from './streak'

/**
 * Everything the meta-game remembers besides level stars (progress.ts): the
 * streak, the Daily Challenge calendar, the Star Jar, pack rewards, today's
 * rewarded-ad caps and the offer history. One JSON blob under one key, parsed
 * defensively like progress — a corrupt or tampered value degrades to sane
 * defaults field by field instead of wiping the rest. Storage I/O lives in
 * services/metaStore.ts.
 */
export interface Meta {
  streak: Streak
  /** Local day keys whose Daily Challenge was solved (pruned to ~2 months). */
  daily: string[]
  /** Best trophy per month ("YYYY-MM"), kept after the days are pruned. */
  trophies: Record<string, Medal>
  jar: Jar
  /** Pack indices whose completion reward was already paid. */
  packRewards: number[]
  adCaps: AdCaps
  offers: Offers
  /** Day the daily gift was last claimed. */
  giftDay: string | null
  /**
   * Days in a row the gift was claimed, ending on `giftDay` — the gift ladder's
   * position (economy.ts). 0 = no ladder yet: a blob from before the ladder, or
   * a 1.2.x upgrade whose silent hint stood in for today's gift.
   */
  giftStreak: number
}

/** Solved-day history kept: this month and the last, for the calendar + trophies. */
const DAILY_KEEP_DAYS = 70

export function emptyMeta(): Meta {
  return {
    streak: emptyStreak(),
    daily: [],
    trophies: {},
    jar: { stars: 0 },
    packRewards: [],
    adCaps: { day: '', counts: {} },
    offers: { purchased: false, welcomeBought: false, interstitials: 0, noAdsNudges: 0, noAdsLastAt: 0, sessions: 0 },
    giftDay: null,
    giftStreak: 0,
  }
}

/** Record a solved Daily Challenge day (any day of the calendar), pruned. */
export function addDailySolved(meta: Meta, day: string, today: string): Meta {
  const set = new Set(meta.daily)
  set.add(day)
  const floor = addDays(today, -DAILY_KEEP_DAYS)
  const daily = [...set].filter((k) => k >= floor).sort()
  return { ...meta, daily }
}

/** Keep the best trophy for `day`'s month. */
export function withTrophy(meta: Meta, month: string, tier: Medal | null): Meta {
  if (!tier) return meta
  const rank = { bronze: 1, silver: 2, gold: 3 } as const
  const prev = meta.trophies[month]
  if (prev && rank[prev] >= rank[tier]) return meta
  return { ...meta, trophies: { ...meta.trophies, [month]: tier } }
}

// --- parsing ----------------------------------------------------------------------

const int = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const dayOrNull = (v: unknown): string | null => (isDayKey(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const MEDALS: ReadonlySet<string> = new Set(['bronze', 'silver', 'gold'])

function parseStreak(raw: unknown): Streak {
  const r = obj(raw)
  const s = emptyStreak()
  s.current = int(r.current, 0, 100_000, 0)
  s.best = Math.max(int(r.best, 0, 100_000, 0), s.current)
  s.lastDay = dayOrNull(r.lastDay)
  if (s.lastDay === null) s.current = 0
  s.freezes = int(r.freezes, 0, MAX_FREEZES, 0)
  const lost = obj(r.lost)
  const lostDay = dayOrNull(lost.day)
  const lostStreak = int(lost.streak, 1, 100_000, 0)
  s.lost = lostDay && lostStreak ? { streak: lostStreak, day: lostDay } : null
  s.lastRepair = dayOrNull(r.lastRepair)
  s.freezeAdDay = dayOrNull(r.freezeAdDay)
  return s
}

function parseCaps(raw: unknown): AdCaps {
  const r = obj(raw)
  const day = isDayKey(r.day) ? r.day : ''
  const counts: AdCaps['counts'] = {}
  for (const [k, v] of Object.entries(obj(r.counts))) {
    if (k in PLACEMENT_CAPS) counts[k as RewardPlacement] = int(v, 0, 1000, 0)
  }
  return { day, counts }
}

function parseOffers(raw: unknown): Offers {
  const r = obj(raw)
  const d = emptyMeta().offers
  return {
    purchased: bool(r.purchased, d.purchased),
    welcomeBought: bool(r.welcomeBought, d.welcomeBought),
    interstitials: int(r.interstitials, 0, 1_000_000, 0),
    noAdsNudges: int(r.noAdsNudges, 0, 1000, 0),
    noAdsLastAt: int(r.noAdsLastAt, 0, Number.MAX_SAFE_INTEGER, 0),
    sessions: int(r.sessions, 0, 10_000_000, 0),
  }
}

/** Defensive parse of the persisted blob; null/garbage → a fresh Meta. */
export function parseMeta(raw: string | null | undefined): Meta {
  const meta = emptyMeta()
  if (!raw) return meta
  let data: Record<string, unknown>
  try {
    data = obj(JSON.parse(raw))
  } catch {
    return meta
  }
  meta.streak = parseStreak(data.streak)
  meta.daily = Array.isArray(data.daily) ? [...new Set(data.daily.filter(isDayKey))].sort() : []
  for (const [k, v] of Object.entries(obj(data.trophies))) {
    if (/^\d{4}-\d{2}$/.test(k) && typeof v === 'string' && MEDALS.has(v)) meta.trophies[k] = v as Medal
  }
  meta.jar = { stars: int(obj(data.jar).stars, 0, 10_000, 0) }
  meta.packRewards = Array.isArray(data.packRewards)
    ? [...new Set(data.packRewards.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000))]
    : []
  meta.adCaps = parseCaps(data.adCaps)
  meta.offers = parseOffers(data.offers)
  meta.giftDay = dayOrNull(data.giftDay)
  // A count with no day to end on is no ladder at all.
  meta.giftStreak = meta.giftDay ? int(data.giftStreak, 0, 100_000, 0) : 0
  return meta
}

/**
 * Whether 1.2.x's silent daily hint was already paid on today's LOCAL day, for
 * the upgrade that replaces it with the claimed gift. 1.2.x stored the date as
 * UTC, so any payment since local midnight carries a UTC date from the one at
 * local midnight (`localMidnightUtc`) to the one now (`nowUtc`) — east of UTC
 * that is yesterday's UTC date from local midnight until the UTC rollover. A
 * UTC date keeps no time, so a payment late on the previous local evening can
 * fall in the range too — that can skip one gift on upgrade day, never pay two.
 */
export function giftAlreadyPaid(freeDate: string, localMidnightUtc: string, nowUtc: string): boolean {
  return isDayKey(freeDate) && freeDate >= localMidnightUtc && freeDate <= nowUtc
}

/**
 * First meta for an install that predates it. `dailyDone` is 1.2.x's single
 * "last Daily Challenge solved" key (UTC then; read here as a calendar day). A
 * solve today or yesterday starts a live 1-day streak rather than a broken one,
 * so upgrading never shows anybody a lost streak on day one.
 */
export function migrateMeta(meta: Meta, dailyDone: string, today: string): Meta {
  if (!isDayKey(dailyDone)) return meta
  // 1.2.x keyed the board by the UTC date, which in the Americas runs up to a
  // day AHEAD of the local one: an evening solver there solved the board now
  // keyed "tomorrow". Record THAT board (today's own board stays playable, and
  // recordSolve ignores days up to lastDay, so nothing counts twice). More than
  // a day ahead is no UTC date of a real solve — the clock moved back since.
  if (daysBetween(today, dailyDone) > 1) return meta
  const day = dailyDone
  const gap = daysBetween(day, today)
  let next = addDailySolved(meta, day, today)
  if (gap <= 1 && next.streak.current === 0) {
    next = { ...next, streak: { ...next.streak, current: 1, best: Math.max(1, next.streak.best), lastDay: day } }
  }
  return next
}
