import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_COPY } from '../adConsentCopy'

/**
 * The LevelPlay provider is one long event race, and the expensive ways to get it
 * wrong are silent: resolve a rewarded show on the wrong event and a skipped
 * video reads as an earned hint, or the game sits asleep for the whole show
 * timeout; initialise before consent and device data leaves the phone before the
 * player was asked. The policy layer races show() against the dismissal
 * watcher, so exactly which event settles which promise IS the contract — these
 * tests pin it rather than trusting the comments.
 *
 * Ported from KVIZKO's suite for the same plugin version (0.1.42). This is the
 * ONE file that mocks the plugin; the policy tests (services/ads*.test.ts) mock
 * the provider seam instead.
 */

// ── plugin double ────────────────────────────────────────────────────────────
// A tiny event bus standing in for the native SDK, so a test can say "the ad
// closed" and watch what the provider does about it.
type Handler = (info: unknown) => void
const listeners = new Map<string, Set<Handler>>()
const calls: string[] = []
/** Flipped per test: the answer the plugin has stored (getConsentData()). */
let consentStatus = 'GRANTED'
/**
 * Flipped per test: what the player taps when the consent alert is on screen.
 * null = nobody answers (the call just resolves, like an alert the player is
 * still reading past the ceiling). requestConsentInfo() shows the alert only
 * while no answer is stored; showPrivacyOptions() always does — as natively.
 */
let alertAnswer: 'GRANTED' | 'DENIED' | null = null
/** How many times the native alert was actually put on screen. */
let alertsShown = 0
/** Flipped per test: what the SDK says it holds when asked isReady(). */
const ready = { interstitial: false, rewarded: false }
/** Flipped per test: initialize() rejects, the way it does with no network. */
let initFails = false
/** Set per test: initialize() stays pending until the test calls it (an SDK still starting). */
let releaseInit: (() => void) | null = null
let holdInit = false
/** Set per test: the ATT alert stays on screen until the test answers it. */
let answerAtt: (() => void) | null = null
let holdAtt = false
/** Flipped per test: resetConsent() rejects (a plugin build without it). */
let resetFails = false
/** The last argument each plugin call received, by name. */
const argsOf: Record<string, unknown> = {}

function emit(event: string, info: unknown = {}): void {
  for (const h of [...(listeners.get(event) ?? [])]) h(info)
}
function listenerCount(): number {
  let n = 0
  for (const set of listeners.values()) n += set.size
  return n
}

// The provider picks its app key and unit ids by platform, so the test has to
// look like one.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))

vi.mock('capacitor-levelplay-ads', () => {
  const AdEvent = {
    InterstitialLoaded: 'onInterstitialAdLoaded',
    InterstitialLoadFailed: 'onInterstitialAdLoadFailed',
    InterstitialDisplayed: 'onInterstitialAdDisplayed',
    InterstitialDisplayFailed: 'onInterstitialAdDisplayFailed',
    InterstitialClosed: 'onInterstitialAdClosed',
    RewardedLoaded: 'onRewardedAdLoaded',
    RewardedLoadFailed: 'onRewardedAdLoadFailed',
    RewardedDisplayed: 'onRewardedAdDisplayed',
    RewardedDisplayFailed: 'onRewardedAdDisplayFailed',
    RewardedClosed: 'onRewardedAdClosed',
    RewardedRewarded: 'onRewardedAdRewarded',
    ConsentStatusChanged: 'onConsentStatusChanged',
  }
  const record =
    (name: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push(name)
      argsOf[name] = args[0]
      return Promise.resolve(undefined)
    }
  /** The native consent alert: shown, answered (or not), the answer stored and emitted. */
  const consentCall =
    (name: string, always: boolean) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push(name)
      argsOf[name] = args[0]
      if (always || consentStatus === 'UNKNOWN') {
        alertsShown++
        if (alertAnswer) consentStatus = alertAnswer
      }
      emit('onConsentStatusChanged', { status: consentStatus })
      return Promise.resolve({ status: consentStatus })
    }
  return {
    AdEvent,
    LevelPlayAds: {
      initialize: (...args: unknown[]) => {
        calls.push('initialize')
        argsOf.initialize = args[0]
        if (initFails) return Promise.reject(new Error('init failed: no network'))
        if (holdInit) {
          return new Promise((resolve) => {
            releaseInit = () => resolve({ status: 'INITIALIZED_SUCCESSFULLY' })
          })
        }
        return Promise.resolve({ status: 'INITIALIZED_SUCCESSFULLY' })
      },
      setCCPAConsent: record('setCCPAConsent'),
      setChildDirected: record('setChildDirected'),
      // iOS answers; the provider remembers a decided answer for the process.
      requestTrackingAuthorization: () => {
        calls.push('requestTrackingAuthorization')
        if (holdAtt) return new Promise((resolve) => (answerAtt = () => resolve({ status: 'AUTHORIZED' })))
        return Promise.resolve({ status: 'AUTHORIZED' })
      },
      requestConsentInfo: consentCall('requestConsentInfo', false),
      // Like the native call: clear, then EMIT the fresh (UNKNOWN) status, then resolve.
      resetConsent: () => {
        calls.push('resetConsent')
        if (resetFails) return Promise.reject(new Error('not implemented on this platform'))
        consentStatus = 'UNKNOWN'
        emit('onConsentStatusChanged', { status: 'UNKNOWN' })
        return Promise.resolve({ status: 'UNKNOWN' })
      },
      showPrivacyOptions: consentCall('showPrivacyOptions', true),
      createBanner: record('createBanner'),
      showBanner: record('showBanner'),
      hideBanner: record('hideBanner'),
      destroyBanner: record('destroyBanner'),
      loadInterstitial: record('loadInterstitial'),
      showInterstitial: record('showInterstitial'),
      loadRewarded: record('loadRewarded'),
      showRewarded: record('showRewarded'),
      getAdvertisingId: () => Promise.resolve({ id: 'ADID-1', limited: false }),
      getConsentData: () => {
        calls.push('getConsentData')
        return Promise.resolve({ status: consentStatus })
      },
      isInterstitialReady: () => {
        calls.push('isInterstitialReady')
        return Promise.resolve({ isReady: ready.interstitial })
      },
      isRewardedReady: () => {
        calls.push('isRewardedReady')
        return Promise.resolve({ isReady: ready.rewarded })
      },
      addListener: (event: string, fn: Handler) => {
        calls.push(`addListener:${event}`)
        const set = listeners.get(event) ?? new Set<Handler>()
        set.add(fn)
        listeners.set(event, set)
        return Promise.resolve({ remove: () => set.delete(fn) })
      },
    },
  }
})

const lp = await import('./levelplay')
const provider = lp.levelplayProvider

/**
 * A configured app, with valid-shaped ids that are NOT the real ones. iOS ships
 * its real key and units and Android ships empty ones (no LevelPlay app yet), so
 * the init-path tests stand these in through the test seam: every test runs
 * against the same known values whatever platform the file is configured for,
 * the real ids never reach a plugin double, and nobody edits the file the
 * release gate parses to get a key.
 */
const CONFIGURED = {
  appKey: '0a1b2c3d4',
  units: { banner: 'testbanner000001', interstitial: 'testinterstit002', rewarded: 'testrewarded0003' },
}

/** Let the pending addListener promises resolve before firing anything. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const initializes = () => calls.filter((c) => c === 'initialize').length

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  listeners.clear()
  calls.length = 0
  consentStatus = 'GRANTED'
  alertAnswer = null
  alertsShown = 0
  ready.interstitial = false
  ready.rewarded = false
  initFails = false
  holdInit = false
  releaseInit = null
  holdAtt = false
  answerAtt = null
  resetFails = false
  for (const k of Object.keys(argsOf)) delete argsOf[k]
  lp.__resetForTests(CONFIGURED)
})

describe('formats', () => {
  it('serves banner, interstitial and rewarded', () => {
    for (const f of ['banner', 'interstitial', 'rewarded'] as const) {
      expect(provider.supports(f), f).toBe(true)
    }
  })
})

describe('empty ids — Android ships this way until its LevelPlay app exists', () => {
  it('refuses to start without an app key, BEFORE any consent prompt or SDK call', async () => {
    // With an empty key there is no SDK to consent to: no ATT alert, no modal, no
    // initialize(). The app simply has no ads. Passed explicitly because iOS now
    // carries its real key in the file.
    lp.__resetForTests({ appKey: '', units: { banner: '', interstitial: '', rewarded: '' } })
    await expect(provider.init()).rejects.toThrow(/no app key/)
    expect(calls).toEqual([])
  })

  it('ships the ids as plain literals in the shape the release gate parses', () => {
    // scripts/check-levelplay-config.mjs reads these two declarations from the
    // source, not the bundle. Moving them behind env or a template literal would
    // make that gate refuse every live build.
    const src = readFileSync(new URL('./levelplay.ts', import.meta.url), 'utf8')
    expect(src.match(/^const APP_KEYS: Record<string, string> = \{$/gm)).toHaveLength(1)
    expect(src.match(/^const UNITS_BY_PLATFORM: Record<string, AdUnits> = \{$/gm)).toHaveLength(1)
  })

  it('never carries KVIZKO\'s ids — the provider was ported from there', () => {
    const src = readFileSync(new URL('./levelplay.ts', import.meta.url), 'utf8')
    for (const id of ['27b820f5d', '27ca66f85', 'c9bxcnrdi8okqp6s', '6ssz32u913am0l56', 'l3uutyzolsfdc0pv']) {
      expect(src).not.toContain(id)
    }
  })

  it('passes the configured key and unit ids to the plugin', async () => {
    await provider.init()
    await settle()
    expect(argsOf.initialize).toMatchObject({ appKey: CONFIGURED.appKey })
    expect(argsOf.loadInterstitial).toEqual({ adUnitId: CONFIGURED.units.interstitial })
    expect(argsOf.loadRewarded).toEqual({ adUnitId: CONFIGURED.units.rewarded })
  })
})

describe('consent ordering — a legal requirement, not style', () => {
  /*
   * ironSource: "You must obtain user consent before initializing any
   * third-party SDK … If consent is not obtained, do not initialize the
   * LevelPlay SDK." initialize() transmits device data to configure the
   * waterfall, so init-before-consent leaks before the player is asked. The old
   * Google stack initialised first — the shape a straight port carries over.
   * And since option A (owner, 2026-10-11): consent → ATT → SDK, with nothing
   * asked at launch.
   */
  const order = (names: string[]) => calls.filter((c) => names.includes(c))

  it('a stored yes: the answer is read and applied, then ATT, then the SDK — consent → ATT → SDK', async () => {
    await provider.init()
    expect(calls.indexOf('getConsentData')).toBeLessThan(calls.indexOf('requestConsentInfo'))
    expect(order(['requestConsentInfo', 'requestTrackingAuthorization', 'initialize'])).toEqual([
      'requestConsentInfo',
      'requestTrackingAuthorization',
      'initialize',
    ])
    // Applied, not asked: the alert only appears while there is no answer.
    expect(alertsShown).toBe(0)
  })

  it('no stored answer: init() asks NOTHING at launch — no alert, no ATT, no SDK', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    expect(calls).not.toContain('requestConsentInfo')
    expect(calls).not.toContain('showPrivacyOptions')
    expect(calls).not.toContain('requestTrackingAuthorization')
    expect(calls).not.toContain('initialize')
    expect(alertsShown).toBe(0)
    expect(provider.consentState?.()).toBe('UNKNOWN')
  })

  it('a stored no is applied with no UI, and neither ATT nor the SDK follows', async () => {
    // KVIZKO's first guard read `status === 'UNKNOWN'` and let a Decline through.
    consentStatus = 'DENIED'
    await provider.init()
    await settle()
    expect(calls).toContain('requestConsentInfo')
    expect(alertsShown).toBe(0)
    expect(calls).not.toContain('requestTrackingAuthorization')
    expect(calls).not.toContain('initialize')
    expect(provider.consentState?.()).toBe('DENIED')
  })

  it('subscribes to consent changes BEFORE the question is asked', async () => {
    consentStatus = 'UNKNOWN'
    alertAnswer = 'GRANTED'
    await provider.askConsent?.('afterLevel')
    const listen = calls.indexOf('addListener:onConsentStatusChanged')
    const alert = calls.indexOf('requestConsentInfo')
    expect(listen).toBeGreaterThanOrEqual(0)
    expect(listen).toBeLessThan(alert)
  })

  it('starts the SDK when consent arrives AFTER the question gave up on it — ATT first', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    expect(calls).not.toContain('initialize')
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    await settle()
    expect(order(['requestTrackingAuthorization', 'initialize'])).toEqual(['requestTrackingAuthorization', 'initialize'])
  })

  it('starts the SDK when a stored no is reversed in Settings', async () => {
    consentStatus = 'DENIED'
    await provider.init()
    await settle()
    expect(calls).not.toContain('initialize')
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    await settle()
    expect(calls).toContain('initialize')
  })

  it('never starts on a change that is not a yes', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'DENIED' })
    emit('onConsentStatusChanged', { status: 'UNKNOWN' })
    await settle()
    expect(calls).not.toContain('initialize')
    expect(calls).not.toContain('requestTrackingAuthorization')
  })

  it('starts the SDK once, and asks ATT once, when init() and the watcher both see the yes', async () => {
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    await settle()
    expect(initializes()).toBe(1)
    expect(calls.filter((c) => c === 'requestTrackingAuthorization')).toHaveLength(1)
  })

  it('gives ATT and the consent question separate ceilings — the question is read', async () => {
    const src = readFileSync(new URL('./levelplay.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/withDeadline\(\s*LevelPlayAds\.requestTrackingAuthorization\(\)[\s\S]*?ATT_TIMEOUT_MS/)
    expect(src).toMatch(/LevelPlayAds\.requestConsentInfo\(options\)\)[\s\S]*?CONSENT_TIMEOUT_MS/)
    const att = Number(/const ATT_TIMEOUT_MS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ''))
    const consent = Number(/const CONSENT_TIMEOUT_MS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ''))
    expect(consent).toBeGreaterThanOrEqual(att * 3)
  })
})

describe('the question (option A) — asked by the policy layer, then ATT, then the SDK', () => {
  it('after a level with no answer: the alert, and on a yes ATT and the SDK — in that order', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    alertAnswer = 'GRANTED'
    await expect(provider.askConsent?.('afterLevel')).resolves.toBe('GRANTED')
    expect(alertsShown).toBe(1)
    const steps = calls.filter((c) => ['requestConsentInfo', 'requestTrackingAuthorization', 'initialize'].includes(c))
    expect(steps).toEqual(['requestConsentInfo', 'requestTrackingAuthorization', 'initialize'])
    expect(provider.adsAllowed?.()).toBe(true)
  })

  it('a no: no ATT alert and no SDK — Apple: ATT is not shown to someone who declined', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    alertAnswer = 'DENIED'
    await expect(provider.askConsent?.('afterLevel')).resolves.toBe('DENIED')
    await settle()
    expect(calls).not.toContain('requestTrackingAuthorization')
    expect(calls).not.toContain('initialize')
    expect(provider.adsAllowed?.()).toBe(false)
  })

  it('no answer within the ceiling resolves UNKNOWN and starts nothing — a later tap still counts', async () => {
    consentStatus = 'UNKNOWN'
    alertAnswer = null
    await expect(provider.askConsent?.('afterLevel')).resolves.toBe('UNKNOWN')
    expect(calls).not.toContain('initialize')
    emit('onConsentStatusChanged', { status: 'GRANTED' }) // the player answers late
    await settle()
    expect(calls).toContain('initialize')
  })

  it('a tapped offer puts one sentence of context in front of the same text', async () => {
    consentStatus = 'UNKNOWN'
    alertAnswer = 'GRANTED'
    await provider.askConsent?.('adTap')
    const message = (argsOf.requestConsentInfo as { message: string }).message
    expect(message).toBe(`${CONSENT_COPY.adTapLead} ${CONSENT_COPY.message}`)
  })

  it('Settings always re-opens the alert — showPrivacyOptions — whatever the answer', async () => {
    for (const stored of ['UNKNOWN', 'DENIED', 'GRANTED'] as const) {
      calls.length = 0
      consentStatus = stored
      alertAnswer = 'DENIED'
      await provider.askConsent?.('settings')
      expect(calls, stored).toContain('showPrivacyOptions')
      expect(calls, stored).not.toContain('requestConsentInfo')
    }
    expect(alertsShown).toBe(3)
  })

  it('a refusal tapped again re-opens the alert too (requestConsentInfo would only apply the no)', async () => {
    consentStatus = 'DENIED'
    await provider.init()
    calls.length = 0
    alertAnswer = 'GRANTED'
    await expect(provider.askConsent?.('adTap')).resolves.toBe('GRANTED')
    expect(calls).toContain('showPrivacyOptions')
    expect(calls).toContain('initialize')
  })

  it('a withdrawal in Settings after the SDK is up: do_not_sell, and the policy layer hears the no', async () => {
    const heard: boolean[] = []
    provider.onConsentChange?.((granted) => heard.push(granted))
    await provider.init()
    await settle()
    alertAnswer = 'DENIED'
    await provider.askConsent?.('settings')
    expect(heard.at(-1)).toBe(false)
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true })
    expect(provider.adsAllowed?.()).toBe(false)
  })

  it('one question at a time: two triggers in the same moment share one alert', async () => {
    consentStatus = 'UNKNOWN'
    alertAnswer = 'GRANTED'
    const [a, b] = await Promise.all([provider.askConsent?.('afterLevel'), provider.askConsent?.('adTap')])
    expect(a).toBe('GRANTED')
    expect(b).toBe('GRANTED')
    expect(alertsShown).toBe(1)
  })

  it('hands the plugin the shared copy, the policy URL and the policy button’s name', async () => {
    consentStatus = 'UNKNOWN'
    alertAnswer = 'DENIED'
    await provider.askConsent?.('afterLevel')
    expect(argsOf.requestConsentInfo).toEqual({
      title: CONSENT_COPY.title,
      message: CONSENT_COPY.message,
      acceptButtonText: 'Accept',
      declineButtonText: "Don't accept",
      privacyPolicyUrl: 'https://noqyris.github.io/exactly-67/privacy.html',
      // Read only by the patched plugin (PATCHED-EQUAL-BUTTONS).
      privacyButtonText: 'Privacy policy',
    })
  })

  it('a foreground retry while the ATT alert is still up waits for it — the SDK never starts ahead of ATT', async () => {
    holdAtt = true
    const init = provider.init() // a stored yes: ATT is on screen
    await settle()
    expect(calls).toContain('requestTrackingAuthorization')
    provider.retryInit?.() // the player left and came back with the alert up
    await settle()
    expect(calls).not.toContain('initialize')
    answerAtt?.()
    await init
    await settle()
    expect(initializes()).toBe(1)
    expect(calls.filter((c) => c === 'requestTrackingAuthorization')).toHaveLength(1)
  })

  it('a no that lands while ATT is up starts nothing at all', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'GRANTED' }) // ATT is asked…
    emit('onConsentStatusChanged', { status: 'DENIED' }) // …and the answer changes before it returns
    await settle()
    expect(calls).toContain('requestTrackingAuthorization')
    expect(calls).not.toContain('initialize')
  })
})

describe('the words — option A, neutral, in the game’s language', () => {
  const text = `${CONSENT_COPY.title} ${CONSENT_COPY.message} ${CONSENT_COPY.adTapLead}`

  it('says who shows the ads, who receives what, why, what a no means and where to change it', () => {
    expect(CONSENT_COPY.message).toMatch(/Exactly 67 \(Noqyris\) shows ads through Unity LevelPlay/)
    expect(CONSENT_COPY.message).toMatch(/Unity Technologies \(Unity Ads and ironSource Exchange\)/)
    expect(CONSENT_COPY.message).toMatch(/device and app data/)
    expect(CONSENT_COPY.message).toMatch(/ads you see and tap/)
    expect(CONSENT_COPY.message).toMatch(/advertising identifier/)
    expect(CONSENT_COPY.message).toMatch(/to show you ads and tailor them/)
    expect(CONSENT_COPY.message).toMatch(/no ads are shown, so there are no rewards for watching them/)
    expect(CONSENT_COPY.message).toMatch(/hints still come from playing/)
    expect(CONSENT_COPY.message).toMatch(/Settings → Privacy & ads/)
    expect(CONSENT_COPY.settingsRow).toBe('Privacy & ads')
  })

  it('never pushes either answer: no "plays the same", no "support us", no "Allow"', () => {
    for (const banned of [/plays the same/i, /either way/i, /works (exactly )?the same/i, /support/i, /help (us|the developer)/i, /\ballow\b/i]) {
      expect(text, String(banned)).not.toMatch(banned)
    }
  })

  it('two answers of equal weight: the same verb, yes and no', () => {
    expect(CONSENT_COPY.accept).toBe('Accept')
    expect(CONSENT_COPY.decline).toBe("Don't accept")
    expect(CONSENT_COPY.privacyButton).toBe('Privacy policy')
  })

  it('the ATT purpose string is neutral, says what tracking is for, and is the same in package.json and Info.plist', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      levelplay: { userTrackingDescription: string }
    }
    const att = pkg.levelplay.userTrackingDescription
    const plist = readFileSync(new URL('../../../ios/App/App/Info.plist', import.meta.url), 'utf8')
    expect(plist).toContain(`<key>NSUserTrackingUsageDescription</key>\n    <string>${att}</string>`)
    expect(att).toMatch(/Unity Ads and ironSource Exchange/)
    expect(att).toMatch(/advertising identifier/)
    expect(att).toMatch(/measure/)
    for (const banned of [/plays the same/i, /either way/i, /\ballow\b/i, /support/i, /help/i, /free/i]) {
      expect(att, String(banned)).not.toMatch(banned)
    }
  })
})

describe('the one-time consent reset — Google-era TCF keys are not a LevelPlay decision', () => {
  /*
   * 1.2.0 asked through Google's form, which leaves IABTCF_* keys the plugin's
   * custom provider read as a decision. services/ads calls resetConsent() once
   * per install, before init() and before any question; these pin what it does here.
   */
  it('clears the stored decision through the plugin; init() afterwards asks nothing and starts nothing', async () => {
    await provider.resetConsent?.()
    await provider.init()
    await settle()
    expect(calls).toContain('resetConsent')
    expect(provider.consentState?.()).toBe('UNKNOWN')
    expect(calls).not.toContain('requestConsentInfo')
    expect(calls).not.toContain('initialize')
  })

  it('the UNKNOWN status it emits can never start the SDK, even with the consent watcher attached', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init() // watcher attached, SDK down
    await settle()
    await provider.resetConsent?.()
    await settle()
    expect(calls).toContain('resetConsent')
    expect(calls).not.toContain('initialize')
    expect(provider.adsAllowed?.()).toBe(false)
  })

  it('never wipes the decision a running SDK was started on', async () => {
    await provider.init()
    await provider.resetConsent?.()
    expect(calls).not.toContain('resetConsent')
    expect(provider.adsAllowed?.()).toBe(true)
  })

  it('a plugin that refuses the call does not reject — and the stored answer still applies', async () => {
    resetFails = true
    await expect(provider.resetConsent?.()).resolves.toBeUndefined()
    await provider.init()
    expect(calls).toContain('requestConsentInfo')
    expect(calls).toContain('initialize')
  })
})

describe('consent, as the policy layer sees it', () => {
  it('adsAllowed() is true only while the recorded decision is GRANTED', async () => {
    expect(provider.adsAllowed?.()).toBe(false) // nothing asked yet
    await provider.init()
    await settle()
    expect(provider.adsAllowed?.()).toBe(true)
    emit('onConsentStatusChanged', { status: 'DENIED' }) // withdrawn from Privacy choices
    expect(provider.adsAllowed?.()).toBe(false)
    emit('onConsentStatusChanged', { status: 'GRANTED' }) // and given again
    expect(provider.adsAllowed?.()).toBe(true)
  })

  it('reports every decision — at boot and from Privacy choices — so ads.ts can take the banner down', async () => {
    const heard: boolean[] = []
    provider.onConsentChange?.((granted) => heard.push(granted))
    consentStatus = 'DENIED'
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    emit('onConsentStatusChanged', { status: 'DENIED' })
    await settle()
    expect(heard).toEqual([false, true, false])
  })

  it('a withdrawal after the SDK is up is still heard, alongside do_not_sell', async () => {
    const heard: boolean[] = []
    provider.onConsentChange?.((granted) => heard.push(granted))
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'DENIED' })
    await settle()
    expect(heard.at(-1)).toBe(false)
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true })
  })
})

describe('onReady — the SDK coming up, whenever that is', () => {
  it('fires when init() starts the SDK', async () => {
    const heard = vi.fn()
    provider.onReady?.(heard)
    await provider.init()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('fires for a late consent, and never while consent is missing', async () => {
    consentStatus = 'UNKNOWN'
    const heard = vi.fn()
    provider.onReady?.(heard)
    await provider.init()
    await settle()
    expect(heard).not.toHaveBeenCalled()
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    await settle()
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('no test inventory — the badge that would lie is gone', () => {
  /*
   * LevelPlay's isTesting flag only unlocks the Test Suite (plugin
   * LevelPlayAdsImpl.swift: is_test_suite metadata); show() serves the real
   * waterfall in every build. `testing: true` would say "safe to tap" about a
   * live-ads build, which is how the previous ad account was lost.
   */
  it('reports testing:false regardless of build mode', () => {
    expect(provider.testing).toBe(false)
  })

  it('still carries the ad-mode marker, which is a separate concern', () => {
    expect(provider.id).toMatch(/ADMODE:(test|live)/)
  })
})

describe('rewarded — the race that decides reward vs skip', () => {
  it('resolves with the reward when the reward event fires', async () => {
    const pending = provider.showRewarded()
    await settle()
    emit('onRewardedAdRewarded', { rewardName: 'hint', rewardAmount: 1 })
    await expect(pending).resolves.toMatchObject({ rewardAmount: 1 })
  })

  it('stays PENDING when the player just closes the video', async () => {
    // The whole point. The policy layer races this promise against the
    // dismissal watcher and treats "watcher won" as "skipped". If close also
    // resolved here, a skipped video would hand out the hint.
    const pending = provider.showRewarded()
    await settle()
    emit('onRewardedAdClosed')
    const outcome = await Promise.race([pending, settle().then(() => 'still-pending')])
    expect(outcome).toBe('still-pending')
  })

  it('resolves null when the ad fails to present, so the race cannot hang', async () => {
    const pending = provider.showRewarded()
    await settle()
    emit('onRewardedAdDisplayFailed', { errorCode: 509 })
    await expect(pending).resolves.toBeNull()
  })

  it('subscribes BEFORE asking for the ad', async () => {
    void provider.showRewarded()
    await settle()
    const firstShow = calls.indexOf('showRewarded')
    const firstListen = calls.findIndex((c) => c.startsWith('addListener:'))
    expect(firstListen).toBeGreaterThanOrEqual(0)
    expect(firstListen).toBeLessThan(firstShow)
  })

  it('detaches its listeners once settled, so ads do not leak one each', async () => {
    const pending = provider.showRewarded()
    await settle()
    emit('onRewardedAdRewarded', {})
    await pending
    await settle()
    expect(listenerCount()).toBe(0)
  })

  it('resolves null when the ad never APPEARS within the display deadline — the game is not left asleep', async () => {
    // Native showRewarded() resolves once it hands the ad over, so a present the
    // SDK swallows without an event would otherwise wait out the 3-minute ceiling.
    vi.useFakeTimers()
    try {
      let outcome: unknown = 'pending'
      void provider.showRewarded().then((v) => (outcome = v))
      await vi.advanceTimersByTimeAsync(9_900)
      expect(outcome).toBe('pending')
      await vi.advanceTimersByTimeAsync(200)
      expect(outcome).toBeNull()
      expect(listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('once displayed, waits for the player however long the video runs', async () => {
    vi.useFakeTimers()
    try {
      let outcome: unknown = 'pending'
      void provider.showRewarded().then((v) => (outcome = v))
      await vi.advanceTimersByTimeAsync(10)
      emit('onRewardedAdDisplayed')
      await vi.advanceTimersByTimeAsync(60_000) // a long video
      expect(outcome).toBe('pending')
      emit('onRewardedAdRewarded', { rewardAmount: 1 })
      await vi.advanceTimersByTimeAsync(0)
      expect(outcome).toMatchObject({ rewardAmount: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('prefetch — the ad is loaded before the tap, not at it', () => {
  it('loads both formats the moment initialize() resolves', async () => {
    await provider.init()
    await settle()
    expect(calls).toContain('loadInterstitial')
    expect(calls).toContain('loadRewarded')
  })

  it('does not load anything while the SDK is down', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    expect(calls).not.toContain('loadInterstitial')
    expect(calls).not.toContain('loadRewarded')
  })

  it('answers a tap from the cache without a second load', async () => {
    await provider.init()
    await settle()
    emit('onRewardedAdLoaded')
    await settle()
    expect(provider.rewardedReady?.()).toBe(true)
    calls.length = 0
    ready.rewarded = true
    await expect(provider.loadRewarded()).resolves.toBe(true)
    expect(calls).not.toContain('loadRewarded')
  })

  it('lets a tap JOIN an in-flight prefetch instead of superseding it', async () => {
    await provider.init()
    await settle()
    const tap = provider.loadRewarded()
    await settle()
    expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1)
    emit('onRewardedAdLoaded')
    await expect(tap).resolves.toBe(true)
  })

  it('fetches the next ad after the shown one closes', async () => {
    vi.useFakeTimers()
    try {
      await provider.init()
      await vi.advanceTimersByTimeAsync(10)
      emit('onRewardedAdLoaded')
      await vi.advanceTimersByTimeAsync(10)
      expect(provider.rewardedReady?.()).toBe(true)
      calls.length = 0
      emit('onRewardedAdClosed')
      expect(provider.rewardedReady?.()).toBe(false)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(calls).toContain('loadRewarded')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a tap-time rewarded load that misses re-arms the backoff, so the slot refills without another tap', async () => {
    vi.useFakeTimers()
    try {
      const loads = () => calls.filter((c) => c === 'loadRewarded').length
      await provider.init()
      await vi.advanceTimersByTimeAsync(10)
      emit('onRewardedAdLoaded') // prefetched…
      await vi.advanceTimersByTimeAsync(10)
      ready.rewarded = false // …and expired before the tap
      const tap = provider.loadRewarded()
      await vi.advanceTimersByTimeAsync(10)
      expect(loads()).toBe(2)
      emit('onRewardedAdLoadFailed', { errorCode: 509 })
      await expect(tap).resolves.toBe(false)
      await vi.advanceTimersByTimeAsync(29_000)
      expect(loads()).toBe(2)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(loads()).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a consent withdrawn after the SDK is up stops the refill timers — no more ad requests', async () => {
    vi.useFakeTimers()
    try {
      await provider.init()
      await vi.advanceTimersByTimeAsync(10)
      emit('onRewardedAdLoadFailed', { errorCode: 509 }) // a miss arms the 30 s backoff
      await vi.advanceTimersByTimeAsync(10)
      emit('onConsentStatusChanged', { status: 'DENIED' })
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a load in flight at withdrawal that then fails is not retried', async () => {
    // The timer-clear on a no cannot catch this one: the backoff is armed AFTER
    // the no, by the failure event. Only the consent guard in prefetch() stops it.
    vi.useFakeTimers()
    try {
      await provider.init()
      await vi.advanceTimersByTimeAsync(10) // both boot loads in flight
      emit('onConsentStatusChanged', { status: 'DENIED' })
      emit('onRewardedAdLoadFailed', { errorCode: 509 })
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1)
      expect(calls.filter((c) => c === 'loadInterstitial')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a no that lands while initialize() is running: the SDK comes up loading nothing, told not to sell', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    await settle()
    holdInit = true
    emit('onConsentStatusChanged', { status: 'GRANTED' }) // ATT, then startSdk() begins
    await settle()
    expect(calls).toContain('initialize')
    emit('onConsentStatusChanged', { status: 'DENIED' }) // the SDK is not up yet
    releaseInit?.()
    await settle()
    expect(calls).not.toContain('loadInterstitial')
    expect(calls).not.toContain('loadRewarded')
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true })
  })

  it('a yes given again restores do_not_sell=false and refills the cache', async () => {
    await provider.init()
    await settle()
    const before = calls.filter((c) => c === 'loadRewarded').length
    emit('onConsentStatusChanged', { status: 'DENIED' })
    await settle()
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true })
    emit('onRewardedAdLoadFailed', { errorCode: 509 }) // settle the first load
    await settle()
    emit('onConsentStatusChanged', { status: 'GRANTED' })
    await settle()
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: false })
    expect(calls.filter((c) => c === 'loadRewarded').length).toBeGreaterThan(before)
  })

  it('never prefetches an interstitial the policy layer says it will not show (a No-Ads owner)', async () => {
    provider.setInterstitialWanted?.(() => false)
    await provider.init()
    await settle()
    expect(calls).not.toContain('loadInterstitial')
    expect(calls).toContain('loadRewarded')
  })

  it('retries a missed prefetch with backoff, never in a tight loop', async () => {
    vi.useFakeTimers()
    try {
      await provider.init()
      await vi.advanceTimersByTimeAsync(10)
      emit('onRewardedAdLoadFailed', { errorCode: 509 })
      await vi.advanceTimersByTimeAsync(10)
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(29_000)
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('interstitial', () => {
  /*
   * The interstitial is decided on the win card's Next/Map tap, with every
   * button already locked. It answers from the prefetch cache ONLY: a tap-time
   * load held that card on a dead screen for up to 15 s, on every eligible clear
   * once the chain broke. A miss is "no ad this time" — the cadence stays armed.
   */
  const loads = () => calls.filter((c) => c === 'loadInterstitial').length

  it('answers TRUE from the cache while the SDK holds one, without loading', async () => {
    ready.interstitial = true
    await expect(provider.loadInterstitial()).resolves.toBe(true)
    expect(loads()).toBe(0)
  })

  it('a miss answers FALSE at once — never a load held on the tap — and fetches one for the next break', async () => {
    await provider.init()
    await settle()
    emit('onInterstitialAdLoaded') // prefetched…
    await settle()
    ready.interstitial = false // …and expired
    // Nothing will ever emit a load event below: a tap that waited on one would hang.
    await expect(provider.loadInterstitial()).resolves.toBe(false)
    await settle()
    expect(loads()).toBe(2)
    expect(argsOf.loadInterstitial).toEqual({ adUnitId: CONFIGURED.units.interstitial })
  })

  it('does not join a load already in flight — it answers FALSE and lets that load carry on', async () => {
    await provider.init()
    await settle() // the boot prefetch is loading, no event yet
    await expect(provider.loadInterstitial()).resolves.toBe(false)
    expect(loads()).toBe(1)
    emit('onInterstitialAdLoaded')
    await settle()
    ready.interstitial = true
    await expect(provider.loadInterstitial()).resolves.toBe(true)
  })

  it('a miss while a backoff retry is waiting does not load early — that retry is the same fetch', async () => {
    vi.useFakeTimers()
    try {
      await provider.init()
      await vi.advanceTimersByTimeAsync(10)
      emit('onInterstitialAdLoadFailed', { errorCode: 606 })
      await vi.advanceTimersByTimeAsync(10)
      expect(loads()).toBe(1)
      await expect(provider.loadInterstitial()).resolves.toBe(false)
      await vi.advanceTimersByTimeAsync(10)
      expect(loads()).toBe(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(loads()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never rejects: a plugin that refuses isReady reads as a miss', async () => {
    ready.interstitial = true
    const spy = vi.spyOn(
      (await import('capacitor-levelplay-ads')).LevelPlayAds,
      'isInterstitialReady',
    ).mockRejectedValueOnce(new Error('bridge gone'))
    await expect(provider.loadInterstitial()).resolves.toBe(false)
    spy.mockRestore()
  })

  it('show settles at PRESENT time, which is what resolvesOnPresent promises', async () => {
    expect(provider.resolvesOnPresent('interstitial')).toBe(true)
    const pending = provider.showInterstitial()
    await settle()
    emit('onInterstitialAdDisplayed')
    await expect(pending).resolves.toBe(true)
  })

  it('show resolves false on a failed present — never waits for a close that cannot come', async () => {
    const pending = provider.showInterstitial()
    await settle()
    emit('onInterstitialAdDisplayFailed', { errorCode: 509 })
    await expect(pending).resolves.toBe(false)
  })

  it('rewarded does NOT settle at present time', () => {
    expect(provider.resolvesOnPresent('rewarded')).toBe(false)
  })
})

describe('dismissal watcher', () => {
  it('fires on close', async () => {
    const w = provider.watchDismissal('interstitial', 5000)
    await settle()
    emit('onInterstitialAdClosed')
    await expect(w.done).resolves.toBeUndefined()
  })

  it('also fires on a failed present, which never emits a close', async () => {
    const w = provider.watchDismissal('rewarded', 5000)
    await settle()
    emit('onRewardedAdDisplayFailed')
    await expect(w.done).resolves.toBeUndefined()
  })

  it('cancel() releases the wait and its listeners', async () => {
    const w = provider.watchDismissal('rewarded', 5000)
    await settle()
    w.cancel()
    await expect(w.done).resolves.toBeUndefined()
    expect(listenerCount()).toBe(0)
  })
})

describe('banner', () => {
  it('asks for the fixed 320x50 banner at the bottom — the size the layout reserves', async () => {
    await provider.bannerShow()
    expect(argsOf.createBanner).toEqual({
      adUnitId: CONFIGURED.units.banner,
      adSize: 'BANNER',
      position: 'BOTTOM',
      isAutoShow: true,
    })
  })

  it('creates once, then only shows — a second create would stack two banners', async () => {
    await provider.bannerShow()
    await provider.bannerShow()
    expect(calls.filter((c) => c === 'createBanner')).toHaveLength(1)
    expect(calls.filter((c) => c === 'showBanner')).toHaveLength(1)
  })

  it('creates again after a destroy', async () => {
    await provider.bannerShow()
    await provider.bannerRemove()
    await provider.bannerShow()
    expect(calls.filter((c) => c === 'createBanner')).toHaveLength(2)
  })
})

describe('test-device support', () => {
  it('exposes the advertising id the dashboard needs to register a device', async () => {
    await expect(lp.advertisingId()).resolves.toBe('ADID-1')
  })
})

describe('regulation flags go in BEFORE initialize()', () => {
  it('sets CCPA and COPPA ahead of the SDK start', async () => {
    await provider.init()
    const order = calls.filter((c) => ['setCCPAConsent', 'setChildDirected', 'initialize'].includes(c))
    expect(order.indexOf('initialize')).toBeGreaterThan(order.indexOf('setCCPAConsent'))
    expect(order.indexOf('initialize')).toBeGreaterThan(order.indexOf('setChildDirected'))
  })

  it('declares the app not child-directed — a property of the app, not the player', async () => {
    await provider.init()
    expect(argsOf.setChildDirected).toEqual({ isChildDirected: false })
  })

  it('does not sell only when the player has said yes, which is the only time it starts', async () => {
    await provider.init()
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: false })
  })

  it('flips do_not_sell the moment consent is withdrawn after the SDK is up', async () => {
    await provider.init()
    await settle()
    emit('onConsentStatusChanged', { status: 'DENIED' })
    await settle()
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true })
  })
})

describe('init retry — a tunnel at boot is not a session without ads', () => {
  // Every failed retry is logged on purpose; the suite output need not carry it.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries a failed initialize at 30 s, 60 s and 120 s, then stops', async () => {
    vi.useFakeTimers()
    try {
      initFails = true
      await expect(provider.init()).rejects.toThrow()
      expect(initializes()).toBe(1)
      await vi.advanceTimersByTimeAsync(29_900)
      expect(initializes()).toBe(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(initializes()).toBe(2)
      await vi.advanceTimersByTimeAsync(59_800)
      expect(initializes()).toBe(2)
      await vi.advanceTimersByTimeAsync(200)
      expect(initializes()).toBe(3)
      await vi.advanceTimersByTimeAsync(119_800)
      expect(initializes()).toBe(3)
      await vi.advanceTimersByTimeAsync(200)
      expect(initializes()).toBe(4)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(initializes()).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a retry that succeeds brings the SDK up, sets the flags again and starts the prefetch', async () => {
    vi.useFakeTimers()
    try {
      initFails = true
      await expect(provider.init()).rejects.toThrow()
      calls.length = 0
      initFails = false
      await vi.advanceTimersByTimeAsync(30_100)
      expect(initializes()).toBe(1)
      expect(calls.indexOf('setCCPAConsent')).toBeLessThan(calls.indexOf('initialize'))
      expect(calls).toContain('loadInterstitial')
      expect(calls).toContain('loadRewarded')
      calls.length = 0
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(initializes()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops retrying the moment consent is withdrawn', async () => {
    vi.useFakeTimers()
    try {
      initFails = true
      await expect(provider.init()).rejects.toThrow()
      emit('onConsentStatusChanged', { status: 'DENIED' })
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(initializes()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a return to the foreground retries at once, and never runs two inits', async () => {
    vi.useFakeTimers()
    try {
      initFails = true
      await expect(provider.init()).rejects.toThrow()
      initFails = false
      provider.retryInit?.()
      provider.retryInit?.() // the second lands on the in-flight start
      await vi.advanceTimersByTimeAsync(10)
      expect(initializes()).toBe(2)
      provider.retryInit?.()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(initializes()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a foreground return without consent starts nothing', async () => {
    consentStatus = 'UNKNOWN'
    await provider.init()
    provider.retryInit?.()
    await settle()
    expect(calls).not.toContain('initialize')
  })

  it('a fresh GRANTED after the budget is spent tries again', async () => {
    vi.useFakeTimers()
    try {
      initFails = true
      await expect(provider.init()).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(initializes()).toBe(4)
      initFails = false
      emit('onConsentStatusChanged', { status: 'GRANTED' })
      await vi.advanceTimersByTimeAsync(10)
      expect(initializes()).toBe(5)
      expect(calls).toContain('loadRewarded')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('build markers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Both markers are module constants folded at load, so the top-level
  // `provider` carries whatever the PROCESS env said — and the release chains
  // run vitest with it set (`build:live` exports VITE_AD_MODE=live, `build:tf`
  // VITE_ADS=off, both BEFORE `vite build`). The default has to be pinned, never
  // assumed, or stage 2 of those chains fails here. Last in the file on purpose:
  // resetModules() hands back a fresh provider instance.
  async function freshId(env: Record<string, string>): Promise<string> {
    vi.stubEnv('VITE_AD_MODE', '')
    vi.stubEnv('VITE_ADS', '')
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.resetModules()
    const fresh = await import('./levelplay')
    return fresh.levelplayProvider.id
  }

  it('carries ADMODE:test and ADS:on by default', async () => {
    const id = await freshId({})
    expect(id).toContain('ADMODE:test')
    expect(id).toContain('ADS:on')
    expect(id).not.toContain('ADS:off')
  })

  it('bakes ADS:off under VITE_ADS=off, and stays an ADMODE:test build', async () => {
    const id = await freshId({ VITE_ADS: 'off' })
    expect(id).toContain('ADS:off')
    expect(id).not.toContain('ADS:on')
    expect(id).toContain('ADMODE:test')
  })

  it('bakes ADMODE:live only under VITE_AD_MODE=live exactly', async () => {
    expect(await freshId({ VITE_AD_MODE: 'live' })).toContain('ADMODE:live')
    for (const almost of ['Live', 'LIVE', 'true', '1', 'prod']) {
      expect(await freshId({ VITE_AD_MODE: almost }), almost).toContain('ADMODE:test')
    }
  })
})
