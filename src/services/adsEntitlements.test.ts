import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who starts the ad SDK, who gets a banner, and which builds have no ad surface
 * at all — pinned against a scripted provider.
 *
 * The rules (services/ads.ts header):
 *   - nothing bought     init + banner + interstitials + hint videos
 *   - No Ads ($0.99)     init (the hint video is a real ad) — never a banner or interstitial
 *   - Unlimited ($4.99)  never init: no consent modal, no ATT alert, no ad of any kind
 *   - VITE_ADS=off       no ad surface: not one provider call, the hint video grants free
 *   - VITE_ADS=mock      an ad surface on ANY platform, the desktop browser included
 *
 * A browser cannot catch a regression in any of these — every path no-ops there
 * — which is exactly why a device-only leak would ship unnoticed.
 */

let native = true
const calls: string[] = []
let readyListener: (() => void) | null = null
/** Flipped per test: the SDK refuses a banner request (not initialised yet / no fill). */
let bannerRefused = false
/** Resolver for an init() the test holds open (consent modal still on screen). */
let releaseInit: (() => void) | null = null
let holdInit = false
/** What the provider's consent says (AdProvider.adsAllowed) — flipped per test. */
let consentOk = true
/** The policy layer's consent listener (AdProvider.onConsentChange). */
let consentListener: ((granted: boolean) => void) | null = null
/** What the policy layer told the provider about interstitials (AdProvider.setInterstitialWanted). */
let interstitialWanted: (() => boolean) | null = null
/** Survives freshAds() — it is the device's storage, not module state. */
const stored = { consentMigrated: false }

const record = (name: string) =>
  vi.fn(async () => {
    calls.push(name)
  })

const fake = {
  id: 'fake',
  testing: false,
  supports: () => true,
  init: vi.fn(() => {
    calls.push('init')
    return holdInit ? new Promise<void>((r) => (releaseInit = r)) : Promise.resolve()
  }),
  onReady: vi.fn((l: () => void) => {
    readyListener = l
  }),
  retryInit: vi.fn(() => {
    calls.push('retryInit')
  }),
  openPrivacyOptions: record('openPrivacyOptions'),
  // A plain function, not a spy: the ADS:off test asserts no spy was called,
  // and reading consent is not a provider CALL in that sense.
  adsAllowed: () => consentOk,
  onConsentChange: vi.fn((l: (granted: boolean) => void) => {
    consentListener = l
  }),
  resetConsent: record('resetConsent'),
  setInterstitialWanted: vi.fn((w: () => boolean) => {
    interstitialWanted = w
  }),
  bannerShow: vi.fn(async () => {
    calls.push('bannerShow')
    if (bannerRefused) throw new Error('LevelPlay is not initialized. Call initialize() first.')
  }),
  bannerResume: record('bannerResume'),
  bannerHide: record('bannerHide'),
  bannerRemove: record('bannerRemove'),
  loadInterstitial: vi.fn(async () => {
    calls.push('loadInterstitial')
    return true
  }),
  showInterstitial: vi.fn(async () => {
    calls.push('showInterstitial')
    return true
  }),
  loadRewarded: vi.fn(async () => {
    calls.push('loadRewarded')
    return true
  }),
  showRewarded: vi.fn(async () => {
    calls.push('showRewarded')
    return { amount: 1 }
  }),
  resolvesOnPresent: (f: string) => f === 'interstitial',
  watchDismissal: vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} })),
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => (native ? 'ios' : 'web') },
}))
vi.mock('./providers/levelplay', () => ({ levelplayProvider: fake }))
vi.mock('./providers/mock', () => ({ mockProvider: fake }))
vi.mock('./audio', () => ({ resumeAudio: () => {} }))
vi.mock('./music', () => ({ startMusic: () => {}, stopMusic: () => {}, suppressMusic: () => {} }))
vi.mock('./storage', () => ({
  loadAdClears: async () => 3,
  saveAdClears: async () => {},
  loadConsentMigrated: async () => stored.consentMigrated,
  saveConsentMigrated: async () => {
    stored.consentMigrated = true
  },
  loadFreeHintDate: async () => '',
  saveFreeHintDate: async () => {},
  loadHintCount: async () => 0,
  saveHintCount: async () => {},
  saveAdsRemoved: async () => {},
  saveUnlimitedHints: async () => {},
  loadMetaRaw: async () => null,
  saveMetaRaw: async () => {},
}))

type Ads = typeof import('./ads')

async function freshAds(owner: { adsRemoved?: boolean; unlimited?: boolean } = {}): Promise<Ads> {
  vi.resetModules()
  calls.length = 0
  readyListener = null
  bannerRefused = false
  holdInit = false
  releaseInit = null
  consentOk = true
  consentListener = null
  interstitialWanted = null
  for (const f of Object.values(fake)) if (vi.isMockFunction(f)) f.mockClear()
  const ads = await import('./ads')
  ads.primeAdsRemoved(owner.adsRemoved ?? false)
  ads.primeUnlimitedHints(owner.unlimited ?? false)
  return ads
}

/** Let fire-and-forget promises (a `void removeBanner()`) run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

/** Every gate of the interstitial cadence open: past the warm-up, 3 clears stored. */
async function armInterstitial(ads: Ads): Promise<void> {
  await ads.initAds()
  await vi.advanceTimersByTimeAsync(91_000)
}

beforeEach(() => {
  native = true
  stored.consentMigrated = false
  vi.stubEnv('VITE_ADS', '')
  vi.stubEnv('VITE_AD_MODE', '')
  vi.stubEnv('VITE_UNLOCK_ALL', '')
  vi.useFakeTimers({ now: new Date('2026-09-16T10:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('nothing bought — every format', () => {
  it('initialises once, reserves the strip, shows the banner, and is eligible for interstitials', async () => {
    const ads = await freshAds()
    expect(ads.adsSupported()).toBe(true)
    expect(ads.bannerReserve()).toBe(ads.BANNER_RESERVE_DESIGN_PX)
    await ads.initAds()
    await ads.initAds()
    expect(fake.init).toHaveBeenCalledTimes(1)
    await ads.showBanner()
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(91_000)
    expect(ads.interstitialWouldShow(10)).toBe(true)
  })

  it('reserves 50 pt of fixed banner plus 8 pt of air — the strip LevelPlay\'s BANNER fills', async () => {
    const ads = await freshAds()
    expect(ads.BANNER_RESERVE_DESIGN_PX).toBe(58)
  })
})

describe('No Ads owner ($0.99) — the SDK, but never an interrupting format', () => {
  it('still initialises: the hint video is a real rewarded ad', async () => {
    const ads = await freshAds({ adsRemoved: true })
    await ads.initAds()
    expect(fake.init).toHaveBeenCalledTimes(1)
  })

  it('never reserves a strip and never requests a banner', async () => {
    const ads = await freshAds({ adsRemoved: true })
    expect(ads.bannerReserve()).toBe(0)
    await ads.initAds()
    await ads.showBanner()
    readyListener?.()
    ads.adsForegrounded()
    await flush()
    expect(fake.bannerShow).not.toHaveBeenCalled()
    expect(fake.bannerResume).not.toHaveBeenCalled()
  })

  it('never gets an interstitial, with every cadence gate open', async () => {
    const ads = await freshAds({ adsRemoved: true })
    await armInterstitial(ads)
    for (const level of [9, 10, 11, 100, 599]) expect(ads.interstitialWouldShow(level)).toBe(false)
    await expect(ads.maybeShowInterstitial(10)).resolves.toBe(false)
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
  })

  it('watches a REAL video for a hint — no free grant for the cheap product', async () => {
    const ads = await freshAds({ adsRemoved: true })
    await ads.initAds()
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    expect(fake.loadRewarded).toHaveBeenCalledTimes(1)
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
    // and the video is not followed by a banner coming back
    await flush()
    expect(fake.bannerShow).not.toHaveBeenCalled()
  })
})

describe('Unlimited owner ($4.99) — no SDK at all', () => {
  it('never initialises — so no consent modal and no ATT alert', async () => {
    const ads = await freshAds({ adsRemoved: true, unlimited: true })
    await ads.initAds()
    expect(fake.init).not.toHaveBeenCalled()
    expect(fake.resetConsent).not.toHaveBeenCalled()
    ads.adsForegrounded()
    expect(fake.retryInit).not.toHaveBeenCalled()
  })

  it('holds even for a grandfathered owner whose ads flag is not set', async () => {
    const ads = await freshAds({ adsRemoved: false, unlimited: true })
    await ads.initAds()
    expect(fake.init).not.toHaveBeenCalled()
    expect(ads.bannerReserve()).toBe(0)
    await ads.showBanner()
    expect(fake.bannerShow).not.toHaveBeenCalled()
  })

  it('no interstitial, ever', async () => {
    const ads = await freshAds({ adsRemoved: true, unlimited: true })
    await armInterstitial(ads)
    expect(ads.interstitialWouldShow(10)).toBe(false)
    await expect(ads.maybeShowInterstitial(10)).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('purchases mid-session', () => {
  it('No Ads tears the banner down at once', async () => {
    const ads = await freshAds()
    await ads.initAds()
    await ads.showBanner()
    ads.setAdsRemoved(true)
    await flush()
    expect(fake.bannerRemove).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(91_000)
    expect(ads.interstitialWouldShow(10)).toBe(false)
  })

  it('Unlimited tears it down too', async () => {
    const ads = await freshAds()
    await ads.initAds()
    await ads.showBanner()
    ads.setUnlimitedHints(true)
    await flush()
    expect(fake.bannerRemove).toHaveBeenCalledTimes(1)
  })

  it('No Ads still tears down a banner whose request FAILED — its native view stays attached', async () => {
    // The plugin adds the banner view before it loads and leaves it there when
    // the load fails, for LevelPlay's own reload to fill later. A purchase keyed
    // on "the request succeeded" left the paying player that live banner.
    const ads = await freshAds()
    await ads.initAds()
    bannerRefused = true
    await ads.showBanner()
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    ads.setAdsRemoved(true)
    await flush()
    expect(fake.bannerRemove).toHaveBeenCalledTimes(1)
  })

  it('a failed banner request is still hidden under a full-screen ad — it may fill on its own', async () => {
    const ads = await freshAds()
    await ads.initAds()
    bannerRefused = true
    await ads.showBanner()
    calls.length = 0
    await ads.showRewardedHint()
    expect(calls.indexOf('bannerHide')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('bannerHide')).toBeLessThan(calls.indexOf('showRewarded'))
  })

  it('a boot re-delivery before any banner exists reaches no plugin', async () => {
    const ads = await freshAds()
    ads.setAdsRemoved(true)
    await flush()
    expect(fake.bannerRemove).not.toHaveBeenCalled()
  })
})

describe('banner — requested once, re-asked until it exists', () => {
  it('parks a request until init() settles — the SDK refuses a banner before it is up', async () => {
    const ads = await freshAds()
    holdInit = true
    const init = ads.initAds()
    const banner = ads.showBanner()
    await vi.advanceTimersByTimeAsync(5_000) // player still reading the consent modal
    expect(fake.bannerShow).not.toHaveBeenCalled()
    releaseInit?.()
    await init
    await banner
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
  })

  it('concurrent requests share one creation — never two native banner views', async () => {
    const ads = await freshAds()
    await ads.initAds()
    await Promise.all([ads.showBanner(), ads.showBanner(), ads.showBanner()])
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    await ads.showBanner()
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    expect(fake.bannerResume).toHaveBeenCalled()
  })

  it('a refused first request is re-asked when the SDK comes up late (onReady)', async () => {
    const ads = await freshAds()
    await ads.initAds()
    expect(readyListener).not.toBeNull()
    bannerRefused = true
    await ads.showBanner() // consent was UNKNOWN at boot: refused
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    bannerRefused = false
    readyListener?.() // the player accepts from Privacy choices; the SDK starts
    await flush()
    expect(fake.bannerShow).toHaveBeenCalledTimes(2)
  })

  it('a return to the foreground retries init and re-asks for the banner — only after initAds() ran', async () => {
    const ads = await freshAds()
    ads.adsForegrounded() // splash still up
    expect(fake.retryInit).not.toHaveBeenCalled()
    await ads.initAds()
    bannerRefused = true
    await ads.showBanner()
    bannerRefused = false
    ads.adsForegrounded()
    await flush()
    expect(fake.retryInit).toHaveBeenCalledTimes(1)
    expect(fake.bannerShow).toHaveBeenCalledTimes(2)
  })

  it('hides under a full-screen ad and comes back after it', async () => {
    const ads = await freshAds()
    await ads.initAds()
    await ads.showBanner()
    calls.length = 0
    await ads.showRewardedHint()
    await flush()
    expect(calls.indexOf('bannerHide')).toBeLessThan(calls.indexOf('showRewarded'))
    expect(calls.lastIndexOf('bannerResume')).toBeGreaterThan(calls.indexOf('showRewarded'))
  })
})

describe('Privacy choices', () => {
  it('delegates to the provider where there is an ad surface', async () => {
    const ads = await freshAds()
    await ads.openPrivacyOptions()
    expect(fake.openPrivacyOptions).toHaveBeenCalledTimes(1)
  })

  it('consent withdrawn mid-session: the banner comes down, and no interstitial or hint video is offered again', async () => {
    // The SDK cannot be stopped once up; the modal the player just answered says
    // a decline means "no ads and no hint videos", so this layer keeps that promise.
    const ads = await freshAds()
    await armInterstitial(ads)
    await ads.showBanner()
    expect(ads.interstitialWouldShow(10)).toBe(true)
    expect(ads.rewardedOffered()).toBe(true)
    consentOk = false
    consentListener?.(false)
    await flush()
    expect(fake.bannerRemove).toHaveBeenCalledTimes(1)
    expect(ads.interstitialWouldShow(10)).toBe(false)
    await expect(ads.maybeShowInterstitial(10)).resolves.toBe(false)
    expect(ads.rewardedOffered()).toBe(false)
    await expect(ads.watchRewardedHint()).resolves.toBe('unavailable')
    // …and nothing brings the banner back while the answer is no.
    await ads.showBanner()
    readyListener?.()
    ads.adsForegrounded()
    await flush()
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
    expect(fake.loadRewarded).not.toHaveBeenCalled()
  })

  it('a later yes brings every surface back — the next banner request goes through', async () => {
    const ads = await freshAds()
    consentOk = false
    await armInterstitial(ads)
    await ads.showBanner()
    expect(fake.bannerShow).not.toHaveBeenCalled() // declined at boot: never even asked
    consentOk = true
    consentListener?.(true)
    readyListener?.() // the SDK starts on the new yes
    await flush()
    expect(fake.bannerShow).toHaveBeenCalledTimes(1)
    expect(ads.rewardedOffered()).toBe(true)
    expect(ads.interstitialWouldShow(10)).toBe(true)
  })

  it('a consent withdrawn while the banner is still being created removes it once it lands', async () => {
    const ads = await freshAds()
    await ads.initAds()
    let land!: () => void
    fake.bannerShow.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          calls.push('bannerShow')
          land = r
        }),
    )
    const banner = ads.showBanner()
    await flush()
    consentOk = false
    consentListener?.(false)
    await flush()
    land()
    await banner
    await flush()
    expect(fake.bannerRemove).toHaveBeenCalled()
    expect(calls.lastIndexOf('bannerRemove')).toBeGreaterThan(calls.indexOf('bannerShow'))
  })
})

describe('interstitial prefetch — only for a player who can be shown one', () => {
  /*
   * A No-Ads owner starts the SDK for hint videos. Without this predicate the
   * provider would keep loading (and retrying) interstitials that are never shown.
   */
  it('wants interstitials at boot, and stops wanting them after a No Ads purchase', async () => {
    const ads = await freshAds()
    await ads.initAds()
    expect(interstitialWanted?.()).toBe(true)
    ads.setAdsRemoved(true)
    expect(interstitialWanted?.()).toBe(false)
  })

  it('stops wanting them after an Unlimited purchase mid-session', async () => {
    const ads = await freshAds()
    await ads.initAds()
    ads.setUnlimitedHints(true)
    expect(interstitialWanted?.()).toBe(false)
  })

  it('a No Ads owner never wants one from the first launch', async () => {
    const ads = await freshAds({ adsRemoved: true })
    await ads.initAds()
    expect(interstitialWanted?.()).toBe(false)
  })
})

describe('the one-time consent reset — 1.2.0 asked through Google, not LevelPlay', () => {
  /*
   * 1.2.0's consent form left IAB TCF keys the LevelPlay plugin reads as its own
   * decision, skipping the "Ads and your data" modal for upgraders. initAds()
   * resets them once per install, before the provider asks for consent.
   */
  it('the first launch resets consent BEFORE init() — and a relaunch never again', async () => {
    let ads = await freshAds()
    await ads.initAds()
    expect(calls.filter((c) => c === 'resetConsent')).toHaveLength(1)
    expect(calls.indexOf('resetConsent')).toBeLessThan(calls.indexOf('init'))
    expect(stored.consentMigrated).toBe(true)

    ads = await freshAds() // relaunch: fresh module state, same device storage
    await ads.initAds()
    expect(fake.init).toHaveBeenCalledTimes(1)
    expect(calls).not.toContain('resetConsent')
  })

  it('a second initAds() in the same session does not reset again', async () => {
    const ads = await freshAds()
    await ads.initAds()
    await ads.initAds()
    expect(fake.resetConsent).toHaveBeenCalledTimes(1)
  })

  it('a No Ads owner is migrated too — the hint video still asks for consent', async () => {
    const ads = await freshAds({ adsRemoved: true })
    await ads.initAds()
    expect(calls.indexOf('resetConsent')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('resetConsent')).toBeLessThan(calls.indexOf('init'))
  })
})

describe('ADS:off build — no ad surface, not one provider call', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADS', 'off')
  })

  it('has no ad surface on a native device', async () => {
    const ads = await freshAds()
    expect(ads.adsSupported()).toBe(false)
  })

  it('every public entry point is inert, and the hint video grants without an ad', async () => {
    const ads = await freshAds()
    expect(ads.bannerReserve()).toBe(0)
    await ads.initAds()
    await ads.showBanner()
    ads.adsForegrounded()
    await ads.openPrivacyOptions()
    await vi.advanceTimersByTimeAsync(91_000)
    ads.noteCleared()
    ads.noteCleared()
    ads.noteCleared()
    expect(ads.interstitialWouldShow(10)).toBe(false)
    await expect(ads.maybeShowInterstitial(10)).resolves.toBe(false)
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    expect(ads.rewardedOffered()).toBe(true) // the free-grant path always pays
    ads.setAdsRemoved(true)
    ads.setUnlimitedHints(true)
    await ads.removeBanner()
    await ads.hideBanner()
    await flush()
    expect(calls).toEqual([])
    for (const f of Object.values(fake)) if (vi.isMockFunction(f)) expect(f, f.getMockName()).not.toHaveBeenCalled()
  })
})

describe('where there is an ad surface', () => {
  it('a browser without VITE_ADS=mock has none — and the hint video stays testable', async () => {
    native = false
    const ads = await freshAds()
    expect(ads.adsSupported()).toBe(false)
    expect(ads.bannerReserve()).toBe(0)
    await ads.initAds()
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    expect(ads.rewardedOffered()).toBe(true)
    expect(calls).toEqual([])
    expect(stored.consentMigrated).toBe(false) // nothing to migrate where there is no SDK
  })

  it('VITE_ADS=mock has one on ANY platform, the desktop browser included', async () => {
    native = false
    vi.stubEnv('VITE_ADS', 'mock')
    const ads = await freshAds()
    expect(ads.adsSupported()).toBe(true)
    expect(ads.bannerReserve()).toBe(ads.BANNER_RESERVE_DESIGN_PX)
    await ads.initAds()
    expect(fake.init).toHaveBeenCalledTimes(1)
    // a real (fake) video now: no free grant in the mock build
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
  })

  it('only the exact value "mock" turns the browser on', async () => {
    native = false
    for (const almost of ['Mock', 'MOCK', 'mocked', ' mock', 'on', '1']) {
      vi.stubEnv('VITE_ADS', almost)
      const ads = await freshAds()
      expect(ads.adsSupported(), JSON.stringify(almost)).toBe(false)
    }
  })
})
