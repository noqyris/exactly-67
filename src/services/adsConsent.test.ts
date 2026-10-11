import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT } from '../game/adConsent'
import type { RewardPlacement } from '../game/economy'

/**
 * Option A in the policy layer (owner, 2026-10-11 — hq/projects/games/
 * ads-consent-option-a.md). The rules are pure and tested in game/adConsent;
 * what is pinned here is WHERE the question is asked — never at launch; on the
 * way out of a finished level's win card, in place of that break's
 * interstitial; on a tapped rewarded offer; from Settings → "Privacy & ads" —
 * and that a refusal's quiet period hides the offers instead of leaving
 * buttons that do nothing. Ported from KVIZKO's adsConsent.test.ts.
 */

type State = 'UNKNOWN' | 'GRANTED' | 'DENIED'
/** The stored answer the fake provider reports. */
let state: State = 'UNKNOWN'
/** What the player taps when the question is shown. */
let answer: State = 'GRANTED'
/** Set per test: the question stays on screen until the test answers it. */
let holdQuestion = false
let answerQuestion: (() => void) | null = null
/** Set per test: init() (the stored answer being read) stays pending. */
let holdInit = false
let releaseInit: (() => void) | null = null
let consentListener: ((granted: boolean) => void) | null = null
const asked: string[] = []
const log: string[] = []

const fake = {
  id: 'fake',
  testing: false,
  supports: () => true,
  init: vi.fn(() => {
    log.push('init')
    return holdInit ? new Promise<void>((r) => (releaseInit = r)) : Promise.resolve()
  }),
  onReady: vi.fn(),
  retryInit: vi.fn(),
  adsAllowed: () => state === 'GRANTED',
  consentState: () => state,
  askConsent: vi.fn((trigger: string) => {
    asked.push(trigger)
    log.push(`ask:${trigger}`)
    const decide = (): State => {
      const was = state
      state = answer
      if (state !== was) consentListener?.(state === 'GRANTED')
      return state
    }
    if (!holdQuestion) return Promise.resolve(decide())
    return new Promise<State>((resolve) => {
      answerQuestion = () => resolve(decide())
    })
  }),
  onConsentChange: vi.fn((l: (granted: boolean) => void) => {
    consentListener = l
  }),
  resetConsent: vi.fn(async () => {
    log.push('resetConsent')
  }),
  setInterstitialWanted: vi.fn(),
  bannerShow: vi.fn(async () => {
    log.push('bannerShow')
  }),
  bannerResume: vi.fn(async () => {}),
  bannerHide: vi.fn(async () => {}),
  bannerRemove: vi.fn(async () => {
    log.push('bannerRemove')
  }),
  loadInterstitial: vi.fn(async () => {
    log.push('loadInterstitial')
    return state === 'GRANTED'
  }),
  showInterstitial: vi.fn(async () => {
    log.push('showInterstitial')
    return true
  }),
  loadRewarded: vi.fn(async () => {
    log.push('loadRewarded')
    return state === 'GRANTED'
  }),
  showRewarded: vi.fn(async () => {
    log.push('showRewarded')
    return { amount: 1 }
  }),
  resolvesOnPresent: (f: string) => f === 'interstitial',
  watchDismissal: vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} })),
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))
vi.mock('./providers/levelplay', () => ({ levelplayProvider: fake }))
vi.mock('./providers/mock', () => ({ mockProvider: fake }))
vi.mock('./audio', () => ({ resumeAudio: () => {} }))
vi.mock('./music', () => ({ startMusic: () => {}, stopMusic: () => {}, suppressMusic: () => {} }))

/** The device's storage — what a previous launch left behind. Survives freshAds(). */
const stored = { askedAt: 0, migrated: true, adClears: 0 }
const savedAskedAt: number[] = []
const tally: string[] = []
vi.mock('./storage', () => ({
  loadAdClears: async () => stored.adClears,
  saveAdClears: async () => {},
  loadConsentMigrated: async () => stored.migrated,
  saveConsentMigrated: async () => {
    stored.migrated = true
  },
  loadAdConsentAskedAt: async () => stored.askedAt,
  saveAdConsentAskedAt: async (ms: number) => {
    savedAskedAt.push(ms)
  },
  tallyAdConsentAnswer: async (trigger: string, result: string) => {
    tally.push(`${trigger}:${result}`)
  },
  loadHintCount: async () => 0,
  saveHintCount: async () => {},
  saveAdsRemoved: async () => {},
  saveUnlimitedHints: async () => {},
  loadMetaRaw: async () => null,
  saveMetaRaw: async () => {},
}))

const DAY = 86_400_000
const NOW = new Date('2026-10-11T10:00:00Z').getTime()
type Ads = typeof import('./ads')

/** A fresh launch: new module state, the given stored answer and ask time. */
async function freshAds(opts: { state?: State; askedAt?: number; owner?: 'noads' | 'unlimited'; init?: boolean } = {}): Promise<Ads> {
  vi.resetModules()
  state = opts.state ?? 'UNKNOWN'
  answer = 'GRANTED'
  holdQuestion = false
  answerQuestion = null
  holdInit = false
  releaseInit = null
  consentListener = null
  asked.length = 0
  log.length = 0
  savedAskedAt.length = 0
  tally.length = 0
  stored.askedAt = opts.askedAt ?? 0
  stored.migrated = true
  stored.adClears = 0
  for (const f of Object.values(fake)) if (vi.isMockFunction(f)) f.mockClear()
  const ads = await import('./ads')
  ads.primeAdsRemoved(opts.owner !== undefined)
  ads.primeUnlimitedHints(opts.owner === 'unlimited')
  if (opts.init !== false) await ads.initAds()
  return ads
}

beforeEach(() => {
  vi.stubEnv('VITE_ADS', '')
  vi.stubEnv('VITE_AD_MODE', '')
  vi.stubEnv('VITE_UNLOCK_ALL', '')
  vi.useFakeTimers({ now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('nothing is asked at launch', () => {
  it('initAds() reads the stored answer and asks nothing — whatever is stored', async () => {
    for (const s of ['UNKNOWN', 'GRANTED', 'DENIED'] as const) {
      await freshAds({ state: s })
      expect(fake.init, s).toHaveBeenCalledTimes(1)
      expect(asked, s).toEqual([])
    }
  })
})

describe('after a finished level — in place of that break’s interstitial', () => {
  it('a player with no answer is asked at the first break, Level 1 included, and nothing else shows', async () => {
    const ads = await freshAds()
    await expect(ads.maybeShowInterstitial(1)).resolves.toBe(false)
    expect(asked).toEqual(['afterLevel'])
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
    expect(fake.showInterstitial).not.toHaveBeenCalled()
    expect(savedAskedAt).toEqual([NOW])
  })

  it('the next level waits for the answer: the break settles only once the question is gone', async () => {
    const ads = await freshAds()
    holdQuestion = true
    let left = false
    void ads.maybeShowInterstitial(1).then(() => (left = true))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(left).toBe(false)
    answerQuestion?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(left).toBe(true)
  })

  it('once per session: a question left unanswered is not asked again at the next break', async () => {
    const ads = await freshAds()
    answer = 'UNKNOWN' // no answer within the ceiling
    await ads.maybeShowInterstitial(1)
    await ads.maybeShowInterstitial(2)
    expect(asked).toEqual(['afterLevel'])
  })

  it('a new session (a 30-minute or new-day return) gets one more try', async () => {
    const ads = await freshAds()
    answer = 'UNKNOWN'
    await ads.maybeShowInterstitial(1)
    ads.startAdSession()
    await ads.maybeShowInterstitial(2)
    expect(asked).toEqual(['afterLevel', 'afterLevel'])
  })

  it('a card that already asked something — or offered a reward video — keeps its promise of nothing after', async () => {
    const ads = await freshAds()
    await ads.maybeShowInterstitial(12, { cardAsk: true })
    await ads.maybeShowInterstitial(24, { rewardPrompt: true })
    expect(asked).toEqual([])
    await ads.maybeShowInterstitial(13)
    expect(asked).toEqual(['afterLevel'])
  })

  it('a player who already answered gets the ordinary break, no question', async () => {
    for (const s of ['GRANTED', 'DENIED'] as const) {
      const ads = await freshAds({ state: s })
      await ads.maybeShowInterstitial(1)
      expect(asked, s).toEqual([])
    }
  })

  it('No ads and Unlimited owners are never asked after a level', async () => {
    let ads = await freshAds({ owner: 'noads' })
    await ads.maybeShowInterstitial(1)
    expect(asked).toEqual([])
    ads = await freshAds({ owner: 'unlimited' })
    await ads.maybeShowInterstitial(1)
    expect(asked).toEqual([])
    expect(fake.init).not.toHaveBeenCalled()
  })

  it('not before the stored answer is read: an UNKNOWN that only means "not read yet" asks nothing', async () => {
    const ads = await freshAds({ init: false })
    holdInit = true
    const init = ads.initAds()
    await vi.advanceTimersByTimeAsync(0)
    await ads.maybeShowInterstitial(1)
    expect(asked).toEqual([])
    releaseInit?.()
    await init
    await ads.maybeShowInterstitial(2)
    expect(asked).toEqual(['afterLevel'])
  })

  it('a yes at the break brings the ordinary cadence from then on — no second question', async () => {
    const ads = await freshAds()
    await ads.maybeShowInterstitial(1)
    expect(ads.adConsentState()).toBe('GRANTED')
    await ads.maybeShowInterstitial(2)
    expect(asked).toEqual(['afterLevel'])
  })
})

describe('a tapped rewarded offer', () => {
  it('with no answer: the offer is drawn, the tap asks, and a yes plays the ad', async () => {
    const ads = await freshAds()
    expect(ads.rewardedOffered()).toBe(true)
    expect(ads.rewardedAvailable('hint')).toBe(true)
    await expect(ads.watchRewardedHint()).resolves.toBe('earned')
    expect(asked).toEqual(['adTap'])
    expect(log.indexOf('ask:adTap')).toBeLessThan(log.indexOf('loadRewarded'))
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
  })

  it('a no plays nothing and loads nothing — and the quiet period takes the offer away', async () => {
    const ads = await freshAds()
    answer = 'DENIED'
    await expect(ads.watchRewarded('gift')).resolves.toBe('no-consent')
    expect(fake.loadRewarded).not.toHaveBeenCalled()
    expect(fake.showRewarded).not.toHaveBeenCalled()
    expect(ads.rewardedOffered()).toBe(false)
  })

  it('no answer at all plays nothing — and leaves the offer, so the next tap asks again', async () => {
    const ads = await freshAds()
    answer = 'UNKNOWN'
    await expect(ads.watchRewarded('store')).resolves.toBe('no-consent')
    expect(fake.loadRewarded).not.toHaveBeenCalled()
    expect(ads.rewardedOffered()).toBe(true)
    await ads.watchRewarded('store')
    expect(asked).toEqual(['adTap', 'adTap'])
  })

  it('with consent: no question at all', async () => {
    const ads = await freshAds({ state: 'GRANTED' })
    await expect(ads.watchRewardedHint()).resolves.toBe('earned')
    expect(asked).toEqual([])
  })

  it('a refusal with no recorded time (an answer given in 1.3.0) is asked once on the tap', async () => {
    const ads = await freshAds({ state: 'DENIED', askedAt: 0 })
    expect(ads.rewardedOffered()).toBe(true)
    answer = 'DENIED'
    await ads.watchRewardedHint()
    expect(asked).toEqual(['adTap'])
    expect(ads.rewardedOffered()).toBe(false)
  })

  it('inside the 180-day quiet period: no offer anywhere, and a tap that comes anyway asks nothing and plays nothing', async () => {
    const ads = await freshAds({ state: 'DENIED', askedAt: NOW - 10 * DAY })
    expect(ads.rewardedOffered()).toBe(false)
    const placements: RewardPlacement[] = ['hint', 'gift', 'jar', 'pack', 'store', 'freeze', 'repair', 'milestone']
    for (const p of placements) expect(ads.rewardedAvailable(p), p).toBe(false)
    await expect(ads.watchRewardedHint()).resolves.toBe('unavailable')
    expect(asked).toEqual([])
    expect(fake.loadRewarded).not.toHaveBeenCalled()
  })

  it('after 180 days the offers come back, and the tap asks again', async () => {
    const ads = await freshAds({ state: 'DENIED', askedAt: NOW - CONSENT.reaskAfterDays * DAY })
    expect(ads.rewardedOffered()).toBe(true)
    await ads.watchRewardedHint()
    expect(asked).toEqual(['adTap'])
  })

  it('offers wait for the stored answer: none drawn until it is read', async () => {
    const ads = await freshAds({ init: false })
    holdInit = true
    const init = ads.initAds()
    await vi.advanceTimersByTimeAsync(0)
    expect(ads.rewardedOffered()).toBe(false)
    releaseInit?.()
    await init
    expect(ads.rewardedOffered()).toBe(true)
  })

  it('the question is up: another offer or break cannot stack an ad or a second question on it', async () => {
    const ads = await freshAds()
    holdQuestion = true
    const tap = ads.watchRewardedHint()
    await vi.advanceTimersByTimeAsync(0)
    expect(ads.rewardedBusy()).toBe(true)
    await expect(ads.watchRewarded('gift')).resolves.toBe('unavailable')
    await expect(ads.maybeShowInterstitial(1)).resolves.toBe(false)
    expect(asked).toEqual(['adTap'])
    answerQuestion?.()
    await expect(tap).resolves.toBe('earned')
  })
})

describe('Settings → Privacy & ads', () => {
  it('always asks, whatever the answer and however recent', async () => {
    for (const s of ['UNKNOWN', 'GRANTED', 'DENIED'] as const) {
      const ads = await freshAds({ state: s, askedAt: NOW - DAY })
      await ads.openPrivacyOptions()
      expect(asked, s).toEqual(['settings'])
    }
  })

  it('a withdrawal there starts the quiet period: the offers go at once', async () => {
    const ads = await freshAds({ state: 'GRANTED' })
    answer = 'DENIED'
    await ads.openPrivacyOptions()
    expect(ads.rewardedOffered()).toBe(false)
    expect(savedAskedAt).toEqual([NOW])
  })

  it('never asks an Unlimited owner — there is no SDK to consent to', async () => {
    const ads = await freshAds({ owner: 'unlimited' })
    await ads.openPrivacyOptions()
    expect(asked).toEqual([])
  })

  it('the one-time reset runs BEFORE a question asked early — a reset landing after an answer would erase it', async () => {
    const ads = await freshAds({ init: false })
    stored.migrated = false
    await ads.openPrivacyOptions() // Settings reached before initAds() ran
    expect(log.indexOf('resetConsent')).toBeGreaterThanOrEqual(0)
    expect(log.indexOf('resetConsent')).toBeLessThan(log.indexOf('ask:settings'))
    await ads.initAds()
    expect(log.filter((l) => l === 'resetConsent')).toHaveLength(1)
  })
})

describe('answers are counted — on the device, by what opened the question and how it ended', () => {
  it('records the trigger and the result, nothing else', async () => {
    const ads = await freshAds()
    answer = 'UNKNOWN'
    await ads.maybeShowInterstitial(1)
    answer = 'DENIED'
    await ads.watchRewardedHint()
    answer = 'GRANTED'
    await ads.openPrivacyOptions()
    expect(tally).toEqual(['afterLevel:unanswered', 'adTap:denied', 'settings:granted'])
  })
})

describe('the ad-free builds ask nothing', () => {
  it('ADS:off: no question from any of the three moments', async () => {
    vi.stubEnv('VITE_ADS', 'off')
    const ads = await freshAds()
    await ads.maybeShowInterstitial(1)
    await expect(ads.watchRewardedHint()).resolves.toBe('earned') // the free-grant path
    await ads.openPrivacyOptions()
    expect(asked).toEqual([])
    expect(fake.init).not.toHaveBeenCalled()
  })
})
