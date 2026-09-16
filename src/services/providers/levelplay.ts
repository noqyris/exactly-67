import { Capacitor } from '@capacitor/core'
import { LevelPlayAds, AdEvent } from 'capacitor-levelplay-ads'
import { ADS_MARKER, type AdFormat, type AdProvider, type DismissWatcher } from '../adProvider'

/**
 * Unity LevelPlay behind the AdProvider seam.
 *
 * Written after Google closed the publisher account on 2026-08-18. Ported from
 * KVIZKO, the sibling app that has run this exact plugin version (0.1.42) in
 * production on the App Store since 1.2.1 — every event race below was found
 * there first. Everything network-specific lives here; the policy layer
 * (`services/ads`) knows none of it.
 *
 * Three things differ from the old Google stack in ways that matter, and each is
 * a comment further down rather than a surprise later:
 *
 *  1. There are no test ad units and no test inventory. The SAME unit ids ship
 *     in every build, `isTesting` only unlocks Unity's Test Suite screen, and
 *     every ADS:on build serves the REAL waterfall. See AD_MODE_MARKER and
 *     `testing` on the provider.
 *  2. Nothing settles on the promise. `show*()` and `load*()` return void and
 *     the real answer arrives as an event, so every call here is an event race.
 *  3. There is no app-open format — and Unity's Placement Policy calls a
 *     placement "launched before an Application has opened" a violation anyway.
 *     This app never had one; it must not grow one.
 */

// ── Go-live config ───────────────────────────────────────────────────────────
// VITE_AD_MODE=live declares an App Store build; anything else is ADMODE:test.
// The direction is deliberate: the flag fails toward "not declared live", so a
// typo, a stray `vite build` or an Xcode archive can never pass the `live` gate.
//
// What it does NOT do is make a build safe. On LevelPlay the only effect of
// TESTING is `isTesting: true` at initialize(), which unlocks the Test Suite
// (plugin LevelPlayAdsImpl.swift: `setMetaDataWithKey("is_test_suite", …)`).
// Ordinary show() calls serve real ads either way. Whether a build serves ads AT
// ALL is `VITE_ADS=off` (adProvider.ts, "Build modes").
const TESTING = import.meta.env.VITE_AD_MODE !== 'live'

/**
 * The proof the release gate reads (`scripts/check-ad-mode.mjs`).
 *
 * With Google's network the gate could grep for its sample publisher id and
 * know a build carried test units. LevelPlay has no such tell — the same unit
 * ids ship in both modes and only a folded boolean differs, which is not
 * greppable. Without this literal the gate cannot tell a TestFlight bundle from
 * an App Store one, which is the blindness that cost the old account.
 *
 * It rides on `id` because the provider object is imported and used, so no
 * bundler will tree-shake the string away.
 */
const AD_MODE_MARKER = TESTING ? 'ADMODE:test' : 'ADMODE:live'

/**
 * LevelPlay app keys, from the dashboard (platform.ironsrc.com → Apps → Exactly
 * 67 → App Key). NOT the Unity Ads Game ID, which is numeric and belongs to the
 * network enabled inside LevelPlay, not to the SDK.
 *
 * iOS was created 2026-09-16 ("Exactly 67: Number Puzzle", Puzzle: Board, COPPA
 * not directed), with Unity Ads enabled as a bidder on all three units (Unity
 * Ads Game ID 800374923, placements BP_{Banner,Interstitial,Rewarded}_iOS).
 * Android has no LevelPlay app yet and stays EMPTY. An empty key is safe:
 * init() refuses it before any consent prompt or SDK call, so the app simply
 * has no ads — and `scripts/check-levelplay-config.mjs <platform>` (chained into
 * build:live) refuses to produce a store bundle without a real 9-hex-character
 * key and three 16-character unit ids. Keep both declarations as plain string
 * literals: that script parses this file, not the bundle.
 *
 * iOS and Android are SEPARATE apps in LevelPlay with separate keys and unit
 * ids — a store URL registers exactly one platform. Sharing one key would ship
 * Android pointing at the iOS app: no crash, just an SDK that never fills.
 */
const APP_KEYS: Record<string, string> = {
  ios: '282af3d55',
  android: '',
}

interface AdUnits {
  banner: string
  interstitial: string
  rewarded: string
}

/**
 * Ad unit ids from the LevelPlay dashboard (Apps → Exactly 67 → Ad Units), one
 * banner, one interstitial and one rewarded unit per platform. Android is empty
 * until its app exists — see APP_KEYS for why that is safe and what refuses to
 * ship it. The rewarded unit's "Hint × 1" in the dashboard is reporting metadata
 * only; the game grants the hint itself (services/ads.ts).
 *
 * Unlike the old network there is no test/live pair — these are the real ids in
 * every build, and NOTHING here makes a build safe to tap:
 *   • `isTesting` maps only to the Test Suite flag;
 *   • a dashboard Test Device pin gives "ads exclusively from that specific ad
 *     network" (exclusivity of SOURCE, not test creatives), "will reset within
 *     the hour", and "non-bidding ad networks can only test live ads".
 * Treat every build on every device as live, and never tap an ad.
 */
const UNITS_BY_PLATFORM: Record<string, AdUnits> = {
  ios: {
    banner: 'bkov9ky03m5q7nb5',
    interstitial: '037b2c2vtwjlz5bg',
    rewarded: 'v9y4469brsj85byl',
  },
  // A separate app in LevelPlay, so separate ids — reusing the iOS ones would
  // silently yield no fill.
  android: {
    banner: '',
    interstitial: '',
    rewarded: '',
  },
}

const PLATFORM = Capacitor.getPlatform()
let appKey = APP_KEYS[PLATFORM] ?? ''
let units: AdUnits = UNITS_BY_PLATFORM[PLATFORM] ?? { banner: '', interstitial: '', rewarded: '' }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The words on the plugin's native consent modal.
 *
 * Passing nothing is not "use sensible defaults": the plugin's custom provider
 * falls back to a generic "We value your privacy" and silently drops the
 * privacy-policy button (the native code only adds it when a URL is supplied),
 * leaving the one screen that asks about ad data with no link to the policy
 * that describes it.
 *
 * The message says plainly what Accept means — partners use the advertising
 * identifier to personalise ads — and what Decline costs, which is exactly what
 * the code does: the SDK only ever starts on GRANTED, so a decline means no ads
 * of any kind, including the optional hint videos. Nothing here appeals to
 * supporting the developer; Unity's rewarded policy names "support us" framing
 * as a violation, and consent must not be bought with guilt either.
 */
export const CONSENT_COPY = {
  title: 'Ads and your data',
  message:
    'Exactly 67 shows ads through Unity LevelPlay. With your consent, our ad partners use your ' +
    "device's advertising identifier and information about the ads you see to personalise those ads. " +
    'If you decline, the ad system does not start: every level still plays, but there are no ads and ' +
    'no hint videos. You can change this any time under Privacy choices on the main menu.',
  accept: 'Accept',
  decline: 'Decline',
} as const

/** Where the modal's privacy-policy button goes. */
const PRIVACY_POLICY_URL = 'https://noqyris.github.io/exactly-67/privacy.html'

function consentOptions() {
  return {
    title: CONSENT_COPY.title,
    message: CONSENT_COPY.message,
    acceptButtonText: CONSENT_COPY.accept,
    declineButtonText: CONSENT_COPY.decline,
    privacyPolicyUrl: PRIVACY_POLICY_URL,
  }
}

/**
 * ATT is a system alert the OS answers in a moment; a stall there is a hang.
 * The consent modal is different: it is READ. KVIZKO first gave both one 20 s
 * ceiling, so a player who took 25 s over the text was treated as a stalled
 * CMP — init() gave up on UNKNOWN and the Accept tapped a moment later reached
 * nobody. The modal gets its own generous ceiling, and its decision is WATCHED
 * (watchConsent), so even a decision after the ceiling starts the SDK.
 */
const ATT_TIMEOUT_MS = 20_000
const CONSENT_TIMEOUT_MS = 120_000

/**
 * Await with a ceiling. On expiry it logs which call stalled and returns the
 * fallback, so the session degrades to "no ads" loudly instead of silently.
 */
function withDeadline<T>(p: Promise<T>, ms: number, what: string, fallback?: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(`[levelplay] ${what} did not settle in ${ms}ms — continuing without it`)
      resolve(fallback as T)
    }, ms)
    void p.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback as T)
      },
    )
  })
}

/** How long to wait for a load/display event before calling it a failure. */
const LOAD_EVENT_TIMEOUT_MS = 20_000
const SHOW_EVENT_TIMEOUT_MS = 10_000

/** Every terminal event per format: dismissed, or failed to present at all. */
const AD_EVENTS: Record<AdFormat, readonly string[]> = {
  interstitial: [AdEvent.InterstitialClosed, AdEvent.InterstitialDisplayFailed],
  rewarded: [AdEvent.RewardedClosed, AdEvent.RewardedDisplayFailed],
  // A banner has no "done with it"; nothing ever waits on one.
  banner: [],
}

/** Formats this network serves and this app uses. */
const SUPPORTED: ReadonlySet<AdFormat> = new Set<AdFormat>(['banner', 'interstitial', 'rewarded'])

let bannerCreated = false

// ── Privacy flags ────────────────────────────────────────────────────────────
/*
 * CCPA and COPPA, set BEFORE every initialize(). Unity's regulation page: "the
 * recommended best practice is to set the API before initializing the SDK to
 * ensure compliance with privacy frameworks". The plugin exposes both as
 * first-class calls outside its ensureReady() guard, so they can go first. They
 * are static SDK settings and transmit nothing.
 *
 * COPPA: false. Exactly 67 is a general-audience number puzzle, not directed at
 * children, and is registered that way in the LevelPlay dashboard. A property of
 * the app, not of the player — hence a constant.
 *
 * CCPA mirrors the consent decision, because the SDK only ever starts on
 * GRANTED. The modal says in as many words that partners use the advertising
 * identifier to personalise ads — the "sale or sharing" CCPA lets a Californian
 * refuse — so a player who tapped Accept has agreed and do_not_sell is false at
 * init. A player who later withdraws from Privacy choices flips it to true: the
 * SDK cannot be stopped once up, but it can be told to stop selling.
 */
const CHILD_DIRECTED = false

async function applyPrivacyFlags(granted: boolean): Promise<void> {
  await Promise.all([
    LevelPlayAds.setCCPAConsent({ doNotSell: !granted }).catch(() => {
      // a plugin without the call — init must not hang on a privacy flag
    }),
    LevelPlayAds.setChildDirected({ isChildDirected: CHILD_DIRECTED }).catch(() => {
      // same
    }),
  ])
}

// ── Start + retry ────────────────────────────────────────────────────────────
/**
 * The SDK starts at most once per process, and every path that can start it
 * shares this promise — init() reaching GRANTED, the consent watcher seeing
 * GRANTED, a retry timer and a return to the foreground can all arrive for the
 * same decision, and initialize() is not re-entrant (the plugin rejects a second
 * call with "already initializing"). A failed start is forgotten so the next
 * attempt can try again.
 */
let sdkStart: Promise<void> | null = null
let sdkUp = false

/** What consent currently says. Every retry reads it: no consent, no init. */
let consentGranted = false

/*
 * A failed initialize() must not be final for the session — a player who opens
 * the game in a tunnel would otherwise have no ads, and no hint videos, until
 * the next launch. Unity, on onInitFailed: "It is recommended to try and
 * initialize the LevelPlay SDK later (when internet connection is available, or
 * when the failure reason is resolved)."
 *
 * So: three timed retries with backoff, then one more on every return to the
 * foreground (ads.adsForegrounded(), from main.ts's visibility hook). Bounded,
 * so it cannot tight-loop against a dead network. Every attempt still requires
 * consent to be GRANTED; a fresh GRANTED resets the budget.
 */
const INIT_RETRY_DELAYS_MS: readonly number[] = [30_000, 60_000, 120_000]
let initFailures = 0
let initRetryTimer: ReturnType<typeof setTimeout> | null = null

function startSdk(): Promise<void> {
  sdkStart ??= applyPrivacyFlags(true)
    .then(() => LevelPlayAds.initialize({ appKey, isTesting: TESTING }))
    .then(() => {
      initFailures = 0
      onSdkUp()
    })
    .catch((e: unknown) => {
      sdkStart = null
      scheduleInitRetry()
      throw e
    })
  return sdkStart
}

/** One pending timer at most; silence once the timed budget is spent. */
function scheduleInitRetry(): void {
  if (initRetryTimer) return
  const spentBudget = initFailures >= INIT_RETRY_DELAYS_MS.length
  const delay = INIT_RETRY_DELAYS_MS[Math.min(initFailures, INIT_RETRY_DELAYS_MS.length - 1)]
  initFailures += 1
  if (spentBudget) return
  initRetryTimer = setTimeout(() => {
    initRetryTimer = null
    attemptInit()
  }, delay)
}

function cancelInitRetry(): void {
  if (initRetryTimer) clearTimeout(initRetryTimer)
  initRetryTimer = null
}

/** Try again now — if the SDK is down, nothing is in flight, and consent still says yes. */
function attemptInit(): void {
  if (sdkUp || sdkStart || !consentGranted) return
  cancelInitRetry()
  void startSdk().catch((e: unknown) => {
    console.warn('[levelplay] initialize retry failed', e)
  })
}

/** Who wants to hear every consent decision — see AdProvider.onConsentChange. */
const consentListeners = new Set<(granted: boolean) => void>()

/**
 * Record a consent decision. A yes resets the retry budget — a new decision is
 * a new reason to try. A no cancels any pending retry (no consent, no init)
 * and, if the SDK is already up, tells it to stop selling.
 *
 * Either way the policy layer hears about it. A running SDK cannot be shut
 * down, so a withdrawal from Privacy choices is honoured one level up: the
 * banner comes down, and no interstitial or hint video is offered again this
 * session — which is what the modal the player just answered says a decline
 * means ("there are no ads and no hint videos").
 */
function noteConsent(granted: boolean): void {
  const wasGranted = consentGranted
  consentGranted = granted
  if (granted) {
    initFailures = 0
    // A yes given again from Privacy choices after a withdrawal, with the SDK
    // still up from earlier: startSdk() will not run a second time, so this is
    // the only place do_not_sell goes back to false and the empty cache refills.
    if (sdkUp && !wasGranted) {
      void applyPrivacyFlags(true)
      prefetch('interstitial')
      prefetch('rewarded')
    }
  } else {
    cancelInitRetry()
    if (sdkUp) void applyPrivacyFlags(false)
    // A no ends ad requests too, not only ad surfaces: the backoff and refill
    // timers would otherwise keep loading inventory nobody may be shown.
    for (const format of ['interstitial', 'rewarded'] as const) {
      const slot = slots[format]
      if (slot.timer) clearTimeout(slot.timer)
      slot.timer = null
    }
  }
  for (const listener of consentListeners) {
    try {
      listener(granted)
    } catch {
      // a listener's bug must not cost the SDK start that follows a yes
    }
  }
}

/**
 * Start the SDK whenever consent becomes GRANTED — whenever that is.
 *
 * The plugin fires onConsentStatusChanged from requestConsentInfo() AND from
 * showPrivacyOptions(), so one listener covers both late arrivals: the player
 * who read the modal past init()'s ceiling, and the player who declined at boot
 * and later said yes from the menu's Privacy choices.
 *
 * Attached BEFORE the modal is requested — a decision made while nothing is
 * listening is a decision lost. Idempotent.
 */
let consentWatched = false

function watchConsent(): void {
  if (consentWatched) return
  consentWatched = true
  void LevelPlayAds.addListener(AdEvent.ConsentStatusChanged, (data: { status?: string } | null) => {
    noteConsent(data?.status === 'GRANTED')
    if (!consentGranted) return
    void startSdk().catch((e: unknown) => {
      console.warn('[levelplay] initialize after a late consent failed', e)
    })
  }).catch(() => {
    // no native bridge (browser dev) — nothing to watch
    consentWatched = false
  })
}

// ── Prefetch ─────────────────────────────────────────────────────────────────
/*
 * Full-screen ads are loaded AHEAD of the tap, not at it.
 *
 * The interstitial is shown on the way OUT of the win card (Next / Map), and
 * the rewarded video behind "Watch ad: +1 hint" in the hint modal. Loading at
 * tap time would hold either button on a dead screen for the whole load — up to
 * 15 s on a thin waterfall. So each format keeps one ad ready: loaded as soon as
 * the SDK is up, loaded again after every close, retried with backoff after a
 * miss. The plugin's isReady() is the truth at tap time; the local `ready` flag
 * is the draw-time hint rewardedReady() gives.
 *
 * The two formats answer a cache miss differently, because the player asked for
 * one and not the other:
 *   - interstitial  from the cache ONLY. Nobody asked for it, and every button
 *                   on the win card is already locked while it is decided, so a
 *                   miss is "no ad this time" at once — the cadence stays armed
 *                   and the next clear gets the ad this miss went to fetch.
 *   - rewarded      a tap-time load is allowed: the player chose to watch, and
 *                   the hint modal shows "Loading…" on the button meanwhile.
 */
const PREFETCH_RETRY_MIN_MS = 30_000
const PREFETCH_RETRY_MAX_MS = 5 * 60_000
/** A breath after close: the SDK is still tearing the ad's view down. */
const PREFETCH_AFTER_CLOSE_MS = 1_500

type Cacheable = 'interstitial' | 'rewarded'

interface Slot {
  ready: boolean
  loading: Promise<boolean> | null
  retryMs: number
  timer: ReturnType<typeof setTimeout> | null
}

const emptySlot = (): Slot => ({ ready: false, loading: null, retryMs: PREFETCH_RETRY_MIN_MS, timer: null })
const slots: Record<Cacheable, Slot> = { interstitial: emptySlot(), rewarded: emptySlot() }

/** Whether the policy layer can ever show this player an interstitial. */
let interstitialWanted: () => boolean = () => true

/*
 * load() returns void the moment the request is queued, so "did it fill" is only
 * knowable from the event pair. Listeners are attached BEFORE the call: a cached
 * ad can report Loaded at once, and a listener attached after that would wait
 * out the whole timeout for an event already gone by.
 */
const LOADERS: Record<Cacheable, () => Promise<boolean>> = {
  interstitial: () =>
    awaitOutcome(AdEvent.InterstitialLoaded, AdEvent.InterstitialLoadFailed, LOAD_EVENT_TIMEOUT_MS, () =>
      LevelPlayAds.loadInterstitial({ adUnitId: units.interstitial }),
    ),
  rewarded: () =>
    awaitOutcome(AdEvent.RewardedLoaded, AdEvent.RewardedLoadFailed, LOAD_EVENT_TIMEOUT_MS, () =>
      LevelPlayAds.loadRewarded({ adUnitId: units.rewarded }),
    ),
}

const READY: Record<Cacheable, () => Promise<{ isReady: boolean }>> = {
  interstitial: () => LevelPlayAds.isInterstitialReady(),
  rewarded: () => LevelPlayAds.isRewardedReady(),
}

/**
 * One load per format at a time. The plugin answers a second load with
 * "Superseded by a new load request" and fails the first, so a tap landing on
 * an in-flight prefetch must JOIN it, not restart it.
 */
function load(format: Cacheable): Promise<boolean> {
  const slot = slots[format]
  slot.loading ??= LOADERS[format]().then((ok) => {
    slot.loading = null
    slot.ready = ok
    return ok
  })
  return slot.loading
}

/** Ask the SDK whether it holds an ad right now; a refused or broken call is "no". */
async function holdsAd(format: Cacheable): Promise<boolean> {
  const ready = await Promise.resolve()
    .then(() => READY[format]())
    .then((r) => r.isReady === true)
    .catch(() => false)
  slots[format].ready = ready
  return ready
}

/**
 * The interstitial's load: the cache or nothing — see the Prefetch section.
 * A load already in flight is not joined either; it keeps going for next time.
 */
async function fromCache(format: Cacheable): Promise<boolean> {
  const slot = slots[format]
  if (slot.loading) return false
  const ready = await holdsAd(format)
  // A miss (never filled, or the cached ad expired) goes to fetch the next one —
  // unless a backoff retry is already waiting, which is the same fetch, later.
  if (!ready && !slot.timer) prefetch(format)
  return ready
}

/**
 * The rewarded load: the cache when the SDK holds an ad, a load otherwise.
 *
 * A tap-time load that misses re-arms the backoff. Only prefetch() used to
 * schedule a retry, so once the chain broke — a cached ad expired, a load
 * failed at the tap — nothing refilled the slot until some ad closed, and every
 * later tap paid the whole load wait again.
 */
async function loadOrCached(format: Cacheable): Promise<boolean> {
  const slot = slots[format]
  if (slot.loading) return slot.loading
  if (await holdsAd(format)) return true
  const ok = await load(format)
  if (ok) slot.retryMs = PREFETCH_RETRY_MIN_MS
  else retryLater(format)
  return ok
}

/** One backoff timer per format at most; each miss doubles the wait, up to the cap. */
function retryLater(format: Cacheable): void {
  const slot = slots[format]
  if (slot.timer) return
  slot.timer = setTimeout(() => {
    slot.timer = null
    prefetch(format)
  }, slot.retryMs)
  slot.retryMs = Math.min(slot.retryMs * 2, PREFETCH_RETRY_MAX_MS)
}

function prefetch(format: Cacheable): void {
  const slot = slots[format]
  if (!sdkUp || !consentGranted || slot.ready || slot.loading) return
  // A No-Ads owner starts the SDK for hint videos only; loading interstitials
  // they are never shown is a stream of pointless requests. See
  // setInterstitialWanted().
  if (format === 'interstitial' && !interstitialWanted()) return
  if (slot.timer) {
    clearTimeout(slot.timer)
    slot.timer = null
  }
  void load(format).then((ok) => {
    if (ok) slot.retryMs = PREFETCH_RETRY_MIN_MS
    else retryLater(format)
  })
}

/** The cached ad was shown (or failed to present): it is spent, fetch the next. */
function spent(format: Cacheable): void {
  const slot = slots[format]
  slot.ready = false
  if (slot.timer) clearTimeout(slot.timer)
  slot.timer = setTimeout(() => {
    slot.timer = null
    prefetch(format)
  }, PREFETCH_AFTER_CLOSE_MS)
}

/** Persistent listeners: every terminal event of a shown ad refills its slot. */
let spentWatched = false

function watchSpent(): void {
  if (spentWatched) return
  spentWatched = true
  const on = (event: string, format: Cacheable): void => {
    void LevelPlayAds.addListener(event, () => spent(format)).catch(() => {
      // no native bridge (browser dev)
    })
  }
  on(AdEvent.InterstitialClosed, 'interstitial')
  on(AdEvent.InterstitialDisplayFailed, 'interstitial')
  on(AdEvent.RewardedClosed, 'rewarded')
  on(AdEvent.RewardedDisplayFailed, 'rewarded')
}

/** Who wants to know the SDK came up — see AdProvider.onReady. */
const readyListeners = new Set<() => void>()

/** Runs every time initialize() resolves (once per process in practice). */
function onSdkUp(): void {
  sdkUp = true
  // A no that landed while initialize() was still running found sdkUp false, so
  // noteConsent() could not tell the SDK to stop selling. Say it now; the
  // prefetch below already stays away on !consentGranted.
  if (!consentGranted) void applyPrivacyFlags(false)
  watchSpent()
  prefetch('interstitial')
  prefetch('rewarded')
  for (const listener of readyListeners) {
    try {
      listener()
    } catch {
      // a listener's bug must not cost the prefetch above, or the next listener
    }
  }
}

/**
 * Test seam: forget that the SDK was started and that consent is watched, and
 * optionally stand in an app key + unit ids. iOS ships its real ids and Android
 * ships empty ones (no LevelPlay app yet), so the tests pass their own
 * valid-shaped values: the init paths need a key, an empty key is its own test
 * case, and no test should hand the real ids to a plugin double or need the
 * file the release gate parses edited to get a key. Never called by the app.
 */
export function __resetForTests(config?: { appKey: string; units: AdUnits }): void {
  sdkStart = null
  sdkUp = false
  consentWatched = false
  spentWatched = false
  consentGranted = false
  initFailures = 0
  cancelInitRetry()
  bannerCreated = false
  readyListeners.clear()
  consentListeners.clear()
  interstitialWanted = () => true
  appKey = config?.appKey ?? APP_KEYS[PLATFORM] ?? ''
  units = config?.units ?? UNITS_BY_PLATFORM[PLATFORM] ?? { banner: '', interstitial: '', rewarded: '' }
  for (const format of ['interstitial', 'rewarded'] as const) {
    const slot = slots[format]
    if (slot.timer) clearTimeout(slot.timer)
    slots[format] = emptySlot()
  }
}

export const levelplayProvider: AdProvider = {
  // The gate markers ride along — see AD_MODE_MARKER above and ADS_MARKER in adProvider.ts.
  id: `levelplay ${AD_MODE_MARKER} ${ADS_MARKER}`,

  /*
   * FALSE ON PURPOSE, and not the same thing as TESTING.
   *
   * `testing` means "this build serves the network's test inventory", and the
   * only thing it ever fed was a green "TEST ADS" badge whose contract was
   * "safe to tap". On LevelPlay no build is: `isTesting` passed to initialize()
   * maps to `setMetaDataWithKey("is_test_suite", "enable")` (plugin
   * LevelPlayAdsImpl.swift) plus adapter debug logging — it only unlocks the
   * manually launched Test Suite. Ordinary show() calls serve the REAL
   * waterfall in every build, TestFlight included, and mediated ads carry no
   * visual test label. Reporting `testing: TESTING` would paint "safe" onto a
   * live-ads build — the trap that closed the Google account, with the safety
   * light wired backwards. Unity terminates for invalid traffic too, and claws
   * back money on top. That is why this app has no badge any more.
   *
   * TESTING itself still drives AD_MODE_MARKER and the release gate, which stay
   * meaningful. Never read a green gate as permission to tap.
   */
  testing: false,

  supports: (format: AdFormat) => SUPPORTED.has(format),

  /*
   * CONSENT FIRST, THEN INIT — and that order is a legal requirement, not style.
   *
   * ironSource's GDPR guidance: "You must obtain user consent before initializing
   * any third-party SDK, including LevelPlay and ironSource ad network. If
   * consent is not obtained, do not initialize the LevelPlay SDK." The plugin
   * repeats it under a heading literally called "CRITICAL: Proper Execution
   * Order" (definitions.d.ts).
   *
   * The old Google stack initialised first and asked afterwards — correct for
   * Google's own consent framework, wrong here, and exactly the shape a straight
   * port carries over unnoticed. `initialize()` is not inert: it calls
   * LevelPlay.initWith(), which transmits device and app data to configure the
   * waterfall, so doing it first means data leaves the device before the player
   * has been asked. Pinned by providers/levelplay.test.ts. Do not "tidy" it back.
   */
  async init(): Promise<void> {
    // An unconfigured key would reach the SDK as an opaque init failure some
    // frames later, looking exactly like "no fill" — the one symptom nobody
    // investigates. Fail here instead, where the reason is legible, and before
    // any consent modal: there is no SDK to consent to.
    if (!appKey) {
      throw new Error(
        `levelplay: no app key for platform "${PLATFORM}" — create Exactly 67's ${PLATFORM} app in the ` +
          'LevelPlay dashboard (a separate app per platform) and paste its key into APP_KEYS',
      )
    }
    watchConsent()
    // Both consent calls are bounded. They sit in front of everything: a CMP
    // that renders and never returns would otherwise leave init() pending
    // forever — no banner, no interstitial, no hint videos for the session.
    await requestConsent()
    // requestConsent() swallows every error, so a CMP that failed to render
    // would otherwise fall through to init. No consent, no init.
    const status = await withDeadline(
      LevelPlayAds.getConsentData()
        .then((d) => d.status)
        .catch(() => 'UNKNOWN'),
      ATT_TIMEOUT_MS, // a stored-value read, not a screen: the short ceiling
      'getConsentData',
      'UNKNOWN',
    )
    // DENIED counts as "consent not obtained" exactly as much as UNKNOWN does.
    // KVIZKO's first guard read `=== 'UNKNOWN'` and so let a player who had
    // actively tapped Decline straight through to initialize(). UNKNOWN means
    // the CMP never answered; DENIED means it answered no. Only GRANTED is a yes.
    noteConsent(status === 'GRANTED')
    if (!consentGranted) return
    // Rejects when initialize() fails. The policy layer swallows that, and the
    // retry schedule above takes over — see INIT_RETRY_DELAYS_MS.
    await startSdk()
  },

  /* The foreground retry — see the "Start + retry" section for the schedule. */
  retryInit: () => attemptInit(),

  onReady(listener: () => void): void {
    readyListeners.add(listener)
  },

  /* Only a GRANTED consent is a yes — the same rule that decides whether the SDK starts. */
  adsAllowed: () => consentGranted,

  onConsentChange(listener: (granted: boolean) => void): void {
    consentListeners.add(listener)
  },

  setInterstitialWanted(wanted: () => boolean): void {
    interstitialWanted = wanted
  },

  /*
   * The one-time migration off Google's consent record — see AdProvider.resetConsent.
   *
   * Natively this removes `levelplay_consent_status` and runs TcfPrefs.clear(),
   * which drops the IABTCF_TCString / gdprApplies / PurposeConsents keys the
   * plugin's `custom` provider would otherwise read as a decision (plugin
   * LevelPlayAdsImpl.swift consentStatus(): any TCF key present → GRANTED or
   * DENIED, and requestConsent() then never shows the modal).
   *
   * The call also emits onConsentStatusChanged (UNKNOWN). That event is
   * harmless by construction: services/ads runs this before init(), so
   * watchConsent() has not subscribed yet and Capacitor drops the event; and a
   * not-GRANTED status can only ever record a "no", never start anything. The
   * guard below keeps it from ever wiping the decision a running SDK was started
   * on. Bounded like every other consent call, and never rejects: a failed reset
   * must not cost the session its consent modal.
   */
  async resetConsent(): Promise<void> {
    if (sdkUp || sdkStart) return
    await withDeadline(
      LevelPlayAds.resetConsent().then(() => undefined),
      ATT_TIMEOUT_MS, // a stored-value write, not a screen: the short ceiling
      'resetConsent',
      undefined,
    )
  },

  openPrivacyOptions: () => openPrivacyOptions(),

  async bannerShow(): Promise<void> {
    if (!bannerCreated) {
      // `isAutoShow` means the banner appears as soon as it fills, so creating
      // it IS showing it. Creating a second one would stack two banner surfaces.
      await LevelPlayAds.createBanner({
        adUnitId: units.banner,
        adSize: 'BANNER', // fixed 320x50, so it matches BANNER_RESERVE_DESIGN_PX exactly
        position: 'BOTTOM', // pinned to the safe area's bottom — above the home indicator
        isAutoShow: true,
      })
      bannerCreated = true
      return
    }
    await LevelPlayAds.showBanner()
  },
  bannerResume: () => LevelPlayAds.showBanner(),
  bannerHide: () => LevelPlayAds.hideBanner(),
  async bannerRemove(): Promise<void> {
    await LevelPlayAds.destroyBanner()
    bannerCreated = false
  },

  /* From the prefetch cache only — never a load holding the win card. See the Prefetch section. */
  loadInterstitial: () => fromCache('interstitial'),

  /*
   * Resolves on DISPLAYED, not on close — which is what resolvesOnPresent()
   * promises the policy layer for this format. The wait for the player to be
   * finished belongs to watchDismissal().
   */
  showInterstitial: () =>
    awaitOutcome(AdEvent.InterstitialDisplayed, AdEvent.InterstitialDisplayFailed, SHOW_EVENT_TIMEOUT_MS, () =>
      LevelPlayAds.showInterstitial(),
    ),

  /* The cache, or a tap-time load the player asked for — see the Prefetch section. */
  loadRewarded: () => loadOrCached('rewarded'),

  /** The draw-time hint: true while the prefetch holds a rewarded ad. */
  rewardedReady: () => slots.rewarded.ready,

  /*
   * Settles ONLY when the reward is earned, because the policy layer races this
   * promise against the dismissal watcher and reads "watcher won" as "player
   * skipped". Resolving on close as well would make a skipped ad look like a
   * reward. A failed present — or one that never showed up within the display
   * deadline — still resolves null so the race cannot hang on an ad that never
   * appeared.
   */
  showRewarded: () => awaitReward(),

  resolvesOnPresent: (format: AdFormat) => format === 'interstitial',

  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher {
    return watchLevelPlay(AD_EVENTS[format], timeoutMs)
  },
}

/**
 * Read the device advertising id — the value the LevelPlay dashboard wants in
 * Settings → Test Devices.
 *
 * WHAT THE PIN ACTUALLY DOES, in Unity's own words: a registered device "will
 * then receive ads exclusively from that specific ad network", the configuration
 * "will reset within the hour", and "non-bidding ad networks can only test live
 * ads". That is exclusivity of SOURCE for about an hour — not test creatives,
 * and not a safe device. Pin it, then behave as if you had not: never tap an ad,
 * on any build, on any phone.
 *
 * Returns an empty string off-device, and on iOS the all-zero UUID when ATT was
 * declined — the zero id matches nothing, so pinning it does nothing at all.
 */
export async function advertisingId(): Promise<string> {
  try {
    const { id } = await LevelPlayAds.getAdvertisingId()
    return id
  } catch {
    return ''
  }
}

async function requestConsent(): Promise<void> {
  // iOS 14.5+ ATT — needs NSUserTrackingUsageDescription in Info.plist (the
  // plugin's manifest hook writes package.json's `levelplay.userTrackingDescription`).
  // Asked first: the advertising id is zeroed until it is granted.
  await withDeadline(
    LevelPlayAds.requestTrackingAuthorization().catch(() => {
      // declined / non-iOS
    }),
    ATT_TIMEOUT_MS,
    'requestTrackingAuthorization',
  )
  // Each call gets its own ceiling. Under one shared deadline a slow ATT ate the
  // modal's time, and a slow reader looked like a stalled CMP.
  await withDeadline(
    LevelPlayAds.requestConsentInfo(consentOptions()).catch(() => {
      // not required / unavailable
    }),
    CONSENT_TIMEOUT_MS,
    'requestConsentInfo',
  )
}

/**
 * Re-open the consent modal so a decision can be changed.
 *
 * Without this the first tap is final: the modal only appears while consent is
 * UNKNOWN, so a player who declined — or accepted and changed their mind — had
 * no way back, in an app that ships worldwide. GDPR treats withdrawal as being
 * as available as the original consent. The consent watcher above turns a new
 * yes into an SDK start and a new no into do_not_sell.
 */
export async function openPrivacyOptions(): Promise<void> {
  try {
    await LevelPlayAds.showPrivacyOptions(consentOptions())
  } catch {
    // provider without a privacy screen, or not on device
  }
}

/**
 * Run `trigger`, then resolve TRUE on the success event and FALSE on the failure
 * event — the shape every load and show in this SDK takes.
 *
 * Timeout-guarded because a dropped event would otherwise leave the game waiting
 * for ever with its loop paused. A timeout reads as FALSE, never as a hang:
 * losing an ad is cheap, freezing the game is not.
 */
function awaitOutcome(
  okEvent: string,
  failEvent: string,
  timeoutMs: number,
  trigger: () => Promise<unknown>,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const handles: { remove: () => void }[] = []
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach(handles)
      resolve(value)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    attach(okEvent, () => finish(true), handles, () => settled)
    attach(failEvent, () => finish(false), handles, () => settled)
    // Only now, with both listeners pending, is it safe to ask for the ad.
    void trigger().catch(() => finish(false))
  })
}

/**
 * Show a rewarded ad and resolve with the reward, or null if it failed to
 * present. See showRewarded() for why close is NOT a resolution here.
 *
 * It must also APPEAR in time, the same deadline the interstitial's show has.
 * The native showRewarded() resolves as soon as it hands the ad to the SDK
 * (plugin LevelPlayAdsImpl.swift: `ad.showAd(…)` then `completion(true, nil)`),
 * so a present the SDK swallows without a DisplayFailed would otherwise leave
 * the game asleep, music off and the board frozen for the policy layer's whole
 * three-minute show ceiling, with no ad on screen. Once RewardedDisplayed has
 * arrived the ad is really up and the wait belongs to the player again.
 */
function awaitReward(): Promise<unknown | null> {
  return new Promise<unknown | null>((resolve) => {
    const handles: { remove: () => void }[] = []
    let settled = false
    let displayed = false
    const finish = (value: unknown | null): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      detach(handles)
      resolve(value)
    }
    const deadline = setTimeout(() => {
      if (!displayed) finish(null)
    }, SHOW_EVENT_TIMEOUT_MS)
    attach(
      AdEvent.RewardedDisplayed,
      () => {
        displayed = true
        clearTimeout(deadline)
      },
      handles,
      () => settled,
    )
    attach(AdEvent.RewardedRewarded, (info) => finish(info ?? true), handles, () => settled)
    attach(AdEvent.RewardedDisplayFailed, () => finish(null), handles, () => settled)
    void LevelPlayAds.showRewarded().catch(() => finish(null))
  })
}

/**
 * Watch for "this ad is over" — closed OR failed to present, since a failed
 * present never emits a close and would otherwise hang the wait.
 */
function watchLevelPlay(events: readonly string[], timeoutMs: number): DismissWatcher {
  const handles: { remove: () => void }[] = []
  let settled = false
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach(handles)
      resolve()
    }
  })
  const timer = setTimeout(() => finish(), timeoutMs)
  for (const evt of events) attach(evt, () => finish(), handles, () => settled)
  return { done, cancel: () => finish() }
}

/**
 * Subscribe, keeping the handle so it can be detached — and detaching straight
 * away if the race was already decided while the subscription was in flight,
 * which otherwise leaks one listener per ad shown.
 */
function attach(
  event: string,
  handler: (info: unknown) => void,
  handles: { remove: () => void }[],
  isSettled: () => boolean,
): void {
  try {
    void LevelPlayAds.addListener(event, handler)
      .then((h) => (isSettled() ? void h.remove() : handles.push(h)))
      .catch(() => {})
  } catch {
    // event unsupported here — the timeout still covers us
  }
}

function detach(handles: { remove: () => void }[]): void {
  for (const h of handles) {
    try {
      void h.remove()
    } catch {
      // already detached
    }
  }
}
