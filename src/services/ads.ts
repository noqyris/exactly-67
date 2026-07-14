import { Capacitor } from '@capacitor/core'
import { AdMob, BannerAdPluginEvents, BannerAdPosition, BannerAdSize } from '@capacitor-community/admob'
import type { AdMobBannerSize } from '@capacitor-community/admob'
import {
  loadAdClears,
  loadAdsRemoved,
  loadFreeHintDate,
  saveAdClears,
  saveAdsRemoved,
  saveFreeHintDate,
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
 * true = serve Google *test* ads (safe to click). Flip to false to ship.
 * NOTE: currently TRUE for TestFlight verification — real ads don't serve until
 * AdMob approves the new app, so test ads are the only way to see the banner /
 * rewarded flow on device. **Must be false for the App Store submission.**
 */
const TESTING = true

/** Google's official iOS test ad units — safe, never billed. */
const TEST_UNITS = {
  banner: 'ca-app-pub-3940256099942544/2934735716',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
}

/** Real AdMob ad units for Exactly 67 (app ID ...~1451034229). */
const LIVE_UNITS = {
  banner: 'ca-app-pub-3307486877162157/9242462556',
  interstitial: 'ca-app-pub-3307486877162157/9437490984',
  rewarded: 'ca-app-pub-3307486877162157/2677054209',
}

const UNITS = TESTING ? TEST_UNITS : LIVE_UNITS

/** Show an interstitial once this many levels have been cleared since the last. */
const CLEARS_PER_INTERSTITIAL = 5
/** Never interrupt the first levels — let players learn the game first. */
const ONBOARDING_LEVELS = 5

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

// --- daily free hint -----------------------------------------------------

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Load the persisted free-hint date. Call once at boot. */
export async function initHintState(): Promise<void> {
  lastFreeHintDate = await loadFreeHintDate()
}

/** True when the player still has today's one free hint (no ad needed). */
export function freeHintAvailable(): boolean {
  return lastFreeHintDate !== todayUtc()
}

/** Spend today's free hint (persist the date so it resets tomorrow). */
export function consumeFreeHint(): void {
  lastFreeHintDate = todayUtc()
  void saveFreeHintDate(lastFreeHintDate)
}
