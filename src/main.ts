import './style.css'
import { initSplash } from './splash'
import '@fontsource/baloo-2/500.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/baloo-2/800.css'
import Phaser from 'phaser'
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
  setGameLoopHooks,
  showBanner,
} from './services/ads'
import { stampBuildFlags } from './services/buildFlags'
import { initIap } from './services/iap'
import { primeMusicEnabled, startMusic } from './services/music'
import { initReview } from './services/review'
import { setSoundEnabled } from './services/audio'
import { setHapticsEnabled } from './services/haptics'
import { initProgress } from './services/progressStore'
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

  // The TestFlight "all levels unlocked" marker, when this build has it — the
  // release gate counts it in the bundle (services/buildFlags.ts).
  stampBuildFlags()

  // Canvas text uses the bundled font — wait so first paint is correct.
  await document.fonts.ready.catch(() => {})

  const [, soundOn, hapticsOn, musicOn, adsAlreadyRemoved, storedUnlimited] = await Promise.all([
    initProgress(),
    loadSoundEnabled(),
    loadHapticsEnabled(),
    loadMusicEnabled(MUSIC_ON_BY_DEFAULT),
    loadAdsRemoved(),
    loadUnlimitedHints(),
    // Load the hint stash + grant the daily free hint before the HUD first
    // renders, so the 💡 badge shows the right count immediately.
    initHintState(),
  ])
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
    scene: [MenuScene, LevelMapScene, GameScene, StoreScene],
  })

  window.addEventListener('resize', () => {
    game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR)
  })

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
  void splashGone.then(initAds).then(showBanner)

  // Coming back to the foreground is the one moment a failed SDK start (no
  // network at boot) has a reason to succeed — the ads service retries there and
  // re-asks for a banner a refused request never delivered. No-op before
  // initAds() has run and in builds without ads.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') adsForegrounded()
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

void boot()
