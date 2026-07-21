import { Capacitor } from '@capacitor/core'
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob'
import type { AdMobBannerSize } from '@capacitor-community/admob'
import { resumeAudio } from './audio'
import {
  loadAdClears,
  loadAdsRemoved,
  loadFreeHintDate,
  loadHintCount,
  saveAdClears,
  saveAdsRemoved,
  saveFreeHintDate,
  saveHintCount,
} from './storage'

/**
 * Ads service — mirrors the audio/haptics pattern: a thin, toggle-gated,
 * fire-and-forget wrapper that silently no-ops off-device (web / dev), so the
 * game logic and the rest of the render layer never branch on platform.
 *
 * Formats (see docs/MONETIZATION.md):
 *   - banner       persistent, bottom-anchored (layout reserves a strip for it)
 *   - interstitial full-screen, every N clears at a natural break
 *   - rewarded     opt-in, grants a hint
 *
 * Real ads stay off until you drop your AdMob unit IDs into LIVE_UNITS and set
 * TESTING = false. Until then Google's official iOS test units serve safe
 * fillers that never bill and never risk an invalid-traffic ban.
 */

// --- configuration -------------------------------------------------------

/**
 * true = serve Google *test* ads (safe to click). false = real, billable ads.
 * FALSE for the App Store production submission (the iOS AdMob app is approved +
 * ad-serving-enabled, so real iOS units fill). The Android AdMob app is not yet
 * approved, but the already-uploaded Play internal-testing build (versionCode 1)
 * was built with test ads and is unchanged, so Android device testing still
 * works; new Android builds now use LIVE_UNITS_ANDROID (won't fill until AdMob
 * approves the public app).
 */
const TESTING = false

interface AdUnits {
  banner: string
  interstitial: string
  rewarded: string
}

/** Google's official test ad units — per platform, safe, never billed. */
const TEST_UNITS_IOS: AdUnits = {
  banner: 'ca-app-pub-3940256099942544/2934735716',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
}
const TEST_UNITS_ANDROID: AdUnits = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
}

/** Real AdMob ad units for Exactly 67. AdMob apps are per platform. */
const LIVE_UNITS_IOS: AdUnits = {
  banner: 'ca-app-pub-3307486877162157/9242462556',
  interstitial: 'ca-app-pub-3307486877162157/9437490984',
  rewarded: 'ca-app-pub-3307486877162157/2677054209',
}
/** Real AdMob **Android** units (AdMob app id ...~2480617239). */
const LIVE_UNITS_ANDROID: AdUnits = {
  banner: 'ca-app-pub-3307486877162157/3342538697',
  interstitial: 'ca-app-pub-3307486877162157/1989662641',
  rewarded: 'ca-app-pub-3307486877162157/2097473852',
}

const IS_ANDROID = Capacitor.getPlatform() === 'android'
const UNITS: AdUnits = TESTING
  ? IS_ANDROID
    ? TEST_UNITS_ANDROID
    : TEST_UNITS_IOS
  : IS_ANDROID
    ? LIVE_UNITS_ANDROID
    : LIVE_UNITS_IOS

/**
 * Interstitial cadence is a HYBRID gate: a level-clear count decides *where* (a
 * natural break), while a time floor + first-ad delay + session cap decide
 * *whether*. This is the 2024-25 casual-puzzle best practice and the only way to
 * stay structurally inside AdMob policy (no back-to-back ads, no ad at app load,
 * no surprise ad on the first clear of a returning session). See docs/MONETIZATION.md.
 */
/** Show an interstitial once this many levels have been cleared since the last.
 *  A learnable "every 3rd win" rhythm — predictability is what players tolerate. */
const CLEARS_PER_INTERSTITIAL = 3
/** Never interrupt the first levels. The signature balloon mechanic debuts at
 *  L6, so a player hasn't met the hook before ~L8; early sessions also monetize
 *  poorly, so holding ads to L8 costs ~nothing and protects the first impression. */
const ONBOARDING_LEVELS = 8
/** Hard spacing floor: never two interstitials closer than this. 3 min reads
 *  distinctly "calm/premium" vs the ~2 min AdMob policy minimum, and the 3-clear
 *  gate already spaces most ads past it, so the revenue cost is near-zero. */
const MIN_SECONDS_BETWEEN_ADS = 180
/** Per-session warm-up: no interstitial until this long after launch. Lifts D1
 *  retention ~5-8% (low-intent early sessions) with negligible revenue loss.
 *  Also stops a surprise ad on the first clear of a returning session (the clear
 *  counter persists across launches) — do not shorten. */
const FIRST_AD_MIN_SESSION_SECONDS = 90
/** Cap interstitials per app session; the 4th+ impression is the lowest-value,
 *  highest-annoyance one, so 3 reads calmer at ~no retention cost. */
const MAX_ADS_PER_SESSION = 3
/** After an opt-in rewarded hint, mute interstitials this long — don't double-tax
 *  a player who just volunteered their attention (also lifts total ad revenue by
 *  keeping opt-in intent alive). */
const REWARDED_SUPPRESS_SECONDS = 300

/**
 * Initial design-pixel reserve at the screen bottom for the banner (before it
 * loads). Once the banner reports its real height via the SizeChanged event we
 * replace this with the exact value (see `setBannerHeightHandler`), so nothing
 * draggable ever sits under the ad. main.ts multiplies by DPR.
 */
export const BANNER_RESERVE_DESIGN_PX = 60

// --- state ---------------------------------------------------------------

let initialized = false
let bannerShown = false
let bannerListening = false
let removed = false
let clearsSinceInterstitial = 0
let lastFreeHintDate = ''
let hintCount = 0

// Interstitial pacing state (in-memory, per app session). `sessionStart` is set
// at module load, which is the cold launch under Capacitor.
const sessionStart = Date.now()
let lastInterstitialAt = 0 // ms epoch of the last *shown* ad; 0 = none this session
let adsThisSession = 0
let lastRewardedAt = 0 // ms epoch of the last *earned* rewarded hint; 0 = none this session

/** Called with the banner's real height (design px + margin) when it loads. */
let onBannerHeight: ((designPx: number) => void) | null = null

/** Register a handler that reserves layout space for the actual banner height. */
export function setBannerHeightHandler(cb: (designPx: number) => void): void {
  onBannerHeight = cb
}

/** Native (iOS/Android) only — everything below no-ops on web/dev. */
export function adsSupported(): boolean {
  return Capacitor.isNativePlatform()
}

export function adsRemoved(): boolean {
  return removed
}

/**
 * Reflect the persisted remove-ads flag into memory at boot, before scenes read
 * `adsRemoved()`. Needed because `initAds()` — which also loads it — is skipped
 * for owners (no SDK init when ads are off), so it can't be the only source.
 * Does NOT persist (the value came from storage).
 */
export function primeAdsRemoved(value: boolean): void {
  removed = value
}

/** Flip the remove-ads flag (call after a successful IAP purchase / restore). */
export function setAdsRemoved(value: boolean): void {
  removed = value
  void saveAdsRemoved(value)
  if (value) void removeBanner()
}

// --- lifecycle -----------------------------------------------------------

/** Initialize the SDK + collect consent (GDPR/UMP) + ATT. Safe to call once. */
export async function initAds(): Promise<void> {
  if (!adsSupported() || initialized) return
  initialized = true
  removed = await loadAdsRemoved()
  clearsSinceInterstitial = await loadAdClears()
  try {
    await AdMob.initialize({ initializeForTesting: TESTING })
    // A full-screen ad backgrounds the web view and suspends the iOS
    // AudioContext; restore sound the moment the ad is dismissed.
    void AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => resumeAudio())
    void AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resumeAudio())
    await requestConsent()
  } catch {
    // Init failed — later calls guard on errors and no-op.
  }
}

async function requestConsent(): Promise<void> {
  try {
    const info = await AdMob.requestConsentInfo()
    if (info.isConsentFormAvailable) await AdMob.showConsentForm()
  } catch {
    // no consent form / not required
  }
  try {
    // iOS 14.5+: ATT prompt. Requires NSUserTrackingUsageDescription in Info.plist.
    await AdMob.requestTrackingAuthorization()
  } catch {
    // user declined or non-iOS
  }
}

// --- banner --------------------------------------------------------------

export async function showBanner(): Promise<void> {
  if (!adsSupported() || removed || bannerShown) return
  // Reserve the exact banner height once it reports its size (points → design
  // px), plus a small margin, so the tray/UI clears it precisely.
  if (!bannerListening) {
    bannerListening = true
    void AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
      const h = size?.height ?? 0
      if (h > 0) onBannerHeight?.(Math.min(Math.max(h + 8, 52), 120))
    })
  }
  try {
    await AdMob.showBanner({
      adId: UNITS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: TESTING,
    })
    bannerShown = true
  } catch {
    // no fill / offline — stay hidden
  }
}

export async function hideBanner(): Promise<void> {
  if (!adsSupported() || !bannerShown) return
  try {
    await AdMob.hideBanner()
  } catch {
    /* noop */
  }
  bannerShown = false
}

export async function removeBanner(): Promise<void> {
  if (!adsSupported()) return
  try {
    await AdMob.removeBanner()
  } catch {
    /* noop */
  }
  bannerShown = false
}

// --- interstitial --------------------------------------------------------

/** Count one level clear toward the interstitial cadence (call once per win). */
export function noteCleared(): void {
  clearsSinceInterstitial++
  void saveAdClears(clearsSinceInterstitial)
}

/**
 * The whole interstitial gate, as a *non-consuming* predicate: true only when an
 * ad would fire for this just-cleared level. It is the single source of truth —
 * `maybeShowInterstitial` acts on it, and the win overlay reads it to avoid
 * pairing the rating ask with an ad (`review.ts` mutual-exclusion). A count
 * decides *where* (a natural break); time floor + warm-up + session cap +
 * rewarded-suppression decide *whether*.
 */
export function interstitialWouldShow(clearedGlobal: number): boolean {
  if (!adsSupported() || removed) return false
  if (clearedGlobal <= ONBOARDING_LEVELS) return false
  // Let each pack-complete celebration — and especially the L72 "The End!" —
  // land ad-free; the worst possible closing note is an ad chaser.
  if (clearedGlobal === 24 || clearedGlobal === 48 || clearedGlobal === 72) return false
  if (adsThisSession >= MAX_ADS_PER_SESSION) return false
  if (clearsSinceInterstitial < CLEARS_PER_INTERSTITIAL) return false
  const now = Date.now()
  // Warm-up: never interrupt the first minute-and-a-half of a session — early
  // sessions are low-intent, and a surprise ad on the first clear of a returning
  // player (the clear counter persists across launches) is the #1 retention hit.
  if ((now - sessionStart) / 1000 < FIRST_AD_MIN_SESSION_SECONDS) return false
  // Spacing floor: guarantees we never break AdMob's no-back-to-back rule, even
  // when someone replays easy early levels in quick succession.
  const sinceLast = lastInterstitialAt ? (now - lastInterstitialAt) / 1000 : Infinity
  if (sinceLast < MIN_SECONDS_BETWEEN_ADS) return false
  // Don't double-tax a player who just opted into a rewarded hint.
  if (lastRewardedAt && (now - lastRewardedAt) / 1000 < REWARDED_SUPPRESS_SECONDS) return false
  return true
}

/**
 * Show an interstitial at a natural break (advancing / returning to the map) iff
 * the gate is open. No-ops when ads are removed, off-device, or any gate is
 * closed. Call on the leave tap after a win.
 */
export async function maybeShowInterstitial(clearedGlobal: number): Promise<void> {
  if (!interstitialWouldShow(clearedGlobal)) return
  try {
    await AdMob.prepareInterstitial({ adId: UNITS.interstitial, isTesting: TESTING })
    await AdMob.showInterstitial()
    // Spend the cadence only once an ad actually showed; a no-fill/offline
    // break leaves the counter armed (and the time floor unmoved) so the next
    // clear retries.
    clearsSinceInterstitial = 0
    void saveAdClears(0)
    lastInterstitialAt = Date.now()
    adsThisSession++
  } catch {
    // no fill — skip this break, keep the counter armed
  }
}

// --- rewarded ------------------------------------------------------------

/**
 * Show a rewarded ad for a hint. Resolves true when the reward is earned — or
 * off-device, so the hint stays testable in the browser during development —
 * and false if there was no ad to show or the user bailed out early.
 */
export async function showRewardedHint(): Promise<boolean> {
  if (!adsSupported()) return true
  try {
    await AdMob.prepareRewardVideoAd({ adId: UNITS.rewarded, isTesting: TESTING })
    const reward = await AdMob.showRewardVideoAd()
    // Record the opt-in so the next interstitial is suppressed for a while.
    if (reward != null) lastRewardedAt = Date.now()
    return reward != null
  } catch {
    return false
  }
}

// --- hint inventory ------------------------------------------------------
//
// Hints are a persisted, collectable balance: the player earns them (one free
// per day, plus one per rewarded video) and spends them whenever they like.
// Watching an ad no longer reveals a hint on the spot — it just tops up the
// stash — so a player can bank as many as they want and use them on their terms.

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Load the hint inventory and grant the daily free hint. Call once at boot
 * (awaited, so the HUD badge is correct on first render). The free top-up fires
 * the first time we boot on a new UTC day.
 */
export async function initHintState(): Promise<void> {
  ;[hintCount, lastFreeHintDate] = await Promise.all([loadHintCount(), loadFreeHintDate()])
  const today = todayUtc()
  if (lastFreeHintDate !== today) {
    lastFreeHintDate = today
    hintCount += 1
    void saveFreeHintDate(today)
    void saveHintCount(hintCount)
  }
}

/** How many hints the player currently has banked. */
export function hintCountValue(): number {
  return hintCount
}

/** True when there's at least one hint to spend. */
export function hasHint(): boolean {
  return hintCount > 0
}

/** Spend one hint. Returns false (and changes nothing) when the stash is empty. */
export function useHint(): boolean {
  if (hintCount <= 0) return false
  hintCount -= 1
  void saveHintCount(hintCount)
  return true
}

/** Add one hint to the stash (call after a rewarded video is earned). */
export function grantHint(): void {
  hintCount += 1
  void saveHintCount(hintCount)
}
