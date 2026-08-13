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
  BANNER_RESERVE_DESIGN_PX,
  adsSupported,
  initAds,
  initHintState,
  primeAdsRemoved,
  primeUnlimitedHints,
  setBannerHeightHandler,
  showBanner,
} from './services/ads'
import { initIap } from './services/iap'
import { initReview } from './services/review'
import { setSoundEnabled } from './services/audio'
import { setHapticsEnabled } from './services/haptics'
import { initProgress } from './services/progressStore'
import {
  loadAdsRemoved,
  loadHapticsEnabled,
  loadSoundEnabled,
  loadUnlimitedHints,
  saveUnlimitedHints,
} from './services/storage'

async function boot() {
  // Kick the studio sting off first, before any await: it plays OVER the boot
  // below, so the menu is already built by the time it finishes.
  initSplash()

  // Canvas text uses the bundled font — wait so first paint is correct.
  await document.fonts.ready.catch(() => {})

  const [, soundOn, hapticsOn, adsAlreadyRemoved, storedUnlimited] = await Promise.all([
    initProgress(),
    loadSoundEnabled(),
    loadHapticsEnabled(),
    loadAdsRemoved(),
    loadUnlimitedHints(),
    // Load the hint stash + grant the daily free hint before the HUD first
    // renders, so the 💡 badge shows the right count immediately.
    initHintState(),
  ])
  setSoundEnabled(soundOn)
  setHapticsEnabled(hapticsOn)

  // Reflect the persisted remove-ads flag into the ads service before scenes
  // read adsRemoved() — initAds (which also loads it) is skipped for owners, so
  // without this an owner would see the banner/interstitial + buy button again.
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

  // Reserve the bottom banner strip before scenes lay out, so the drag area
  // and tray sit above the ad from the very first frame (no reflow jank).
  const wantAds = adsSupported() && !adsAlreadyRemoved
  if (wantAds) setAdBannerReserve(BANNER_RESERVE_DESIGN_PX * DPR)

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

  // Dev-only test bridge for Playwright-driven E2E, plus the capture director
  // that scripts gameplay for marketing video (`?rec=<level>`). Both are
  // dynamically imported behind an `import.meta.env.DEV` guard, so neither is
  // ever part of the production bundle.
  if (import.meta.env.DEV) {
    void import('./dev/testBridge').then((m) => m.installTestBridge(game))
    void import('./dev/capture').then((m) => m.installCapture(game))
  }

  // Ads boot after the game so first paint is never blocked on the network.
  // No-ops on web/dev; on device it initializes, collects consent + ATT, then
  // shows the persistent bottom banner in the strip reserved above.
  if (wantAds) {
    // When the banner reports its real height, reserve exactly that and relayout
    // so the tray/UI always clears it (no overlap regardless of ad size).
    setBannerHeightHandler((designPx) => {
      setAdBannerReserve(designPx * DPR)
      game.scale.emit('resize')
    })
    void initAds().then(showBanner)
  }

  // IAP boots regardless so a fresh purchase or "Restore purchases" can grant.
  // (Relaunch of an owner is handled by the persisted flag primed above.)
  void initIap()

  // Load the one-shot "already asked for a review" flag so the win overlay can
  // decide whether to request the native rating prompt. Own boot line (not tied
  // to initAds, which is skipped for Remove-Ads owners).
  void initReview()
}

void boot()
