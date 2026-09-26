import { Capacitor } from '@capacitor/core'
import { clearsPerInterstitial, noteRewarded, rewardedLeft, type RewardPlacement } from '../game/economy'
import { PACKS } from '../game/levels'
import { BANNER_RESERVE_DESIGN_PX, adsMock, adsOff, type DismissWatcher } from './adProvider'
import { levelplayProvider } from './providers/levelplay'
import { mockProvider } from './providers/mock'
import { resumeAudio } from './audio'
import { meta, today, updateMeta } from './metaStore'
import { startMusic, stopMusic, suppressMusic } from './music'
import {
  loadAdClears,
  loadConsentMigrated,
  loadHintCount,
  saveAdClears,
  saveAdsRemoved,
  saveConsentMigrated,
  saveHintCount,
  saveUnlimitedHints,
} from './storage'

/**
 * The ad POLICY layer — mirrors the audio/haptics pattern: thin, guarded,
 * fire-and-forget, and a silent no-op wherever there is no ad surface, so the
 * game logic and the scenes never branch on platform or build.
 *
 * It decides WHEN an ad may appear and what happens around it; it does not know
 * WHO serves it. Every SDK call goes through the seam in `adProvider.ts`,
 * implemented by `providers/levelplay.ts` (Unity LevelPlay) — or, in a
 * `VITE_ADS=mock` build, by `providers/mock.ts`, our own fake ads. Google closed
 * the previous publisher account on 2026-08-18; this layer is what survived the
 * move unchanged, which is the point of the seam.
 *
 * Formats (see docs/MONETIZATION.md):
 *   - banner       persistent, bottom-anchored in a strip the layout reserves
 *   - interstitial full-screen, at a natural break after a win, cadence-gated
 *   - rewarded     opt-in, always naming its reward, at eight capped placements
 *                  (game/economy.ts RewardPlacement): the hint modal, the daily
 *                  gift, the Star Jar, a finished pack, the Store's free tile,
 *                  a streak freeze, a streak repair and a streak milestone
 * There is no app-open ad, and there must never be one: LevelPlay has no such
 * format, and its Placement Policy bars placements "launched before an
 * Application has opened".
 *
 * Who gets what — two entitlements, never confused (see iap.ts):
 *   - nothing bought     SDK init + banner + interstitials + hint videos
 *   - No Ads ($0.99)     SDK init + hint videos only. The rewarded video is the
 *                        player's own choice, so it breaks no promise; banner and
 *                        interstitial — the formats that interrupt — are gone.
 *   - Unlimited ($4.99)  no SDK at all. Hints are free, so no ad can ever be
 *                        shown, and starting the SDK would only cost them a
 *                        consent modal and an ATT alert for nothing.
 */

/**
 * Which network this build talks to. `import.meta.env` inline, NOT the
 * adsMock() helper: Vite folds the inline read to a literal, so a non-mock
 * bundle keeps only `levelplayProvider` and tree-shakes providers/mock.ts out
 * entirely (and a mock bundle drops LevelPlay's). Through a function call it
 * could not, and every store build would carry fake-ad code and a second set of
 * gate markers. Verified by counting markers in the built bundle.
 */
const provider = import.meta.env.VITE_ADS === 'mock' ? mockProvider : levelplayProvider

// --- cadence ---------------------------------------------------------------

/**
 * Interstitial cadence is a HYBRID gate: a level-clear count decides *where* (a
 * natural break), while a time floor + first-ad delay + session cap decide
 * *whether*. The casual-puzzle practice that keeps an ad from ever feeling like
 * a punishment: no back-to-back ads, no ad at app load, no surprise ad on the
 * first clear of a returning session. See docs/MONETIZATION.md.
 */
/* Clears between interstitials: a learnable "every 3rd win" rhythm, every 6th for
 * a player who has paid for anything — see clearsPerInterstitial() in
 * game/economy.ts. Predictability is what players tolerate. */
/** Never interrupt the first levels. The signature balloon mechanic debuts at
 *  L6, so a player hasn't met the hook before ~L8; early sessions also monetize
 *  poorly, so holding ads to L8 costs ~nothing and protects the first impression. */
const ONBOARDING_LEVELS = 8
/** Hard spacing floor: never two interstitials closer than this. 3 min reads
 *  distinctly "calm/premium", and the 3-clear gate already spaces most ads past
 *  it, so the revenue cost is near-zero. */
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
 * The global level numbers whose clear completes a pack — the last level of
 * every pack, the final one being the game's "The End!" clear. Each lands
 * ad-free: finishing a pack is the moment the player feels the most, and the
 * worst possible closing note is an ad chaser.
 *
 * Derived from PACKS rather than written down. This used to read
 * `24 || 48 || 72`, which was right while the game had three packs and silently
 * stopped covering anything once packs 4–25 (600 levels) were appended.
 */
const PACK_FINALES: ReadonlySet<number> = (() => {
  const ends = new Set<number>()
  let global = 0
  for (const pack of PACKS) {
    global += pack.levels.length
    ends.add(global)
  }
  return ends
})()

/** Loading must not hang the UI; playback gets a long leash (real ads + the
 *  advertiser page the player may browse), purely as a deadlock breaker. */
const AD_LOAD_TIMEOUT_MS = 15_000
const AD_SHOW_TIMEOUT_MS = 180_000
/**
 * How long a dismissal waits for a reward that is already on its way. Some
 * LevelPlay adapters emit RewardedClosed BEFORE RewardedRewarded; without this
 * grace the close won the race, the wait returned "no reward", and the reward
 * event landed a few milliseconds later with nobody listening — a player who
 * watched the whole video and got no hint.
 */
const REWARD_AFTER_CLOSE_MS = 800

/** Re-exported: the fixed banner strip every scene keeps clear. See adProvider.ts. */
export { BANNER_RESERVE_DESIGN_PX }

// --- state -----------------------------------------------------------------

let initialized = false
let removed = false
// Unlimited hints (the $4.99 bundle). Distinct from `removed` — see hintsUnlimited().
let unlimited = false
let clearsSinceInterstitial = 0
let hintCount = 0

// Interstitial pacing state (in-memory, per app session). `sessionStart` is set
// at module load, which is the cold launch under Capacitor.
const sessionStart = Date.now()
let lastInterstitialAt = 0 // ms epoch of the last *presented* interstitial; 0 = none this session
let adsThisSession = 0
let lastRewardedAt = 0 // ms epoch of the last *earned* rewarded hint; 0 = none this session

/** Full-screen ads currently up (or being shown) — never stack a second one. */
let fullScreenDepth = 0

// --- availability & entitlements -----------------------------------------------

/**
 * Whether this build, on this device, has an ad surface at all.
 *
 *   VITE_ADS=off   false everywhere — the TestFlight follow-up build and the
 *                  `ios:sync` default. No init, so no consent modal or ATT
 *                  alert; no banner and no reserved strip; no interstitial; and
 *                  the hint video grants without an ad.
 *   VITE_ADS=mock  true on ANY platform, the desktop browser included: the fake
 *                  provider is pure DOM, so `npm run dev:mock` exercises the
 *                  whole flow — strip, cadence, reward granted or withheld, loop
 *                  pause, music — with no device and no network.
 *   otherwise      true only inside the native app.
 */
export function adsSupported(): boolean {
  if (adsOff()) return false
  return adsMock() || Capacitor.isNativePlatform()
}

export function adsRemoved(): boolean {
  return removed
}

/**
 * Unlimited hints — a SEPARATE entitlement from ad removal since the store
 * split into "No ads" ($0.99) and "Unlimited hints + no ads" ($4.99). Only the
 * latter grants this. Gameplay must gate free hints on THIS, never on
 * `adsRemoved()`, or the cheap product would hand out the expensive perk.
 */
export function hintsUnlimited(): boolean {
  return unlimited
}

/** Reflect the persisted unlimited-hints flag into memory at boot (no write). */
export function primeUnlimitedHints(value: boolean): void {
  unlimited = value
}

/** Grant/revoke unlimited hints (after a purchase or restore). Persists. */
export function setUnlimitedHints(value: boolean): void {
  unlimited = value
  void saveUnlimitedHints(value)
  if (value) void removeBanner()
}

/**
 * Reflect the persisted remove-ads flag into memory at boot, before scenes read
 * `adsRemoved()` and before main.ts decides whether to reserve the banner strip.
 * The ONLY boot source of the flag: initAds() deliberately does not re-read it,
 * because initIap() can re-deliver an owned product (setAdsRemoved(true)) while
 * the splash is still up, and a late storage read would overwrite that with the
 * stale value. Does NOT persist (the value came from storage).
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

/** Whether this player should see a banner at all. */
function bannerWanted(): boolean {
  return adsSupported() && !removed && !unlimited
}

/**
 * Whether the player's ad consent lets the network serve anything right now —
 * on LevelPlay, only a GRANTED decision (AdProvider.adsAllowed). A provider
 * with no consent gate (the mock) always allows.
 *
 * Deliberately NOT part of bannerWanted(): bannerReserve() is read at boot,
 * before the consent modal has even been shown, and a reserve that waited for
 * the answer would reflow the whole layout under the player once it came.
 */
function consentAllows(): boolean {
  return provider.adsAllowed?.() ?? true
}

/**
 * Whether the hint modal may offer a rewarded video at all. Read at draw time.
 *
 * TRUE where there is no ad surface (browser dev, an ADS:off build): the hint
 * then takes its free-grant path, so the offer always pays. Otherwise it
 * follows consent. A player who declined — or never answered — has no SDK
 * running, so a "Watch ad" button would fail on every tap, forever, after a
 * modal that promised "no hint videos". A GRANTED decision made later from
 * Privacy choices turns it back on with no further code: the next read says yes.
 *
 * Deliberately NOT "is an ad loaded": no fill is a moment, not a state, and the
 * button's own loading state and toast cover it.
 */
export function rewardedOffered(): boolean {
  if (!adsSupported()) return true
  return consentAllows()
}

/**
 * Design-pixel strip the layout keeps clear at the bottom for the banner, or 0
 * when no banner will ever be requested (no ad surface, No Ads, Unlimited).
 * Intent-based rather than tied to the banner actually arriving, so the FIRST
 * layout already leaves the gap the banner later fills — no overlap, no reflow.
 * main.ts applies it (× DPR) before the scenes lay out; layout.ts adds it on top
 * of the home-indicator inset, which the native banner sits above.
 */
export function bannerReserve(): number {
  return bannerWanted() ? BANNER_RESERVE_DESIGN_PX : 0
}

// --- game-loop hooks -----------------------------------------------------------

/**
 * How to put the game to sleep under a full-screen ad. Registered by main.ts
 * with the Phaser loop's sleep/wake; kept as plain callbacks so this layer (and
 * its tests) never import Phaser.
 *
 * Why pause at all: underneath a full-screen ad the WebView keeps compositing an
 * animated canvas (the beam's spring, confetti), and on real devices that fight
 * for the main thread makes the ad sluggish — KVIZKO saw an ad's own close
 * button stop responding. Sleeping the loop gives the ad the whole device.
 */
export interface GameLoopHooks {
  pause: () => void
  resume: () => void
}

let loopHooks: GameLoopHooks | null = null

export function setGameLoopHooks(hooks: GameLoopHooks | null): void {
  loopHooks = hooks
}

function safely(fn: (() => void) | undefined): void {
  try {
    fn?.()
  } catch {
    // a loop that is not ready must not break the ad flow
  }
}

// --- lifecycle -----------------------------------------------------------------

// The SDK must be up before the FIRST banner request: the plugin refuses a
// createBanner() before initialize() ("LevelPlay is not initialized"), and
// consent can hold init back for as long as the player reads the modal. Parked
// banner requests wait here and are released when initAds() settles either way.
let sdkReady: Promise<void> | null = null
let markSdkReady: (() => void) | null = null

function sdkReadyGate(): Promise<void> {
  sdkReady ??= new Promise<void>((resolve) => {
    markSdkReady = resolve
    // Failsafe: a banner request must never park forever because init stalled.
    // A request released early is simply refused natively and re-asked later.
    setTimeout(resolve, 20_000)
  })
  return sdkReady
}

/**
 * Consent + ATT, then the SDK. Safe to call more than once; main.ts calls it
 * once the splash is gone, because the consent modal and the ATT alert are
 * native views that would otherwise draw over the studio sting.
 *
 * The consent-before-init ORDER lives in the provider and is a legal
 * requirement — see providers/levelplay.ts init().
 */
/**
 * Settles once initAds() has run its course (consent answered, SDK started or
 * failed) — or at once when this player gets no SDK at all. Screens that draw a
 * "Watch ad" button on arrival (the daily gift) wait on it, so a consent modal
 * still on screen does not decide the offer before the player has answered.
 */
let markAdsSettled: () => void = () => {}
let settledFlag = false
const settled = new Promise<void>((resolve) => {
  markAdsSettled = resolve
})
export function adsSettled(): Promise<void> {
  return settled
}

export async function initAds(): Promise<void> {
  try {
    await startAds()
  } finally {
    settledFlag = true
    markAdsSettled()
  }
}

async function startAds(): Promise<void> {
  if (!adsSupported() || initialized) return
  // Unlimited-hints owners can never be shown an ad, so they never start the
  // SDK — and never see a consent modal or an ATT alert for ads they won't get.
  // A No-Ads owner still does: the hint video is a real rewarded ad.
  if (unlimited) return
  initialized = true
  clearsSinceInterstitial = await loadAdClears()
  // Re-ask for the banner whenever the SDK comes up — including LATE: a consent
  // read past its ceiling, a decline reversed from Privacy choices, or an init
  // retry that finally got a network. showBanner() decides whether one is wanted.
  provider.onReady?.(() => void showBanner())
  // A "no" — at boot, or withdrawn from Privacy choices after the SDK is up —
  // takes the banner down now. The SDK cannot be stopped, so this layer keeps
  // the promise the consent modal makes: every later banner, interstitial and
  // hint-video offer reads consentAllows() and stays away for as long as the
  // answer is no.
  provider.onConsentChange?.((granted) => {
    if (!granted) void removeBanner()
  })
  // Read live, so a purchase mid-session stops interstitial loads from then on.
  provider.setInterstitialWanted?.(() => !removed && !unlimited)
  try {
    // ONE-TIME, and BEFORE the first init(): forget any consent record left
    // over from 1.2.0. That build asked through Google's form, which writes IAB
    // TCF keys wherever a GDPR message was live — and the LevelPlay plugin reads
    // those as its own decision, so an EEA player who said yes to Google's
    // partners would start Unity's SDK without ever seeing "Ads and your data".
    // Whether any Exactly 67 install carries them cannot be checked any more
    // (the old ad console is gone), and the reset is free, so every install gets
    // it. Reset first, flag after: a kill between the two only means the modal
    // is asked for once more. See storage.ts.
    // Never from the fake-ads build: the mock provider stores no consent, so its
    // "reset" clears nothing — and saving the flag from it would let a later
    // live build on the same phone skip the one reset that matters.
    if (!adsMock() && !(await loadConsentMigrated())) {
      await provider.resetConsent?.()
      await saveConsentMigrated()
    }
    await provider.init()
  } catch {
    // Init failed (no network, no app key) — later calls guard and no-op. Not
    // final: the provider retries with backoff and on every return to the
    // foreground (adsForegrounded), and onReady above brings the banner with it.
  } finally {
    // Release parked banner requests either way: a failed init must not park
    // them forever.
    void sdkReadyGate()
    markSdkReady?.()
  }
}

/**
 * Called by main.ts on every return to the foreground. For an SDK whose
 * initialize() failed this is the one event that means "the failure reason may
 * be resolved", so it is the one retry not on a timer (the provider owns the
 * timed ones and the guard against two inits at once). It also re-asserts a
 * banner whose first request was refused. Nothing to do before initAds() ran —
 * the splash is still up — or in a build with no ads.
 */
export function adsForegrounded(): void {
  if (!adsSupported() || !initialized) return
  provider.retryInit?.()
  // Not while a full-screen ad is up (its advertiser page can background the
  // app): the ad's own teardown re-shows the banner when it is really over.
  if (fullScreenDepth === 0) void showBanner()
}

/**
 * Re-open the ad-consent decision so the player can change it (the menu's
 * Privacy choices). Scenes talk to the policy layer, never to a network, so
 * this delegates to the provider. A no-op where there is no ad surface.
 */
export async function openPrivacyOptions(): Promise<void> {
  if (!adsSupported()) return
  try {
    await provider.openPrivacyOptions?.()
  } catch {
    // no privacy screen on this provider / not on device
  }
}

// --- banner --------------------------------------------------------------------

let bannerCreated = false
/** In-flight creation, shared by concurrent callers (see showBanner). */
let bannerCreating: Promise<void> | null = null
/**
 * A native banner MAY be attached: set the moment one is requested, cleared
 * only by removeBanner(). Neither flag above can say this. The plugin attaches
 * the banner view to the screen BEFORE it loads and rejects only when the load
 * fails — leaving the view attached, with its delegate, for LevelPlay's own
 * reload to fill later. Keyed on "the promise resolved", a No Ads purchase after
 * such a failure saw nothing to remove, and the paying player kept a live
 * banner for the rest of the session.
 */
let bannerRequested = false

/**
 * Show (or resume) the anchored bottom banner. No-op for owners and where there
 * is no ad surface. Idempotent and self-healing: main.ts asks after init, every
 * level start asks again, and so do a return to the foreground, the SDK coming
 * up late, and the end of every full-screen ad — so one refused request (SDK
 * not up yet, no fill) never costs the session its banner.
 */
export async function showBanner(): Promise<void> {
  if (!bannerWanted()) return
  await sdkReadyGate()
  // Re-check: a purchase can land while we wait. Consent is only asked here,
  // after the gate — before it the modal may not have been answered yet, and a
  // request dropped then would never be re-asked. Without consent the SDK is
  // not up and the plugin would only refuse the request anyway.
  if (!bannerWanted() || !consentAllows()) return
  try {
    // Share one in-flight creation. Several callers can wake in the same tick,
    // and each seeing `bannerCreated === false` would spawn its own native
    // banner view — while removeBanner() only ever tears one down.
    if (bannerCreating) await bannerCreating
    if (!bannerCreated) {
      bannerRequested = true
      bannerCreating = provider.bannerShow()
      await bannerCreating
      bannerCreated = true
      bannerCreating = null
      // Bought (or consent withdrawn) mid-creation: that removeBanner() ran
      // before this banner existed.
      if (!bannerWanted() || !consentAllows()) void removeBanner()
    } else {
      await provider.bannerResume()
    }
  } catch {
    // Refused (SDK not up) or no fill — the reserved strip just stays empty and
    // the next re-ask tries again.
    bannerCreating = null
  }
}

/**
 * Hide the banner, kept alive for a cheap resume — used under full-screen ads.
 * Also after a request that failed to load: its view may still be attached and
 * fill on its own mid-ad (see bannerRequested).
 */
export async function hideBanner(): Promise<void> {
  if (!bannerCreated && !bannerRequested) return
  try {
    await provider.bannerHide()
  } catch {
    // ignore
  }
}

/** Destroy the banner entirely (on a No Ads / Unlimited purchase, or a consent withdrawn). */
export async function removeBanner(): Promise<void> {
  // Nothing ever requested → no plugin call. initIap() re-delivers an owned
  // product on every launch, i.e. setAdsRemoved(true) on the owner's phone
  // before any banner exists; that must not reach the plugin.
  if (!adsSupported() || (!bannerCreated && !bannerCreating && !bannerRequested)) return
  bannerCreated = false
  bannerCreating = null
  bannerRequested = false
  try {
    await provider.bannerRemove()
  } catch {
    // ignore
  }
}

// --- interstitial --------------------------------------------------------------

/** Count one level clear toward the interstitial cadence (call once per win). */
export function noteCleared(): void {
  clearsSinceInterstitial++
  void saveAdClears(clearsSinceInterstitial)
}

/** What else the win card is doing on the clear an interstitial would follow. */
export interface InterstitialContext {
  /** The card offers a rewarded upgrade (Star Jar, pack reward): no interstitial. */
  rewardPrompt?: boolean
  /**
   * The card made another ask on the promise that no ad follows (the reminder
   * offer, the review prompt, the no-ads nudge). That decision is frozen at the
   * win: re-running the gate at the Next tap could otherwise put a full-screen
   * ad right after an ask made because none would come. Counter stays armed.
   */
  cardAsk?: boolean
}

/**
 * The whole interstitial gate, as a *non-consuming* predicate: true only when an
 * ad would fire for this just-cleared level. It is the single source of truth —
 * `maybeShowInterstitial` acts on it, and the win overlay reads it to avoid
 * pairing the rating ask with an ad (`review.ts` mutual-exclusion). A count
 * decides *where* (a natural break); time floor + warm-up + session cap +
 * rewarded-suppression decide *whether*.
 */
export function interstitialWouldShow(clearedGlobal: number, opts: InterstitialContext = {}): boolean {
  if (!adsSupported() || removed || unlimited) return false
  // Never two ad prompts at once: a clear whose win card offers a rewarded
  // upgrade (a full Star Jar, a finished pack) lands ad-free. The counter is not
  // spent, so the break simply moves to the next clear.
  if (opts.rewardPrompt || opts.cardAsk) return false
  // No consent, no interstitial — including one withdrawn mid-session from
  // Privacy choices, after the SDK was already up and still able to serve.
  if (!consentAllows()) return false
  if (clearedGlobal <= ONBOARDING_LEVELS) return false
  // Every pack-complete clear — and the final "The End!" — lands ad-free.
  if (PACK_FINALES.has(clearedGlobal)) return false
  if (adsThisSession >= MAX_ADS_PER_SESSION) return false
  if (clearsSinceInterstitial < clearsPerInterstitial(meta().offers.purchased)) return false
  const now = Date.now()
  // Warm-up: never interrupt the first minute-and-a-half of a session — early
  // sessions are low-intent, and a surprise ad on the first clear of a returning
  // player (the clear counter persists across launches) is the #1 retention hit.
  if ((now - sessionStart) / 1000 < FIRST_AD_MIN_SESSION_SECONDS) return false
  // Spacing floor: never two interstitials back to back, even when someone
  // replays easy levels in quick succession.
  const sinceLast = lastInterstitialAt ? (now - lastInterstitialAt) / 1000 : Infinity
  if (sinceLast < MIN_SECONDS_BETWEEN_ADS) return false
  // Don't double-tax a player who just opted into a rewarded hint.
  if (lastRewardedAt && (now - lastRewardedAt) / 1000 < REWARDED_SUPPRESS_SECONDS) return false
  return true
}

/**
 * Show an interstitial at a natural break (advancing / returning to the map) iff
 * the gate is open, and resolve once the player is FINISHED with it — so the
 * caller navigates only after the ad is dismissed, or at once when none shows.
 * Resolves TRUE only when an ad was actually presented.
 *
 * The cadence is spent only on a presented ad: a no-fill, a refused show or a
 * failed present leaves the counter armed and the time floor unmoved, so the
 * next clear retries.
 */
export async function maybeShowInterstitial(clearedGlobal: number, opts: InterstitialContext = {}): Promise<boolean> {
  if (!interstitialWouldShow(clearedGlobal, opts)) return false
  // Never on top of another full-screen ad (a hint video still closing).
  if (fullScreenDepth > 0) return false
  fullScreenDepth++
  try {
    // The provider answers from its prefetch cache (no tap-time load on
    // LevelPlay), so this normally settles at once; the ceiling only guards a
    // provider that never answers, with every win-card button already locked.
    const loaded = await withTimeout(provider.loadInterstitial(), AD_LOAD_TIMEOUT_MS, false)
    if (!loaded) return false
    return await underFullScreenAd({
      show: () => provider.showInterstitial(),
      onTimeout: false,
      resolvesOnPresent: provider.resolvesOnPresent('interstitial'),
      watch: () => provider.watchDismissal('interstitial', AD_SHOW_TIMEOUT_MS),
      onPresented: () => {
        clearsSinceInterstitial = 0
        void saveAdClears(0)
        lastInterstitialAt = Date.now()
        adsThisSession++
        // Lifetime count, for the quiet "remove ads between levels" nudge.
        updateMeta((m) => ({ ...m, offers: { ...m.offers, interstitials: m.offers.interstitials + 1 } }))
      },
    })
  } finally {
    fullScreenDepth--
  }
}

// --- rewarded ------------------------------------------------------------------

/**
 * How one tap on the hint video ended — what the hint modal needs to tell the
 * player something TRUE about it:
 *
 *   earned       the reward arrived; grant the hint.
 *   unavailable  no video was ever shown: no fill, a load that failed or timed
 *                out, consent not given, or another full-screen ad still up.
 *                "No video available right now" is true of every one of them.
 *   not-earned   a video was handed to the SDK and did not pay out — closed
 *                early, failed to present, or never appeared in time. Saying
 *                "no video available" here would contradict the ad the player
 *                may just have closed.
 */
export type RewardedOutcome = 'earned' | 'unavailable' | 'not-earned'

/**
 * Whether a "Watch ad: …" button may be drawn for `placement` right now: the
 * rewarded offer stands (consent, see rewardedOffered) and today's cap for that
 * placement — and for all placements together — is not spent. Read at draw time.
 */
export function rewardedAvailable(placement: RewardPlacement): boolean {
  // Unlimited is "no ads, forever": never offer one, even in the session the
  // unlock was bought, when the SDK is already up and consent is GRANTED.
  if (unlimited) return false
  return rewardedOffered() && rewardedLeft(meta().adCaps, today(), placement) > 0
}

/**
 * A full-screen ad is loading or on screen, anywhere in the app. A screen that
 * was rebuilt while a video was in flight (its own busy flag reset with it) must
 * read this instead, or a second tap pays twice or reports a false "no video".
 */
export function rewardedBusy(): boolean {
  return fullScreenDepth > 0
}

/**
 * Whether the ad-consent question has been settled for this session (initAds()
 * has run its course). Before that — a brand-new install still on Level 1, whose
 * ads wait for the level to be played — "videos are off because ads were
 * declined" would be false: nobody has been asked yet.
 */
export function adsDecided(): boolean {
  return settledFlag
}

/**
 * Whether a between-level ad can appear for this player at all right now: an ad
 * surface, no ad-removal entitlement, consent that allows it. The quiet "Remove
 * ads between levels" nudge is only true while this is.
 */
export function interstitialsPossible(): boolean {
  return adsSupported() && !removed && !unlimited && consentAllows()
}

/** Rewarded views left today for `placement` (for a true "2 left today"). */
export function rewardedLeftToday(placement: RewardPlacement): number {
  return rewardedLeft(meta().adCaps, today(), placement)
}

/**
 * Show a rewarded video for `placement`, and say how it went (see
 * RewardedOutcome). The caller grants the reward it NAMED on 'earned' and
 * nothing extra otherwise. A reward that paid out spends one of today's views
 * for that placement.
 *
 * Where there is no ad surface (browser dev, an ADS:off build) it is 'earned'
 * without an ad, so every reward flow stays testable; no player can reach that
 * path in a store build.
 */
export async function watchRewarded(placement: RewardPlacement): Promise<RewardedOutcome> {
  if (rewardedLeft(meta().adCaps, today(), placement) <= 0) return 'unavailable'
  const outcome = await playRewarded()
  if (outcome === 'earned') {
    updateMeta((m) => ({ ...m, adCaps: noteRewarded(m.adCaps, today(), placement) }))
  }
  return outcome
}

/** The hint modal's video — one placement among the rest (kept for its callers). */
export async function watchRewardedHint(): Promise<RewardedOutcome> {
  return watchRewarded('hint')
}

async function playRewarded(): Promise<RewardedOutcome> {
  if (!adsSupported()) return 'earned'
  if (unlimited) return 'unavailable'
  // Buttons are not drawn without consent; this is the guard for any path that
  // asks anyway (a consent withdrawn while a card was open).
  if (!rewardedOffered()) return 'unavailable'
  if (fullScreenDepth > 0) return 'unavailable'
  fullScreenDepth++
  try {
    const loaded = await withTimeout(provider.loadRewarded(), AD_LOAD_TIMEOUT_MS, false)
    if (!loaded) return 'unavailable'
    const reward = await underFullScreenAd<unknown | null>({
      show: () => provider.showRewarded(),
      onTimeout: null,
      resolvesOnPresent: false, // settles only when the reward is earned
      watch: () => provider.watchDismissal('rewarded', AD_SHOW_TIMEOUT_MS),
    })
    if (reward == null) return 'not-earned'
    // Record the opt-in so the next interstitial is suppressed for a while.
    lastRewardedAt = Date.now()
    return 'earned'
  } finally {
    fullScreenDepth--
  }
}

/** watchRewardedHint() folded to "was the hint earned" — TRUE only on a reward. */
export async function showRewardedHint(): Promise<boolean> {
  return (await watchRewardedHint()) === 'earned'
}

// --- full-screen plumbing ------------------------------------------------------

/**
 * Race a promise against a deadline. The SDK can hang (no fill, no network, a
 * dropped callback) — and callers hold UI while they await, so a hang would
 * leave the player stuck. Timing out just loses the ad; it never locks the game.
 */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(onTimeout)
    }, ms)
    p.then(
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
        resolve(onTimeout)
      },
    )
  })
}

interface FullScreenAdOptions<T> {
  show: () => Promise<T>
  /** Value to return when nothing useful came back (no fill, skipped, timed out). */
  onTimeout: T
  /**
   * Whether show() settles at PRESENT time rather than when the player is done
   * with the ad: TRUE for interstitials, FALSE for rewarded, whose show()
   * resolves ONLY when the reward is earned. See AdProvider.resolvesOnPresent.
   */
  resolvesOnPresent: boolean
  /** Attached before show() — see AdProvider.watchDismissal. */
  watch: () => DismissWatcher
  /** Called the moment a present-resolving ad is known to be on screen. */
  onPresented?: () => void
}

/**
 * Run a full-screen ad's SHOW step with the rest of the app quieted down, and
 * give everything back afterwards — whether the ad was dismissed, skipped,
 * failed to present, or timed out.
 *
 * Quieted: the Phaser loop sleeps (see setGameLoopHooks), the music bed stops
 * and is HELD down (nothing in the SDK or the plugin ducks game audio; our pad
 * under an ad's soundtrack is the worst audio moment the game can produce, and
 * music.ts would otherwise restart it on the first visibility or focus event
 * that reaches the web view while the ad is still up), and the banner hides so
 * the ad is the only live ad surface.
 *
 * Given back: the loop wakes, the Web Audio context is nudged (a full-screen ad
 * interrupts the iOS AudioContext, and without it every later sound is silent),
 * the hold on the music is released and it restarts (a no-op when the player
 * has it off), the banner returns.
 */
async function underFullScreenAd<T>(opts: FullScreenAdOptions<T>): Promise<T> {
  safely(loopHooks?.pause)
  suppressMusic(true)
  stopMusic()
  let watcher: DismissWatcher | null = null
  try {
    await hideBanner()
    // Subscribe BEFORE showing. Attaching afterwards races the player: a fast
    // tap on the close button fires the dismissal while nothing is listening,
    // and the wait then runs out its whole timeout with the game asleep. Inside
    // the try, so even a watcher that throws gives the game and the music back.
    watcher = opts.watch()
    if (opts.resolvesOnPresent) {
      // show() comes back as soon as the ad is on screen, so it says nothing
      // about when the player is done — the dismissal does.
      const shown = await withTimeout(opts.show(), AD_LOAD_TIMEOUT_MS, opts.onTimeout)
      // Only wait for a dismissal that can actually arrive. When the native side
      // REJECTS the call ("not ready", "no view controller") nothing is presented
      // and LevelPlay emits nothing at all; waiting anyway would park the game on
      // the watcher's 180-second ceiling with the loop, music and input asleep.
      if (shown) {
        opts.onPresented?.()
        await watcher.done
      }
      return shown
    }
    // Rewarded: show() resolves only on a reward earned. A skipped ad is
    // signalled by dismissal alone, so whichever lands first ends the wait.
    // ONE promise, awaited from two places — calling show() twice would present
    // a second ad.
    const showing = withTimeout(opts.show(), AD_SHOW_TIMEOUT_MS, opts.onTimeout)
    return await Promise.race([
      showing,
      // A close arriving first may only mean this adapter reports the close
      // before the reward. Give the reward a moment to land before concluding
      // the player walked away empty-handed.
      watcher.done.then(() => withTimeout(showing, REWARD_AFTER_CLOSE_MS, opts.onTimeout)),
    ])
  } finally {
    // finally, not the happy path: a throw must never leave the game asleep.
    watcher?.cancel()
    safely(loopHooks?.resume)
    resumeAudio()
    // Release BEFORE restarting, or the restart is the one call the hold eats.
    suppressMusic(false)
    startMusic()
    void showBanner() // idempotent: resumes the same banner, never creates a second
  }
}

// --- hint inventory ------------------------------------------------------------
//
// Hints are a persisted, collectable balance: the player earns them (the daily
// gift, the Star Jar, pack and streak rewards, rewarded videos) or buys them, and
// spends them whenever they like. Watching an ad does not reveal a hint on the
// spot — it tops up the stash — so a player can bank them and use them on their
// terms. The daily free hint is no longer granted silently here: it is the
// visible daily gift on the menu (services/progression.ts).

/**
 * Load the hint inventory. Call once at boot (awaited, so the HUD badge is
 * correct on first render).
 */
export async function initHintState(): Promise<void> {
  hintCount = await loadHintCount()
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

/** Spend `n` hints at once (a streak freeze or repair). False, and no change, when short. */
export function spendHints(n: number): boolean {
  const cost = Math.max(0, Math.floor(n))
  if (hintCount < cost) return false
  hintCount -= cost
  void saveHintCount(hintCount)
  return true
}

/** Add one hint to the stash (call after a rewarded video is earned). */
export function grantHint(): void {
  hintCount += 1
  void saveHintCount(hintCount)
}

/** Add several hints at once (call after a hint-pack IAP is purchased). */
export function grantHints(n: number): void {
  if (n <= 0) return
  hintCount += Math.floor(n)
  void saveHintCount(hintCount)
}
