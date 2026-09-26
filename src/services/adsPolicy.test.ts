import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalOf, PACKS, TOTAL_LEVELS } from '../game/levels'

/**
 * The ad POLICY — when an interstitial may interrupt, and what a hint video has
 * to do before it pays out — pinned against a scripted provider.
 *
 * Every path here no-ops in a browser (no ad surface), so a regression would be
 * invisible during development and only show up as a player-facing bug on a
 * device: an ad on the first clear of a session, a next level starting under a
 * live ad, a skipped video handing out a hint, or a game left asleep because a
 * show never came back. The PROVIDER is the seam these tests stand on; the
 * plugin itself is only mocked in providers/levelplay.test.ts.
 */

// ── scripted provider ────────────────────────────────────────────────────────
const log: string[] = []
const script = {
  loadInterstitial: true as boolean | 'hang',
  /** present: on screen, then waits for dismissal · fail: DisplayFailed · reject: plugin refused · hang: nothing */
  interstitial: 'present' as 'present' | 'fail' | 'reject' | 'hang',
  loadRewarded: true as boolean | 'hang',
  /** earn: reward then close · skip: close without reward · late: close, reward 300 ms later · fail: DisplayFailed */
  rewarded: 'earn' as 'earn' | 'skip' | 'late' | 'fail',
  /** false leaves a presented ad on screen until the test calls closeAd(). */
  autoDismiss: true,
  /** What the provider's consent says (AdProvider.adsAllowed). */
  consent: true,
}

let openWatcher: (() => void) | null = null
let rewardResolver: ((v: unknown) => void) | null = null

/** The player closes whatever ad is up. */
function closeAd(): void {
  const w = openWatcher
  openWatcher = null
  w?.()
}

const fake = {
  id: 'fake',
  testing: false,
  supports: () => true,
  init: vi.fn(async () => {
    log.push('init')
  }),
  onReady: vi.fn(),
  retryInit: vi.fn(),
  openPrivacyOptions: vi.fn(async () => {}),
  adsAllowed: () => script.consent,
  resetConsent: vi.fn(async () => {
    log.push('resetConsent')
  }),
  bannerShow: vi.fn(async () => {
    log.push('bannerShow')
  }),
  bannerResume: vi.fn(async () => {
    log.push('bannerResume')
  }),
  bannerHide: vi.fn(async () => {
    log.push('bannerHide')
  }),
  bannerRemove: vi.fn(async () => {
    log.push('bannerRemove')
  }),
  loadInterstitial: vi.fn(() => {
    log.push('loadInterstitial')
    return script.loadInterstitial === 'hang' ? new Promise<boolean>(() => {}) : Promise.resolve(script.loadInterstitial)
  }),
  showInterstitial: vi.fn(() => {
    log.push('showInterstitial')
    switch (script.interstitial) {
      case 'present':
        if (script.autoDismiss) void Promise.resolve().then(closeAd)
        return Promise.resolve(true)
      case 'fail':
        closeAd() // DisplayFailed is also a terminal event for the watcher
        return Promise.resolve(false)
      case 'reject':
        return Promise.reject(new Error('The interstitial ad is not ready yet.'))
      default:
        return new Promise<boolean>(() => {})
    }
  }),
  loadRewarded: vi.fn(() => {
    log.push('loadRewarded')
    return script.loadRewarded === 'hang' ? new Promise<boolean>(() => {}) : Promise.resolve(script.loadRewarded)
  }),
  showRewarded: vi.fn(() => {
    log.push('showRewarded')
    // Like LevelPlay: settles ONLY on the reward, or null on a failed present.
    return new Promise<unknown>((resolve) => {
      rewardResolver = resolve
      switch (script.rewarded) {
        case 'earn':
          void Promise.resolve().then(() => {
            resolve({ amount: 1 })
            closeAd()
          })
          break
        case 'skip':
          void Promise.resolve().then(closeAd)
          break
        case 'late':
          void Promise.resolve().then(() => {
            closeAd()
            setTimeout(() => resolve({ amount: 1 }), 300)
          })
          break
        case 'fail':
          void Promise.resolve().then(() => {
            resolve(null)
            closeAd()
          })
          break
      }
    })
  }),
  resolvesOnPresent: (f: string) => f === 'interstitial',
  watchDismissal: vi.fn((format: string, timeoutMs: number) => {
    log.push(`watch:${format}`)
    let resolve!: () => void
    const done = new Promise<void>((r) => (resolve = r))
    const timer = setTimeout(resolve, timeoutMs)
    openWatcher = () => {
      clearTimeout(timer)
      resolve()
    }
    return {
      done,
      cancel: () => {
        clearTimeout(timer)
        resolve()
      },
    }
  }),
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))
vi.mock('./providers/levelplay', () => ({ levelplayProvider: fake }))
vi.mock('./providers/mock', () => ({ mockProvider: fake }))
vi.mock('./audio', () => ({ resumeAudio: () => log.push('resumeAudio') }))
vi.mock('./music', () => ({
  startMusic: () => log.push('startMusic'),
  stopMusic: () => log.push('stopMusic'),
  suppressMusic: (on: boolean) => log.push(on ? 'hold:on' : 'hold:off'),
}))
const stored = { adClears: 0, consentMigrated: false }
vi.mock('./storage', () => ({
  loadAdClears: async () => stored.adClears,
  saveAdClears: async (n: number) => {
    stored.adClears = n
  },
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

/** A fresh session: new module state, the clock at launch. */
async function freshAds(): Promise<Ads> {
  vi.resetModules()
  log.length = 0
  stored.adClears = 0
  stored.consentMigrated = false
  openWatcher = null
  rewardResolver = null
  Object.assign(script, {
    loadInterstitial: true,
    interstitial: 'present',
    loadRewarded: true,
    rewarded: 'earn',
    autoDismiss: true,
    consent: true,
  })
  for (const f of Object.values(fake)) if (vi.isMockFunction(f)) f.mockClear()
  const ads = await import('./ads')
  ads.setGameLoopHooks({ pause: () => log.push('loop:pause'), resume: () => log.push('loop:resume') })
  await ads.initAds()
  return ads
}

const seconds = (s: number) => vi.advanceTimersByTimeAsync(s * 1000)
/**
 * Await an ad call while the fake clock runs — a skipped video only resolves
 * after the reward grace timer, which a plain await would never fire. Throws if
 * it has not settled within `s` seconds, which is the "never hangs" assertion.
 */
async function within<T>(p: Promise<T>, s = 2): Promise<T> {
  let done = false
  let value!: T
  void p.then((v) => {
    done = true
    value = v
  })
  await seconds(s)
  if (!done) throw new Error(`did not settle within ${s} s`)
  return value
}
const clears = (ads: Ads, n: number) => {
  for (let i = 0; i < n; i++) ads.noteCleared()
}
/** An ordinary mid-pack level past onboarding. */
const LEVEL = 10

beforeEach(() => {
  // Pin a NORMAL build: the release chains run this suite with their own
  // VITE_* exported (`build:tf` sets VITE_ADS=off) before `vite build` runs.
  vi.stubEnv('VITE_ADS', '')
  vi.stubEnv('VITE_AD_MODE', '')
  vi.stubEnv('VITE_UNLOCK_ALL', '')
  vi.useFakeTimers({ now: new Date('2026-09-16T10:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('interstitial cadence — unchanged by the network move', () => {
  it('never in the first 8 levels (onboarding)', async () => {
    const ads = await freshAds()
    await seconds(91)
    clears(ads, 3)
    for (let level = 1; level <= 8; level++) expect(ads.interstitialWouldShow(level), `L${level}`).toBe(false)
    expect(ads.interstitialWouldShow(9)).toBe(true)
  })

  it('never on a pack-complete clear — every pack boundary, derived from the real pack data', async () => {
    const ads = await freshAds()
    await seconds(91)
    clears(ads, 3)
    const finales = PACKS.map((pack, i) => globalOf(i, pack.levels.length - 1))
    expect(finales).toHaveLength(PACKS.length)
    expect(finales).toContain(TOTAL_LEVELS) // the "The End!" clear
    expect(finales.slice(0, 3)).toEqual([24, 48, 72]) // what the old hard-coded rule covered
    for (const f of finales) {
      expect(ads.interstitialWouldShow(f), `pack finale L${f}`).toBe(false)
      expect(ads.interstitialWouldShow(f - 1), `L${f - 1}`).toBe(true)
    }
    await expect(ads.maybeShowInterstitial(TOTAL_LEVELS)).resolves.toBe(false)
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
  })

  it('needs 3 clears since the last interstitial', async () => {
    const ads = await freshAds()
    await seconds(91)
    clears(ads, 2)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(false)
    clears(ads, 1)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
  })

  it('counts clears across launches — the counter is persisted', async () => {
    stored.adClears = 0
    let ads = await freshAds()
    clears(ads, 2)
    expect(stored.adClears).toBe(2)
    // next launch: freshAds() zeroes the store, so model the relaunch by hand
    vi.resetModules()
    stored.adClears = 2
    ads = await import('./ads')
    await ads.initAds()
    await seconds(91)
    clears(ads, 1)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
  })

  it('no interstitial in the first 90 s of a session (warm-up)', async () => {
    const ads = await freshAds()
    clears(ads, 3)
    await seconds(89)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(false)
    await seconds(1)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
  })

  it('180 s floor between two interstitials', async () => {
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(true)
    clears(ads, 3)
    await seconds(179)
    expect(ads.interstitialWouldShow(LEVEL + 3)).toBe(false)
    await seconds(1)
    expect(ads.interstitialWouldShow(LEVEL + 3)).toBe(true)
  })

  it('at most 3 interstitials per session', async () => {
    const ads = await freshAds()
    await seconds(90)
    for (let i = 0; i < 3; i++) {
      clears(ads, 3)
      await expect(ads.maybeShowInterstitial(LEVEL + i * 3), `ad ${i + 1}`).resolves.toBe(true)
      await seconds(180)
    }
    clears(ads, 3)
    await seconds(3600)
    expect(ads.interstitialWouldShow(LEVEL + 9)).toBe(false)
    await expect(ads.maybeShowInterstitial(LEVEL + 9)).resolves.toBe(false)
    expect(fake.showInterstitial).toHaveBeenCalledTimes(3)
  })

  it('an earned hint video mutes interstitials for 300 s', async () => {
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    await seconds(299)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(false)
    await seconds(1)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
  })

  it('a SKIPPED hint video suppresses nothing — only an opt-in that paid out counts', async () => {
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    script.rewarded = 'skip'
    expect(await within(ads.showRewardedHint())).toBe(false)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
  })

  it('no interstitial without ad consent — with every other gate open', async () => {
    // Also the path for a consent withdrawn from Privacy choices mid-session: the
    // SDK is still up and could serve, and the consent modal promised it won't.
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
    script.consent = false
    expect(ads.interstitialWouldShow(LEVEL)).toBe(false)
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(false)
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
  })

  it('the predicate does not consume anything — the review prompt reads it freely', async () => {
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    for (let i = 0; i < 5; i++) expect(ads.interstitialWouldShow(LEVEL)).toBe(true)
    expect(fake.loadInterstitial).not.toHaveBeenCalled()
  })
})

describe('interstitial flow — navigation waits for the player to be done', () => {
  async function armed(): Promise<Ads> {
    const ads = await freshAds()
    await seconds(90)
    clears(ads, 3)
    return ads
  }

  it('resolves only after the ad is DISMISSED, not when it appears', async () => {
    const ads = await armed()
    script.autoDismiss = false
    let settled = false
    const pending = ads.maybeShowInterstitial(LEVEL).then((v) => {
      settled = true
      return v
    })
    await seconds(60) // the player sits on the ad for a minute
    expect(fake.showInterstitial).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    closeAd()
    await expect(pending).resolves.toBe(true)
  })

  it('quiets the game around the ad and gives everything back after', async () => {
    const ads = await armed()
    await ads.maybeShowInterstitial(LEVEL)
    const at = (e: string) => log.indexOf(e)
    // before the show: loop asleep, music stopped, banner hidden, watcher attached
    for (const before of ['loop:pause', 'stopMusic', 'watch:interstitial']) {
      expect(at(before), before).toBeGreaterThanOrEqual(0)
      expect(at(before), before).toBeLessThan(at('showInterstitial'))
    }
    // after: loop awake, audio nudged, music back
    for (const after of ['loop:resume', 'resumeAudio', 'startMusic']) {
      expect(at(after), after).toBeGreaterThan(at('showInterstitial'))
    }
  })

  it('spends the cadence only on a PRESENTED ad', async () => {
    const ads = await armed()
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(true)
    expect(stored.adClears).toBe(0)
    expect(ads.interstitialWouldShow(LEVEL + 3)).toBe(false) // counter reset, floor started
  })

  it('no fill: resolves false at once, keeps the cadence armed, and never quiets the game', async () => {
    const ads = await armed()
    script.loadInterstitial = false
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(false)
    expect(fake.showInterstitial).not.toHaveBeenCalled()
    expect(log).not.toContain('loop:pause')
    expect(log).not.toContain('stopMusic')
    expect(ads.interstitialWouldShow(LEVEL + 1)).toBe(true)
  })

  it('a win card that made another ask (reminders, review, no-ads nudge) is never followed by an interstitial, and keeps the cadence armed', async () => {
    const ads = await armed()
    expect(ads.interstitialWouldShow(LEVEL, { cardAsk: true })).toBe(false)
    await expect(ads.maybeShowInterstitial(LEVEL, { cardAsk: true })).resolves.toBe(false)
    expect(fake.showInterstitial).not.toHaveBeenCalled()
    expect(ads.interstitialWouldShow(LEVEL + 1)).toBe(true) // the break moves to the next clear
  })

  it('a win card offering a reward is never followed by an interstitial either', async () => {
    const ads = await armed()
    await expect(ads.maybeShowInterstitial(LEVEL, { rewardPrompt: true })).resolves.toBe(false)
    expect(fake.showInterstitial).not.toHaveBeenCalled()
    expect(ads.interstitialWouldShow(LEVEL + 1)).toBe(true)
  })

  it('a failed present resolves false without waiting for a close that never comes', async () => {
    const ads = await armed()
    script.interstitial = 'fail'
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(false)
    expect(log).toContain('loop:resume')
    expect(log).toContain('startMusic')
    expect(ads.interstitialWouldShow(LEVEL + 1)).toBe(true) // still armed
  })

  it('holds the music down for the whole ad, and lets go before restarting it', async () => {
    // music.ts restarts the bed on every visibility/focus event; the hold is what
    // keeps a return from the advertiser's page from starting it under the ad.
    const ads = await armed()
    script.autoDismiss = false
    const pending = ads.maybeShowInterstitial(LEVEL)
    await seconds(30) // the ad is up
    expect(log.filter((e) => e.startsWith('hold:'))).toEqual(['hold:on'])
    closeAd()
    await expect(pending).resolves.toBe(true)
    const at = (e: string) => log.indexOf(e)
    expect(at('hold:on')).toBeLessThan(at('stopMusic'))
    expect(at('hold:on')).toBeLessThan(at('showInterstitial'))
    expect(at('hold:off')).toBeGreaterThan(at('showInterstitial'))
    expect(at('hold:off')).toBeLessThan(log.lastIndexOf('startMusic'))
  })

  it('releases the music hold however the ad ended — refused, failed, abandoned, skipped', async () => {
    const cases: [string, (ads: Ads) => Promise<unknown>][] = [
      ['interstitial refused', (ads) => ((script.interstitial = 'reject'), ads.maybeShowInterstitial(LEVEL))],
      ['interstitial failed', (ads) => ((script.interstitial = 'fail'), ads.maybeShowInterstitial(LEVEL))],
      ['interstitial never answered', (ads) => ((script.interstitial = 'hang'), ads.maybeShowInterstitial(LEVEL))],
      ['video skipped', (ads) => ((script.rewarded = 'skip'), ads.showRewardedHint())],
      ['video failed', (ads) => ((script.rewarded = 'fail'), ads.showRewardedHint())],
    ]
    for (const [name, run] of cases) {
      const ads = await armed()
      await within(run(ads), 20)
      const holds = log.filter((e) => e.startsWith('hold:'))
      expect(holds, name).toEqual(['hold:on', 'hold:off'])
      expect(log.lastIndexOf('startMusic'), name).toBeGreaterThan(log.indexOf('hold:off'))
    }
  })

  it('a refused show (plugin rejects) never parks the game on the dismissal timeout', async () => {
    const ads = await armed()
    script.interstitial = 'reject'
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(false)
    expect(log).toContain('loop:resume')
    expect(ads.interstitialWouldShow(LEVEL + 1)).toBe(true)
  })

  it('a show that never answers is abandoned after the load ceiling, loop awake again', async () => {
    const ads = await armed()
    script.interstitial = 'hang'
    let result: boolean | undefined
    void ads.maybeShowInterstitial(LEVEL).then((v) => (result = v))
    await seconds(16)
    expect(result).toBe(false)
    expect(log).toContain('loop:resume')
  })

  it('a load that never answers is abandoned too', async () => {
    const ads = await armed()
    script.loadInterstitial = 'hang'
    let result: boolean | undefined
    void ads.maybeShowInterstitial(LEVEL).then((v) => (result = v))
    await seconds(16)
    expect(result).toBe(false)
  })

  it('never stacks on a hint video that is still up', async () => {
    const ads = await armed()
    script.rewarded = 'skip'
    script.autoDismiss = false
    fake.showRewarded.mockImplementationOnce(() => new Promise(() => {})) // video stays up
    const video = ads.showRewardedHint()
    await seconds(1)
    await expect(ads.maybeShowInterstitial(LEVEL)).resolves.toBe(false)
    expect(fake.showInterstitial).not.toHaveBeenCalled()
    closeAd()
    expect(await within(video)).toBe(false)
  })
})

describe('rewarded hint — pays out only on a reward actually earned', () => {
  it('earned → true', async () => {
    const ads = await freshAds()
    await expect(ads.showRewardedHint()).resolves.toBe(true)
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
  })

  it('closed early → false: no reward, and the game is given back', async () => {
    const ads = await freshAds()
    script.rewarded = 'skip'
    expect(await within(ads.showRewardedHint())).toBe(false)
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
    expect(log).toContain('loop:resume')
    expect(log).toContain('startMusic')
  })

  it('a reward that lands just AFTER the close still counts', async () => {
    // Some adapters report the close before the reward; without the grace a
    // player who watched the whole video would get nothing.
    const ads = await freshAds()
    script.rewarded = 'late'
    let result: boolean | undefined
    void ads.showRewardedHint().then((v) => (result = v))
    await seconds(1)
    expect(result).toBe(true)
  })

  it('a reward that never comes after the close → false within the grace, not a hang', async () => {
    const ads = await freshAds()
    script.rewarded = 'skip'
    let result: boolean | undefined
    void ads.showRewardedHint().then((v) => (result = v))
    await seconds(1)
    expect(result).toBe(false)
  })

  it('failed present → false at once', async () => {
    const ads = await freshAds()
    script.rewarded = 'fail'
    await expect(ads.showRewardedHint()).resolves.toBe(false)
  })

  it('no fill → false without pausing anything', async () => {
    const ads = await freshAds()
    script.loadRewarded = false
    await expect(ads.showRewardedHint()).resolves.toBe(false)
    expect(fake.showRewarded).not.toHaveBeenCalled()
    expect(log).not.toContain('loop:pause')
  })

  it('a load that never answers resolves false after the ceiling', async () => {
    const ads = await freshAds()
    script.loadRewarded = 'hang'
    let result: boolean | undefined
    void ads.showRewardedHint().then((v) => (result = v))
    await seconds(16)
    expect(result).toBe(false)
  })

  it('attaches the dismissal watcher BEFORE showing', async () => {
    const ads = await freshAds()
    await ads.showRewardedHint()
    expect(log.indexOf('watch:rewarded')).toBeLessThan(log.indexOf('showRewarded'))
    expect(log.indexOf('stopMusic')).toBeLessThan(log.indexOf('showRewarded'))
    expect(log.indexOf('loop:pause')).toBeLessThan(log.indexOf('showRewarded'))
  })

  it('shows ONE video per tap — the race never calls show twice', async () => {
    const ads = await freshAds()
    script.rewarded = 'late'
    void ads.showRewardedHint()
    await seconds(2)
    expect(fake.showRewarded).toHaveBeenCalledTimes(1)
    expect(rewardResolver).not.toBeNull()
  })
})

describe('rewarded outcome — what the hint modal can truthfully tell the player', () => {
  it('earned → "earned"', async () => {
    const ads = await freshAds()
    await expect(ads.watchRewardedHint()).resolves.toBe('earned')
  })

  it('no fill → "unavailable": nothing was shown, so "no video available right now" is true', async () => {
    const ads = await freshAds()
    script.loadRewarded = false
    await expect(ads.watchRewardedHint()).resolves.toBe('unavailable')
    expect(fake.showRewarded).not.toHaveBeenCalled()
  })

  it('a load that never answers → "unavailable" after the ceiling', async () => {
    const ads = await freshAds()
    script.loadRewarded = 'hang'
    expect(await within(ads.watchRewardedHint(), 16)).toBe('unavailable')
  })

  it('closed early → "not-earned" — a video WAS shown, so "no video available" would be false', async () => {
    const ads = await freshAds()
    script.rewarded = 'skip'
    expect(await within(ads.watchRewardedHint())).toBe('not-earned')
  })

  it('failed present → "not-earned"', async () => {
    const ads = await freshAds()
    script.rewarded = 'fail'
    await expect(ads.watchRewardedHint()).resolves.toBe('not-earned')
  })

  it('another full-screen ad still up → "unavailable", and no second ad', async () => {
    const ads = await freshAds()
    script.autoDismiss = false
    fake.showRewarded.mockImplementationOnce(() => new Promise(() => {})) // first video stays up
    const first = ads.watchRewardedHint()
    await seconds(1)
    await expect(ads.watchRewardedHint()).resolves.toBe('unavailable')
    expect(fake.loadRewarded).toHaveBeenCalledTimes(1)
    closeAd()
    expect(await within(first)).toBe('not-earned')
  })

  it('without ad consent the video is not offered, and a tap that asks anyway touches no network', async () => {
    const ads = await freshAds()
    expect(ads.rewardedOffered()).toBe(true)
    script.consent = false
    expect(ads.rewardedOffered()).toBe(false)
    await expect(ads.watchRewardedHint()).resolves.toBe('unavailable')
    await expect(ads.showRewardedHint()).resolves.toBe(false)
    expect(fake.loadRewarded).not.toHaveBeenCalled()
    expect(fake.showRewarded).not.toHaveBeenCalled()
    // A yes from Privacy choices brings the offer straight back — no restart needed.
    script.consent = true
    expect(ads.rewardedOffered()).toBe(true)
  })
})
