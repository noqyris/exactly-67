/**
 * The seam between "what the app decides" and "who serves the ad".
 *
 * `services/ads` owns the policy — the interstitial cadence, the two
 * entitlements (No Ads, Unlimited hints), the hint economy, pausing the game
 * loop and the music under a full-screen ad. None of that is specific to any
 * network. What IS specific is a small, boring surface: initialise (with
 * whatever consent the network needs), load, show, tell me when the player is
 * done with it, and which unit ids to use.
 *
 * That surface is this file, implemented by `providers/levelplay.ts` (Unity
 * LevelPlay, the real network) and `providers/mock.ts` (our own fake ads, no
 * network at all).
 *
 * Why it exists: Google closed the publisher account on 2026-08-18 and every
 * placement in every app on it went dark at once. Exactly 67's ad code was
 * written straight against that network's plugin, so the migration was a
 * rewrite. Whatever happens to the next network, it should be one new module
 * under `providers/`, not another rewrite of the policy and its callers.
 */

// ── Build modes ──────────────────────────────────────────────────────────────
// One BUILD-time switch decides whether this binary has an ad surface at all:
//
//   VITE_ADS=off   ADS-OFF — the ad layer never initialises, loads or shows
//                  anything; no consent modal and no ATT alert come from the
//                  SDK; the rewarded hint takes its "grant without an ad" path.
//                  The TestFlight follow-up build after an App Store upload is
//                  this one (settled 2026-09-15): TestFlight offers the newest
//                  build first, and on LevelPlay every ADS:on build serves the
//                  REAL waterfall, so only a build that cannot load an ad is
//                  safe on the owner's phone. Also the default of `ios:sync`.
//   VITE_ADS=mock  FAKE ads we draw ourselves in the DOM (providers/mock.ts),
//                  no network touched. Developer testing only; every store
//                  target of the release gate refuses it.
//   anything else  ADS:on — the real provider.
//
// ADMODE (VITE_AD_MODE, providers/levelplay.ts) is a separate question and a
// separate marker: an ads-off build is still an ADMODE:test build. "Which mode
// would this serve in" and "does this build serve anything" are two questions,
// two markers, two gates (scripts/check-ad-mode.mjs).
//
// The functions read the variable at CALL time so a test can vi.stubEnv() them;
// the marker is a module constant so the bundler folds it to exactly one literal.
export function adsOff(): boolean {
  return import.meta.env.VITE_ADS === 'off'
}

/** True in the fake-ads build. Not a network mode — there is no network. */
export function adsMock(): boolean {
  return import.meta.env.VITE_ADS === 'mock'
}

/**
 * Three values, baked once into the bundle and counted by the release gates
 * (`scripts/check-ad-mode.mjs`, `scripts/check-native-sync.mjs`). It rides on
 * each provider's `id`, because a string nothing reads would be minified away;
 * the provider object is imported and used, so the id survives. Nothing else in
 * shipped code may contain these literals — the gates count plain substrings.
 */
export const ADS_MARKER =
  import.meta.env.VITE_ADS === 'off' ? 'ADS:off' : import.meta.env.VITE_ADS === 'mock' ? 'ADS:mock' : 'ADS:on'

/**
 * Design-pixel height the layout keeps clear at the bottom for the banner, on
 * top of the home-indicator inset (layout.ts folds both into safeArea().bottom).
 *
 * Every provider draws a FIXED banner: LevelPlay's `BANNER` size is 320×50 pt,
 * pinned by the plugin to the bottom of the SAFE AREA (LevelPlayAdsImpl.swift,
 * `guide.bottomAnchor`) — i.e. above the home indicator, not over it. So the
 * strip is 50 pt of ad plus 8 pt of air between the ad and the nearest tappable
 * thing: a button flush against an ad is a mis-tap waiting to be counted as a
 * click. A fixed size is the point — an adaptive banner varies by device, and a
 * reserve decided before the first frame could then overlap or leave a gap.
 *
 * Lives here, not in `ads.ts`, because the mock provider draws its fake banner
 * at exactly this height and must not import the policy layer that imports it.
 */
export const BANNER_RESERVE_DESIGN_PX = 58

export type AdFormat = 'banner' | 'interstitial' | 'rewarded'

/** A live subscription to "the ad is finished with", attached BEFORE it shows. */
export interface DismissWatcher {
  done: Promise<void>
  cancel: () => void
}

export interface AdProvider {
  /**
   * For logs and for the build gates: the provider bakes `ADMODE:test|live`
   * and `ADS:on|off|mock` into this string, and the release scripts count them
   * in the bundle — see AD_MODE_MARKER in providers/levelplay.ts and ADS_MARKER
   * above.
   */
  readonly id: string
  /**
   * True when this build serves the network's TEST inventory. Hard-wired false
   * on every provider this app has: LevelPlay has no test inventory, and the
   * mock has no network. Kept on the seam so a future network that genuinely
   * has one can say so — never to light a "safe to tap" badge on LevelPlay.
   */
  readonly testing: boolean

  /** A caller that asks for an unsupported format gets a clean no-op, not a hang. */
  supports(format: AdFormat): boolean

  /** Consent (and ATT) FIRST, then SDK init — see providers/levelplay.ts init(). */
  init(): Promise<void>

  bannerShow(): Promise<void>
  bannerResume(): Promise<void>
  bannerHide(): Promise<void>
  bannerRemove(): Promise<void>

  /** Resolve TRUE when inventory is ready to present, FALSE on no fill. */
  loadInterstitial(): Promise<boolean>
  /** Resolve TRUE once presented (see `resolvesOnPresent`), FALSE if it never appeared. */
  showInterstitial(): Promise<boolean>

  loadRewarded(): Promise<boolean>
  /**
   * The reward when earned. Settles ONLY on the reward (or null on a failed
   * present) — a player who closes the ad early leaves it pending, and the
   * policy layer reads "the dismissal watcher won" as "skipped".
   */
  showRewarded(): Promise<unknown | null>
  /**
   * Optional, synchronous: TRUE while the network holds a rewarded ad ready to
   * present. Read at draw time, so it must not await anything.
   */
  rewardedReady?(): boolean

  /**
   * Optional, synchronous: TRUE while the player's ad consent lets this network
   * serve anything at all — on LevelPlay, only while consent reads GRANTED.
   * Omitted means "no consent gate" (the mock).
   *
   * Read at draw time by the hint modal: a player who declined must not be
   * offered a "Watch ad" button that can never pay out — the SDK never started,
   * so every tap would fail, and the consent modal itself promised "no hint
   * videos". Also read by the interstitial gate and the banner, so a consent
   * withdrawn from Privacy choices mid-session ends every ad surface for the
   * session, as that same modal promises.
   */
  adsAllowed?(): boolean

  /**
   * Optional: call `listener` with the new answer every time the consent
   * decision is recorded — at boot, from the modal, and from Privacy choices.
   * The policy layer tears the banner down on a no; the SDK itself cannot be
   * stopped once it is up.
   */
  onConsentChange?(listener: (granted: boolean) => void): void

  /**
   * Optional: tell a prefetching network whether an interstitial could ever be
   * shown to this player (read each time it would load one). A No-Ads owner
   * starts the SDK for hint videos only, so without this the provider would
   * keep loading interstitials — and retrying misses — for a format the policy
   * layer never presents.
   */
  setInterstitialWanted?(wanted: () => boolean): void

  /**
   * Optional: forget every stored consent decision, so the next init() asks
   * afresh. Never rejects. The policy layer calls it ONCE per install, before
   * the first init(): 1.2.0 asked through Google's form, whose IAB TCF keys (if
   * it wrote any) the LevelPlay plugin would otherwise read as its own decision
   * and skip its modal. See services/ads.ts initAds().
   */
  resetConsent?(): Promise<void>

  /**
   * Optional: try once more to start an SDK whose initialize() failed after
   * consent was granted — no network at boot is the usual reason, and Unity's
   * own guidance is "try and initialize the LevelPlay SDK later". The policy
   * layer calls it on every return to the foreground; the network keeps its
   * own backoff, never runs two inits at once, and does nothing while the SDK
   * is up or consent is not GRANTED.
   */
  retryInit?(): void

  /**
   * Optional: call `listener` every time the SDK comes up — at boot, after a
   * consent decision that arrived late (the modal read slowly, or a decline
   * reversed from Privacy choices), or after an init retry finally succeeded.
   * The policy layer re-asks for the banner here; without it a player whose
   * SDK started late would sit with an empty reserved strip until some other
   * event happened to re-ask.
   */
  onReady?(listener: () => void): void

  /**
   * Optional: re-open the consent decision so the player can change it. GDPR
   * requires withdrawal to be as available as the original consent.
   */
  openPrivacyOptions?(): Promise<void>

  /**
   * Whether `show*()` settles when the ad APPEARS rather than when the player is
   * done with it. True for interstitials, false for rewarded — a difference that
   * decides whether the caller may continue straight after show() or has to
   * wait on the dismissal watcher. Getting it wrong either un-pauses the game
   * under a visible ad or freezes it for the whole show timeout.
   */
  resolvesOnPresent(format: AdFormat): boolean

  /**
   * Subscribe to every terminal event for a format — dismissed, or failed to
   * present at all. Must be attached BEFORE showing: a fast tap on the close
   * button fires the dismissal while nothing is listening.
   */
  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher
}
