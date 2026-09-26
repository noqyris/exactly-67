import { describe, expect, it } from 'vitest'
import {
  DAILY_INTERSTITIAL_CAP,
  interstitialsLeftToday,
  noteInterstitialShown,
  clearsPerInterstitial,
  DAILY_REWARDED_CAP,
  fillJar,
  GIFT_AD_BONUS,
  GIFT_LADDER,
  giftAvailable,
  giftDayAfter,
  giftHintsFor,
  giftStreakAfterClaim,
  JAR_CAPACITY,
  monthProgress,
  monthTier,
  noAdsNudgeDue,
  noteRewarded,
  type Offers,
  packMedal,
  PLACEMENT_CAPS,
  rewardedLeft,
  welcomeEligible,
  type AdCaps,
  type RewardPlacement,
} from './economy'
import { addDays } from './days'
import { addDailySolved, emptyMeta, giftAlreadyPaid, migrateMeta, parseMeta, withTrophy } from './meta'
import { rangeStats } from './progress'
import { recordSolve, solvedToday } from './streak'

const offers = (o: Partial<Offers> = {}): Offers => ({ ...emptyMeta().offers, ...o })
const none = { adsRemoved: false, unlimited: false }

describe('Star Jar', () => {
  it('fills with new stars and opens at capacity, carrying the rest', () => {
    expect(fillJar({ stars: 17 }, 2)).toEqual({ jar: { stars: 19 }, opened: 0 })
    expect(fillJar({ stars: 19 }, 3)).toEqual({ jar: { stars: 2 }, opened: 1 })
    expect(fillJar({ stars: 0 }, JAR_CAPACITY * 2 + 1)).toEqual({ jar: { stars: 1 }, opened: 2 })
  })
  it('ignores zero and negative gains (a replay that earned nothing new)', () => {
    expect(fillJar({ stars: 5 }, 0)).toEqual({ jar: { stars: 5 }, opened: 0 })
    expect(fillJar({ stars: 5 }, -3)).toEqual({ jar: { stars: 5 }, opened: 0 })
  })
})

describe('pack medals', () => {
  it('needs every level cleared', () => {
    expect(packMedal(69, 23, 24)).toBeNull()
  })
  it('bronze, silver at a 2.5★ average, gold at perfect', () => {
    expect(packMedal(24, 24, 24)).toBe('bronze')
    expect(packMedal(59, 24, 24)).toBe('bronze')
    expect(packMedal(60, 24, 24)).toBe('silver')
    expect(packMedal(72, 24, 24)).toBe('gold')
  })
  it('rangeStats sums a pack from progress', () => {
    const p = { stars: { '1': 3, '2': 2, '25': 1 }, best: {} }
    expect(rangeStats(p, 1, 24)).toEqual({ stars: 5, cleared: 2 })
    expect(rangeStats(p, 25, 24)).toEqual({ stars: 1, cleared: 1 })
  })
})

describe('daily month trophy', () => {
  it('tiers at 10, 20 and every day', () => {
    expect(monthTier(9, 30)).toBeNull()
    expect(monthTier(10, 30)).toBe('bronze')
    expect(monthTier(20, 30)).toBe('silver')
    expect(monthTier(29, 30)).toBe('silver')
    expect(monthTier(30, 30)).toBe('gold')
    expect(monthTier(28, 28)).toBe('gold')
  })
  it('counts only the given month and names the next tier', () => {
    const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-10-01']
    expect(monthProgress(days, '2026-09')).toEqual({ solved: 2, days: 30, tier: null, next: { tier: 'bronze', at: 10 } })
    const full = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    expect(monthProgress(full, '2026-09')).toMatchObject({ solved: 30, tier: 'gold', next: null })
  })
  it('keeps the best trophy per month', () => {
    const m = withTrophy(withTrophy(emptyMeta(), '2026-09', 'silver'), '2026-09', 'bronze')
    expect(m.trophies['2026-09']).toBe('silver')
    expect(withTrophy(m, '2026-09', 'gold').trophies['2026-09']).toBe('gold')
  })
})

describe('daily gift', () => {
  it('once per local day', () => {
    expect(giftAvailable(null, '2026-09-23')).toBe(true)
    expect(giftAvailable('2026-09-23', '2026-09-23')).toBe(false)
    expect(giftAvailable('2026-09-22', '2026-09-23')).toBe(true)
  })
  it('climbs 1, 2, 4, 6, 8 on days in a row, then starts over at 1', () => {
    expect(GIFT_LADDER).toEqual([1, 2, 4, 6, 8])
    let last: string | null = null
    let count = 0
    const paid: number[] = []
    for (let d = 0; d < 12; d++) {
      const day = addDays('2026-09-20', d)
      paid.push(giftHintsFor(giftDayAfter(last, count, day)))
      count = giftStreakAfterClaim(last, count, day)
      last = day
    }
    // Day 6 is day 1 again, day 7 is day 2 …
    expect(paid).toEqual([1, 2, 4, 6, 8, 1, 2, 4, 6, 8, 1, 2])
    expect(count).toBe(12) // the count keeps going; only the rung cycles
  })
  it('a day without a claim drops the ladder back to day 1', () => {
    expect(giftDayAfter('2026-09-22', 3, '2026-09-23')).toBe(4) // yesterday: climbs
    expect(giftDayAfter('2026-09-21', 3, '2026-09-23')).toBe(1) // a gap: starts over
    expect(giftStreakAfterClaim('2026-09-21', 3, '2026-09-23')).toBe(1)
    expect(giftDayAfter(null, 0, '2026-09-23')).toBe(1) // never claimed
    // A clock moved back (the last claim "tomorrow") or garbage is no streak either.
    expect(giftDayAfter('2026-09-24', 3, '2026-09-23')).toBe(1)
    expect(giftDayAfter('soon', 3, '2026-09-23')).toBe(1)
    expect(giftDayAfter('2026-09-22', Number.NaN, '2026-09-23')).toBe(1)
  })
  it('a second claim the same day never climbs, and reads as the day already taken', () => {
    expect(giftStreakAfterClaim('2026-09-23', 3, '2026-09-23')).toBe(3)
    expect(giftDayAfter('2026-09-23', 3, '2026-09-23')).toBe(3)
    expect(giftDayAfter('2026-09-23', 5, '2026-09-23')).toBe(5)
    // A 1.2.x upgrade whose silent hint stood in for today's gift is on no rung:
    // today reads as day 1, and so does tomorrow.
    expect(giftDayAfter('2026-09-23', 0, '2026-09-23')).toBe(1)
    expect(giftDayAfter('2026-09-23', 0, '2026-09-24')).toBe(1)
  })
  it('reads an out-of-range day as the nearest rung', () => {
    expect([1, 2, 3, 4, 5].map(giftHintsFor)).toEqual([1, 2, 4, 6, 8])
    expect(giftHintsFor(0)).toBe(1)
    expect(giftHintsFor(9)).toBe(8)
    expect(giftHintsFor(Number.NaN)).toBe(1)
  })
  it('the video adds a flat bonus that never outdoes the smallest hint pack', () => {
    const SMALLEST_PACK = 10 // iap.ts HINT_PACKS, $0.99
    expect(GIFT_AD_BONUS).toBe(2)
    expect(Math.max(...GIFT_LADDER) + GIFT_AD_BONUS).toBeLessThanOrEqual(SMALLEST_PACK)
    // Why not a double: day 5 doubled would hand out more than the pack for one ad.
    expect(Math.max(...GIFT_LADDER) * 2).toBeGreaterThan(SMALLEST_PACK)
  })
  it('an upgrade reads 1.2.x’s UTC hint date against today’s local day', () => {
    // Belgrade (UTC+2), 10:00 on the 23rd: local midnight was 22:00 UTC on the
    // 22nd, so a hint paid at 00:30 local carries the 22nd.
    expect(giftAlreadyPaid('2026-09-22', '2026-09-22', '2026-09-23')).toBe(true)
    expect(giftAlreadyPaid('2026-09-23', '2026-09-22', '2026-09-23')).toBe(true)
    expect(giftAlreadyPaid('2026-09-21', '2026-09-22', '2026-09-23')).toBe(false)
    // Los Angeles (UTC-7), 20:00 on the 23rd: it is already the 24th in UTC.
    expect(giftAlreadyPaid('2026-09-24', '2026-09-23', '2026-09-24')).toBe(true)
    expect(giftAlreadyPaid('2026-09-22', '2026-09-23', '2026-09-24')).toBe(false)
    // Never stored (a first 1.2.x launch that never ran) or garbage.
    expect(giftAlreadyPaid('', '2026-09-23', '2026-09-23')).toBe(false)
    expect(giftAlreadyPaid('soon', '2026-09-23', '2026-09-23')).toBe(false)
  })
})

describe('rewarded caps', () => {
  const day = '2026-09-23'
  it('per placement, resetting on a new day', () => {
    let c: AdCaps = { day: '', counts: {} }
    for (let i = 0; i < PLACEMENT_CAPS.store; i++) c = noteRewarded(c, day, 'store')
    expect(rewardedLeft(c, day, 'store')).toBe(0)
    expect(rewardedLeft(c, day, 'hint')).toBe(PLACEMENT_CAPS.hint)
    expect(rewardedLeft(c, '2026-09-24', 'store')).toBe(PLACEMENT_CAPS.store)
  })
  it('the daily total caps everything together', () => {
    let c: AdCaps = { day: '', counts: {} }
    const order: RewardPlacement[] = ['hint', 'hint', 'hint', 'hint', 'hint', 'hint', 'jar', 'jar', 'jar', 'pack', 'pack', 'pack']
    for (const p of order) c = noteRewarded(c, day, p)
    expect(order.length).toBe(DAILY_REWARDED_CAP)
    expect(rewardedLeft(c, day, 'gift')).toBe(0)
    expect(rewardedLeft(c, day, 'freeze')).toBe(0)
  })
})

describe('offers', () => {
  it('the Welcome pack is for someone who never paid', () => {
    expect(welcomeEligible(offers(), none)).toBe(true)
    expect(welcomeEligible(offers({ purchased: true }), none)).toBe(false)
    expect(welcomeEligible(offers({ welcomeBought: true }), none)).toBe(false)
    expect(welcomeEligible(offers(), { adsRemoved: true, unlimited: false })).toBe(false)
    expect(welcomeEligible(offers(), { adsRemoved: false, unlimited: true })).toBe(false)
  })
  it('the no-ads nudge waits for 8 interstitials, then 7 days apart, 4 times ever', () => {
    const now = 10 * 86_400_000
    expect(noAdsNudgeDue(offers({ interstitials: 7 }), none, now)).toBe(false)
    expect(noAdsNudgeDue(offers({ interstitials: 8 }), none, now)).toBe(true)
    expect(noAdsNudgeDue(offers({ interstitials: 8, noAdsLastAt: now - 86_400_000 }), none, now)).toBe(false)
    expect(noAdsNudgeDue(offers({ interstitials: 8, noAdsNudges: 4 }), none, now)).toBe(false)
    expect(noAdsNudgeDue(offers({ interstitials: 50 }), { adsRemoved: true, unlimited: false }, now)).toBe(false)
  })
  it('payers see interstitials half as often', () => {
    expect(clearsPerInterstitial(false)).toBe(3)
    expect(clearsPerInterstitial(true)).toBe(6)
  })
})

describe('meta persistence', () => {
  it('round-trips', () => {
    let m = emptyMeta()
    m = addDailySolved(m, '2026-09-20', '2026-09-23')
    m = { ...m, jar: { stars: 7 }, packRewards: [0, 2], giftDay: '2026-09-23', giftStreak: 3 }
    expect(parseMeta(JSON.stringify(m))).toEqual(m)
  })
  it('reads a blob from before the gift ladder as no ladder yet', () => {
    expect(parseMeta(JSON.stringify({ giftDay: '2026-09-23' }))).toMatchObject({ giftDay: '2026-09-23', giftStreak: 0 })
    expect(emptyMeta().giftStreak).toBe(0)
    // A count with no day to end on, or a nonsense count, is no ladder either.
    expect(parseMeta(JSON.stringify({ giftStreak: 4 })).giftStreak).toBe(0)
    for (const giftStreak of [-1, 2.5, '3', null]) {
      expect(parseMeta(JSON.stringify({ giftDay: '2026-09-23', giftStreak })).giftStreak).toBe(0)
    }
  })
  it('degrades garbage field by field', () => {
    const raw = JSON.stringify({
      streak: { current: 'nine', best: -1, lastDay: '2026-02-30', freezes: 9, lost: { streak: 4, day: 'x' } },
      daily: ['2026-09-01', 42, '2026-09-01', 'nope'],
      trophies: { '2026-09': 'platinum', '2026-08': 'gold', bad: 'gold' },
      jar: { stars: 3.5 },
      packRewards: [1, 1, -1, 'a'],
      adCaps: { day: '2026-09-23', counts: { hint: 2, bogus: 5, store: -1 } },
      offers: { purchased: 'yes', interstitials: 12 },
      giftDay: 5,
    })
    const m = parseMeta(raw)
    expect(m.streak).toEqual(emptyMeta().streak)
    expect(m.daily).toEqual(['2026-09-01'])
    expect(m.trophies).toEqual({ '2026-08': 'gold' })
    expect(m.jar.stars).toBe(0)
    expect(m.packRewards).toEqual([1])
    expect(m.adCaps).toEqual({ day: '2026-09-23', counts: { hint: 2, store: 0 } })
    expect(m.offers.purchased).toBe(false)
    expect(m.offers.interstitials).toBe(12)
    expect(m.giftDay).toBeNull()
    expect(parseMeta('{not json')).toEqual(emptyMeta())
    expect(parseMeta(null)).toEqual(emptyMeta())
  })
  it('prunes solved days to about two months', () => {
    let m = emptyMeta()
    m = addDailySolved(m, '2026-01-01', '2026-01-01')
    m = addDailySolved(m, '2026-09-23', '2026-09-23')
    expect(m.daily).toEqual(['2026-09-23'])
  })
  it('migrates 1.2.x dailyDone into a live streak only when recent', () => {
    expect(migrateMeta(emptyMeta(), '2026-09-22', '2026-09-23').streak).toMatchObject({ current: 1, lastDay: '2026-09-22' })
    expect(migrateMeta(emptyMeta(), '2026-09-23', '2026-09-23').streak.current).toBe(1)
    const old = migrateMeta(emptyMeta(), '2026-09-01', '2026-09-23')
    expect(old.streak.current).toBe(0)
    expect(old.daily).toEqual(['2026-09-01'])
    expect(migrateMeta(emptyMeta(), '', '2026-09-23')).toEqual(emptyMeta())
    // A UTC date a day ahead of the local one (an evening in the Americas) is
    // the board actually solved — the one now keyed tomorrow. Today's own board
    // stays open, and solving it counts nothing twice.
    const ahead = migrateMeta(emptyMeta(), '2026-09-24', '2026-09-23')
    expect(ahead.daily).toEqual(['2026-09-24'])
    expect(ahead.streak).toMatchObject({ current: 1, best: 1, lastDay: '2026-09-24' })
    expect(solvedToday(ahead.streak, '2026-09-23')).toBe(false)
    expect(recordSolve(ahead.streak, '2026-09-23').counted).toBe(false)
    expect(solvedToday(ahead.streak, '2026-09-24')).toBe(true)
    // Further ahead is no UTC date at all (the clock moved back): ignored.
    expect(migrateMeta(emptyMeta(), '2026-09-26', '2026-09-23')).toEqual(emptyMeta())
  })
})

describe('interstitials per day', () => {
  it('allows DAILY_INTERSTITIAL_CAP a local day, counting only today', () => {
    expect(DAILY_INTERSTITIAL_CAP).toBe(6)
    let c = emptyMeta().interstitialDay
    expect(interstitialsLeftToday(c, '2026-09-26')).toBe(6)
    for (let i = 0; i < 6; i++) c = noteInterstitialShown(c, '2026-09-26')
    expect(c).toEqual({ day: '2026-09-26', count: 6 })
    expect(interstitialsLeftToday(c, '2026-09-26')).toBe(0)
    // a new local day starts from zero; yesterday's count is spent, not carried
    expect(interstitialsLeftToday(c, '2026-09-27')).toBe(6)
    expect(noteInterstitialShown(c, '2026-09-27')).toEqual({ day: '2026-09-27', count: 1 })
  })

  it('persists through parseMeta, and a bad record degrades to none shown', () => {
    const m = { ...emptyMeta(), interstitialDay: { day: '2026-09-26', count: 4 } }
    expect(parseMeta(JSON.stringify(m)).interstitialDay).toEqual({ day: '2026-09-26', count: 4 })
    expect(parseMeta(JSON.stringify({ interstitialDay: { day: 'nope', count: 4 } })).interstitialDay).toEqual({ day: '', count: 0 })
    expect(parseMeta(JSON.stringify({ interstitialDay: { day: '2026-09-26', count: -3 } })).interstitialDay).toEqual({ day: '2026-09-26', count: 0 })
    expect(parseMeta(JSON.stringify({})).interstitialDay).toEqual({ day: '', count: 0 })
  })
})
