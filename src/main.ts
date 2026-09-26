import './style.css'
import { initSplash } from './splash'
import '@fontsource/baloo-2/500.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/baloo-2/800.css'
import Phaser from 'phaser'
import { DailyScene } from './render/DailyScene'
import { GameScene } from './render/GameScene'
import { DPR, setAdBannerReserve } from './render/layout'
import { LevelMapScene } from './render/LevelMapScene'
import { MenuScene } from './render/MenuScene'
import { BG_CSS } from './render/palette'
import { StoreScene } from './render/StoreScene'
import {
  adsForegrounded,
  bannerReserve,
  initAds,
  initHintState,
  primeAdsRemoved,
  primeUnlimitedHints,
  rewardedBusy,
  setGameLoopHooks,
  showBanner,
  startAdSession,
} from './services/ads'
import { stampBuildFlags } from './services/buildFlags'
import { initIap } from './services/iap'
import { primeMusicEnabled, startMusic } from './services/music'
import { initReview } from './services/review'
import { setSoundEnabled } from './services/audio'
import { setHapticsEnabled } from './services/haptics'
import { initNotifications, noteSessionStart, refreshReminders } from './services/notifications'
import { today } from './services/metaStore'
import { dailyDoneToday, initProgression, isFirstRun, noteReturnSession, refreshDay, syncReminders } from './services/progression'
import { returnIsNewSession, type Pause } from './game/sessions'
import { initProgress } from './services/progressStore'
import {
  isColdLaunchEcho,
  onboardingDone,
  setPendingRoute,
  signalSplashFinished,
  takeColdLaunchRoute,
  type PendingRoute,
} from './services/session'
import {
  loadAdsRemoved,
  loadHapticsEnabled,
  loadMusicEnabled,
  loadSoundEnabled,
  loadUnlimitedHints,
  saveUnlimitedHints,
} from './services/storage'

/**
 * Whether the music bed plays for someone who has never touched the toggle.
 * See docs/AUDIO.md for the reasoning; change it here, not in the storage layer.
 */
const MUSIC_ON_BY_DEFAULT = true

async function boot() {
  // Kick the studio sting off first, before any await: it plays OVER the boot
  // below, so the menu is already built by the time it finishes. The promise
  // settles when it is off the screen — ads wait on it (see below).
  const splashGone = initSplash()
  void splashGone.then(signalSplashFinished)

  // The TestFlight "all levels unlocked" marker, when this build has it — the
  // release gate counts it in the bundle (services/buildFlags.ts).
  stampBuildFlags()

  // Canvas text uses the bundled font — wait so first paint is correct.
  // `document.fonts.ready` alone does not load it: it settles once the fonts the
  // DOM has already asked for are in, and no DOM element uses Baloo — so it
  // resolved at once and every canvas Text drawn before the face happened to
  // arrive stayed in the fallback font for good (seen on a fresh install, whose
  // first scene is Level 1, built earliest of all). Ask for each weight the game
  // draws with, capped so a font that never loads can't hold the boot.
  const faces = ['500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 32px "Baloo 2"`))
  await Promise.race([Promise.all(faces), new Promise((r) => setTimeout(r, 3000))]).catch(() => {})
  await document.fonts.ready.catch(() => {})

  const [, soundOn, hapticsOn, musicOn, adsAlreadyRemoved, storedUnlimited, , coldRoute] = await Promise.all([
    initProgress(),
    loadSoundEnabled(),
    loadHapticsEnabled(),
    loadMusicEnabled(MUSIC_ON_BY_DEFAULT),
    loadAdsRemoved(),
    loadUnlimitedHints(),
    // Load the hint stash + grant the daily free hint before the HUD first
    // renders, so the 💡 badge shows the right count immediately.
    initHintState(),
    // A cold launch from a tapped reminder, saved by the native scene delegate.
    // Read before the scenes exist, so the first menu can act on it.
    takeColdLaunchRoute(),
  ])
  // The meta-game (streak, Star Jar, daily gift, offers) reads progress and the
  // hint stash, so it loads after both. A brand-new install is set up here.
  await initProgression()
  if (coldRoute && !(coldRoute === 'daily' && dailyRouteStale(null))) setPendingRoute(coldRoute)

  setSoundEnabled(soundOn)
  setHapticsEnabled(hapticsOn)
  // Only reflect the flag — starting needs a user gesture (see below).
  primeMusicEnabled(musicOn)

  // Reflect the persisted remove-ads flag into the ads service before scenes
  // read adsRemoved() and before the banner strip is decided below.
  primeAdsRemoved(adsAlreadyRemoved)

  // Unlimited hints used to be bundled into the single $0.99 remove-ads
  // product; it is now its own entitlement ($4.99 tier only). A null here means
  // the key predates that split, so anyone who had already bought the old
  // product keeps the perk they paid for. Write the derived value back so the
  // key is never null again — otherwise a later $0.99 ads-only purchase would
  // be re-read as "legacy owner" on the next launch and hand out unlimited
  // hints for free.
  const unlimited = storedUnlimited ?? adsAlreadyRemoved
  primeUnlimitedHints(unlimited)
  if (storedUnlimited === null) void saveUnlimitedHints(unlimited)

  // Reserve the bottom banner strip before scenes lay out, so the drag area and
  // tray sit above the ad from the very first frame (no reflow jank). Only when
  // a banner will actually be requested: 0 with no ad surface, for No Ads and
  // for Unlimited owners. The banner's height is fixed (LevelPlay 'BANNER',
  // 320×50), so the reserve is exact up front; layout.ts adds it on top of the
  // home-indicator inset the native banner sits above.
  setAdBannerReserve(bannerReserve() * DPR)

  // Size the canvas in physical pixels and display it at CSS size, so
  // vector art and text stay crisp on retina screens. Phaser's RESIZE mode
  // can't do this (it tracks CSS pixels only), so we resize manually.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: BG_CSS,
    banner: false,
    width: window.innerWidth * DPR,
    height: window.innerHeight * DPR,
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / DPR,
    },
    scene: [MenuScene, LevelMapScene, GameScene, StoreScene, DailyScene],
  })

  // Resize: a fold or unfold of the iPhone Duo, a Split View change, a desktop
  // window. WebKit can report a stale innerWidth on the first event of a fold,
  // so re-read the size a frame later and twice more while the animation
  // settles; an unchanged size is skipped, so the scenes rebuild once.
  let lastSize = ''
  const applySize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const key = `${w}x${h}`
    if (key === lastSize) return
    lastSize = key
    game.scale.resize(w * DPR, h * DPR)
  }
  lastSize = `${window.innerWidth}x${window.innerHeight}`
  const onResize = () => {
    requestAnimationFrame(applySize)
    setTimeout(applySize, 150)
    setTimeout(applySize, 400)
  }
  window.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)

  // Let the ad layer put the game to sleep under a full-screen ad and wake it
  // after — the services layer never imports Phaser, so it gets callbacks.
  setGameLoopHooks({
    pause: () => game.loop.sleep(),
    resume: () => game.loop.wake(),
  })

  // Dev-only test bridge for Playwright-driven E2E, plus the capture director
  // that scripts gameplay for marketing video (`?rec=<level>`). Both are
  // dynamically imported behind an `import.meta.env.DEV` guard, so neither is
  // ever part of the production bundle.
  if (import.meta.env.DEV) {
    void import('./dev/testBridge').then((m) => m.installTestBridge(game))
    void import('./dev/capture').then((m) => m.installCapture(game))
  }

  // Ads boot after the game so first paint is never blocked on the network, and
  // after the splash: everything initAds() puts on screen — the consent modal,
  // the ATT alert, then the banner — is a NATIVE view stacked above the web
  // view, so it would draw over the sting rather than be covered by it.
  // `splashGone` always settles (hard timeout), so ads can't be stranded.
  //
  // Unconditional on purpose: the ads service decides who gets what. No ad
  // surface (browser, ADS:off) → nothing; Unlimited owners → no SDK at all; No
  // Ads owners → the SDK (the hint video is a real ad) but never a banner.
  //
  // A brand-new install waits one step more: until Level 1 is played through
  // (session.ts). Two native prompts (ATT, then "Ads and your data") over the
  // first frame of the first level is the worst first impression the game can
  // make; after the first win the player knows what they are consenting for.
  // Consent still comes BEFORE the SDK starts — only the moment moves.
  const onboarding = isFirstRun() ? onboardingDone() : Promise.resolve()
  void splashGone.then(() => onboarding).then(initAds).then(showBanner)

  // Coming back to the foreground is the one moment a failed SDK start (no
  // network at boot) has a reason to succeed — the ads service retries there and
  // re-asks for a banner a refused request never delivered. No-op before
  // initAds() has run and in builds without ads.
  let foregroundDay = today()
  // A return after 30+ minutes away, or into a new day, is a new play session,
  // not only a cold launch (game/sessions.ts): iOS keeps the game suspended for
  // days, and the interstitial session cap and warm-up must reset for a player
  // who never swipes it away. Only the FIRST hidden counts — a second one
  // without a return in between must not move the start of the pause. Nothing
  // here starts the ad layer: this fires while the app may still be inactive,
  // where an ATT request shows nothing.
  let pause: Pause | null = null
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pause ??= { at: Date.now(), day: today() }
      return
    }
    if (document.visibilityState !== 'visible') return
    const newSession = returnIsNewSession(pause, Date.now(), today())
    pause = null
    if (newSession) {
      startAdSession()
      noteReturnSession()
    }
    adsForegrounded()
    // A new local day may have started while the app slept: spend freezes or
    // break the streak now, then re-plan the reminders from the fresh facts.
    refreshDay()
    const day = today()
    if (day !== foregroundDay) {
      foregroundDay = day
      // The calendar draws the day it was built on (the "today" cell, the
      // streak, the freeze and repair offers), so one left open overnight would
      // offer yesterday. Not under a video in flight: an earned reward rebuilds
      // the screen itself. The menu is not restarted here: it rolls over on its
      // own (MenuScene, on the same foreground event) and holds that rebuild
      // while a card is open — a restart from here would wipe a half-claimed gift.
      if (!rewardedBusy() && game.scene.isActive('Daily')) game.scene.getScene('Daily')?.scene.restart({})
    }
    pushReminderFacts()
    noteSessionStart()
    void refreshReminders()
  })

  // Local reminders (no server). The tap listener is registered first thing, so
  // a cold launch from a reminder is not lost; the route waits for a screen
  // that can act on it and never pulls anyone out of a level in progress.
  pushReminderFacts()
  void initNotifications((route: PendingRoute) => {
    // The plugin's copy of the cold-launch tap boot already routed.
    if (isColdLaunchEcho(route)) return
    // Nothing left to send anyone to: kept pending, it would pull the player
    // back onto a solved (or the very same) board the next time the menu shows.
    if (route === 'daily' && dailyRouteStale(game)) return
    const active = game.scene.getScenes(true).map((sc) => sc.scene.key)
    const idle = active.some((k) => k === 'Menu' || k === 'LevelMap' || k === 'Daily')
    // Never tear a screen down under a video still playing (a gift or freeze ad
    // left up when the app went to the background): its reward handler still
    // touches that screen. The route waits for the menu instead.
    if (idle && !active.includes('Game') && !rewardedBusy()) {
      for (const key of active) game.scene.stop(key)
      if (route === 'daily') game.scene.start('Game', { daily: true })
      else if (route === 'menu') game.scene.start('Menu')
      else game.scene.start('LevelMap', {})
    } else {
      setPendingRoute(route)
    }
  })

  // iOS will not let audio start without a user gesture, so the bed can't come
  // up at boot even when the player had it on last session. Arm it on the first
  // touch anywhere. Capture phase on purpose: the splash overlay stops taps from
  // bubbling (it must, or a skip tap would press a menu button), and capture runs
  // before that. No-op while music is off.
  window.addEventListener('pointerdown', () => startMusic(), { once: true, capture: true })

  // IAP boots regardless so a fresh purchase or "Restore purchases" can grant.
  // (Relaunch of an owner is handled by the persisted flags primed above.)
  void initIap()

  // Load the one-shot "already asked for a review" flag so the win overlay can
  // decide whether to request the native rating prompt. Own boot line (not tied
  // to initAds, which is skipped for Unlimited owners).
  void initReview()
}

/** The facts the reminder planner needs: streak, freezes, today's daily, the next level. */
function pushReminderFacts() {
  syncReminders()
}

/**
 * A 'daily' reminder has nowhere left to go: today's daily is solved, or the
 * daily board is on screen right now. `daily` is GameScene's private flag, read
 * defensively — a missing scene or field just means "not showing it".
 */
function dailyRouteStale(game: Phaser.Game | null): boolean {
  if (dailyDoneToday()) return true
  if (!game) return false
  try {
    if (!game.scene.isActive('Game')) return false
    // Today's board, not a past day replayed from the calendar: a "today's 67 is
    // ready" tap during a replay must still lead to today's puzzle.
    const board = game.scene.getScene('Game') as unknown as { daily?: unknown; dailyAsToday?: unknown } | null
    return board?.daily === true && board?.dailyAsToday === true
  } catch {
    return false
  }
}

void boot()
