import './style.css'
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
import { BANNER_RESERVE_DESIGN_PX, adsSupported, initAds, showBanner } from './services/ads'
import { initIap } from './services/iap'
import { setSoundEnabled } from './services/audio'
import { setHapticsEnabled } from './services/haptics'
import { initProgress } from './services/progressStore'
import { loadAdsRemoved, loadHapticsEnabled, loadSoundEnabled } from './services/storage'

async function boot() {
  // Canvas text uses the bundled font — wait so first paint is correct.
  await document.fonts.ready.catch(() => {})

  const [, soundOn, hapticsOn, adsAlreadyRemoved] = await Promise.all([
    initProgress(),
    loadSoundEnabled(),
    loadHapticsEnabled(),
    loadAdsRemoved(),
  ])
  setSoundEnabled(soundOn)
  setHapticsEnabled(hapticsOn)

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
    scene: [MenuScene, LevelMapScene, GameScene],
  })

  window.addEventListener('resize', () => {
    game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR)
  })

  // Ads boot after the game so first paint is never blocked on the network.
  // No-ops on web/dev; on device it initializes, collects consent + ATT, then
  // shows the persistent bottom banner in the strip reserved above.
  if (wantAds) void initAds().then(showBanner)

  // IAP boots regardless (also on already-removed installs) so "Remove Ads"
  // ownership is reconciled — e.g. a restore after reinstall clears the banner.
  void initIap()
}

void boot()
