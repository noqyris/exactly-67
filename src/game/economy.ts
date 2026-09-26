import { addDays, daysInMonth, isDayKey, monthOf } from './days'

/**
 * The reward economy, as pure rules. Hints stay the ONE currency — the game has
 * a single thing to spend on, so a coin layer would only be a hint behind an
 * exchange rate (and EU consumer guidance on virtual currencies argues against
 * adding one). Stars are the earned, never-lost progress that pays out in hints.
 * See docs/RETENTION.md and docs/MONETIZATION.md.
 *
 * Every reward here is FIXED and shown before it is taken — nothing random, so
 * no odds to disclose (Apple 3.1.1, Unity's rewarded policy) and nothing that
 * reads as a loot box in a 4+ game.
 */

// --- Star Jar -------------------------------------------------------------------

/** New stars a full jar holds. ~2.4★ per level → a jar roughly every 8 levels. */
export const JAR_CAPACITY = 20
/** Where a brand-new install's jar starts (endowed progress: the first jar opens
 *  inside the first session). Existing players start at 0 — no back-dated flood. */
export const JAR_START_NEW = 5
/** A full jar pays this many hints; a rewarded ad makes it JAR_AD_HINTS instead. */
export const JAR_HINTS = 1
export const JAR_AD_HINTS = 3

export interface Jar {
  stars: number
}

/**
 * Pour newly earned stars (the gain over the level's previous best, never a
 * replay's full count) into the jar. Returns how many jars filled.
 */
export function fillJar(jar: Jar, gained: number): { jar: Jar; opened: number } {
  const add = Math.max(0, Math.floor(gained))
  const total = jar.stars + add
  return { jar: { stars: total % JAR_CAPACITY }, opened: Math.floor(total / JAR_CAPACITY) }
}

// --- Packs ------------------------------------------------------------------------

export type Medal = 'bronze' | 'silver' | 'gold'

/** Hints for completing a pack (every level cleared), once per pack; an ad doubles it. */
export const PACK_HINTS = 3
export const PACK_AD_HINTS = 6

/**
 * A pack's medal: none until every level is cleared; then bronze, silver at
 * 2.5★ average, gold at a perfect 3★ everywhere — a reason to replay for stars.
 */
export function packMedal(packStars: number, cleared: number, levels: number): Medal | null {
  if (levels <= 0 || cleared < levels) return null
  if (packStars >= levels * 3) return 'gold'
  if (packStars >= Math.ceil(levels * 2.5)) return 'silver'
  return 'bronze'
}

// --- Daily Challenge month ------------------------------------------------------

/**
 * Monthly trophy in tiers — Easybrain's month trophy, softened from all-or-
 * nothing: bronze at 10 days, silver at 20, gold for every day of the month.
 * Past days of the CURRENT month can be replayed from the calendar and count
 * here (not toward the streak).
 */
export function monthTier(solvedDays: number, monthLength: number): Medal | null {
  if (solvedDays >= monthLength) return 'gold'
  if (solvedDays >= 20) return 'silver'
  if (solvedDays >= 10) return 'bronze'
  return null
}

/** Solved-day count for `month` ("YYYY-MM") and the next tier to aim for. */
export function monthProgress(
  solved: Iterable<string>,
  month: string,
): { solved: number; days: number; tier: Medal | null; next: { tier: Medal; at: number } | null } {
  let count = 0
  for (const key of solved) if (monthOf(key) === month) count++
  const days = daysInMonth(month)
  const tier = monthTier(count, days)
  const next: { tier: Medal; at: number } | null =
    count < 10 ? { tier: 'bronze', at: 10 } : count < 20 ? { tier: 'silver', at: 20 } : count < days ? { tier: 'gold', at: days } : null
  return { solved: count, days, tier, next }
}

// --- Daily gift -------------------------------------------------------------------

/**
 * The daily gift is a five-day ladder: each day in a row it is claimed pays the
 * next rung, day 6 starts over at the bottom, and a day without a claim drops
 * back to day 1. It replaced 1.2's silent +1 at boot, and it climbs because a
 * flat gift is worth the same whenever it is taken — this one is worth more
 * only if the player comes back TOMORROW.
 */
export const GIFT_LADDER: readonly number[] = [1, 2, 4, 6, 8]
/**
 * What the optional video adds on top of any rung — flat, never a multiplier:
 * doubling day 5 would hand out 16 hints for one ad, more than the $0.99
 * 10-pack, and the rewarded faucet must never undercut the packs.
 */
export const GIFT_AD_BONUS = 2
/** Hints a brand-new install starts with (the first day's gift, pre-claimed). */
export const NEW_INSTALL_HINTS = 3

export function giftAvailable(lastGiftDay: string | null, today: string): boolean {
  return lastGiftDay !== today
}

/**
 * The days-in-a-row claim count once today's gift is taken: yesterday's count
 * plus one, or a fresh 1 after a day without a claim (or a clock that moved
 * back). Already claimed today → unchanged, so a second claim never climbs.
 */
export function giftStreakAfterClaim(lastGiftDay: string | null, giftStreak: number, today: string): number {
  const count = Number.isInteger(giftStreak) && giftStreak > 0 ? giftStreak : 0
  if (lastGiftDay === today) return count
  return isDayKey(lastGiftDay) && addDays(lastGiftDay, 1) === today ? count + 1 : 1
}

/** The ladder day (1–5) of today's claim — the one still to take, or the one taken. */
export function giftDayAfter(lastGiftDay: string | null, giftStreak: number, today: string): number {
  const count = giftStreakAfterClaim(lastGiftDay, giftStreak, today)
  return count <= 0 ? 1 : ((count - 1) % GIFT_LADDER.length) + 1
}

/** The free hints on ladder day `day` (anything out of range reads as the nearest rung). */
export function giftHintsFor(day: number): number {
  const rung = Math.min(GIFT_LADDER.length, Math.max(1, Math.floor(day) || 1))
  return GIFT_LADDER[rung - 1]
}

// --- Rewarded caps ----------------------------------------------------------------

/**
 * Every rewarded placement, capped per local day IN CODE: the LevelPlay plugin's
 * showRewarded() takes no placement name, so the dashboard cannot cap them
 * separately. The caps keep the free faucet from undercutting the paid packs.
 */
export type RewardPlacement = 'hint' | 'gift' | 'jar' | 'pack' | 'store' | 'freeze' | 'repair' | 'milestone'

export const PLACEMENT_CAPS: Readonly<Record<RewardPlacement, number>> = {
  hint: 6,
  gift: 1,
  jar: 3,
  pack: 3,
  store: 2,
  freeze: 1,
  repair: 1,
  milestone: 2,
}
/** All placements together, per day. */
export const DAILY_REWARDED_CAP = 12

export interface AdCaps {
  day: string
  counts: Partial<Record<RewardPlacement, number>>
}

function capsOn(c: AdCaps, today: string): AdCaps {
  return c.day === today ? c : { day: today, counts: {} }
}

/** Rewarded views left today for `p` (0 when its cap or the daily total is hit). */
export function rewardedLeft(c: AdCaps, today: string, p: RewardPlacement): number {
  const now = capsOn(c, today)
  const used = now.counts[p] ?? 0
  const total = Object.values(now.counts).reduce((a, b) => a + (b ?? 0), 0)
  return Math.max(0, Math.min(PLACEMENT_CAPS[p] - used, DAILY_REWARDED_CAP - total))
}

/** Record one rewarded view that PAID OUT for `p` today. */
export function noteRewarded(c: AdCaps, today: string, p: RewardPlacement): AdCaps {
  const now = capsOn(c, today)
  return { day: today, counts: { ...now.counts, [p]: (now.counts[p] ?? 0) + 1 } }
}

// --- Offers -----------------------------------------------------------------------

/** One-time Welcome pack: 25 hints for the lowest price tier, once per player. */
export const WELCOME_HINTS = 25
/** The "remove ads between levels" nudge: after this many interstitials seen… */
export const NO_ADS_NUDGE_AFTER = 8
/** …at most this often, and this many times ever. */
export const NO_ADS_NUDGE_GAP_MS = 7 * 86_400_000
export const NO_ADS_NUDGE_MAX = 4

export interface Offers {
  /** Any purchase ever approved on this install (a pack, an unlock, the welcome pack). */
  purchased: boolean
  welcomeBought: boolean
  /** Interstitials actually presented, lifetime. */
  interstitials: number
  noAdsNudges: number
  noAdsLastAt: number
  sessions: number
}

export interface Ownership {
  adsRemoved: boolean
  unlimited: boolean
}

/**
 * The Welcome pack is for someone who has never paid: once they buy anything
 * (or own an unlock) it disappears for good — and while it shows, it REPLACES
 * the 10-hint card, so nobody is offered more for less right beside it.
 */
export function welcomeEligible(o: Offers, own: Ownership): boolean {
  return !o.purchased && !o.welcomeBought && !own.adsRemoved && !own.unlimited
}

/** Whether the win card may show the quiet "remove ads between levels" link. */
export function noAdsNudgeDue(o: Offers, own: Ownership, nowMs: number): boolean {
  if (own.adsRemoved || own.unlimited) return false
  if (o.interstitials < NO_ADS_NUDGE_AFTER || o.noAdsNudges >= NO_ADS_NUDGE_MAX) return false
  return nowMs - o.noAdsLastAt >= NO_ADS_NUDGE_GAP_MS
}

/** Interstitial spacing in clears: players who have paid see half as many. */
export function clearsPerInterstitial(purchased: boolean): number {
  return purchased ? 6 : 3
}
