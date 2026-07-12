import { Capacitor } from '@capacitor/core'
import { AdMob, BannerAdPosition, BannerAdSize } from '@capacitor-community/admob'
import { loadAdClears, loadAdsRemoved, saveAdClears, saveAdsRemoved } from './storage'

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

/** true = serve Google *test* ads (safe to click). Flip to false to ship. */
const TESTING = true

/** Google's official iOS test ad units — safe, never billed. */
const TEST_UNITS = {
  banner: 'ca-app-pub-3940256099942544/2934735716',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
}

/** Your real AdMob ad units — fill these in, then set TESTING = false. */
const LIVE_UNITS = {
  banner: 'ca-app-pub-0000000000000000/0000000000',
  interstitial: 'ca-app-pub-0000000000000000/0000000000',
  rewarded: 'ca-app-pub-0000000000000000/0000000000',
}

const UNITS = TESTING ? TEST_UNITS : LIVE_UNITS

/** Show an interstitial once this many levels have been cleared since the last. */
const CLEARS_PER_INTERSTITIAL = 5
/** Never interrupt the first levels — let players learn the game first. */
const ONBOARDING_LEVELS = 5

/**
 * Design-pixel height the layout should reserve at the screen bottom for the
 * banner so nothing draggable sits under it. main.ts multiplies by DPR.
 * Comfortably covers an iOS adaptive-anchored banner (~50pt) plus a hair.
 */
export const BANNER_RESERVE_DESIGN_PX = 56

// --- state ---------------------------------------------------------------

let initialized = false
let bannerShown = false
let removed = false
let clearsSinceInterstitial = 0

/** Native (iOS/Android) only — everything below no-ops on web/dev. */
export function adsSupported(): boolean {
  return Capacitor.isNativePlatform()
}

export function adsRemoved(): boolean {
  return removed
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
 * Show an interstitial if enough levels have been cleared since the last one.
 * Call at a natural break (advancing / returning to the map). No-ops when ads
 * are removed, off-device, or the just-cleared level is still onboarding.
 */
export async function maybeShowInterstitial(clearedGlobal: number): Promise<void> {
  if (!adsSupported() || removed) return
  if (clearedGlobal <= ONBOARDING_LEVELS) return
  if (clearsSinceInterstitial < CLEARS_PER_INTERSTITIAL) return
  clearsSinceInterstitial = 0
  void saveAdClears(0)
  try {
    await AdMob.prepareInterstitial({ adId: UNITS.interstitial, isTesting: TESTING })
    await AdMob.showInterstitial()
  } catch {
    // no fill — skip this break
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
    return reward != null
  } catch {
    return false
  }
}
