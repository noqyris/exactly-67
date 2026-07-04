import './style.css'
import '@fontsource/baloo-2/500.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/baloo-2/800.css'
import Phaser from 'phaser'
import { GameScene } from './render/GameScene'
import { DPR } from './render/layout'
import { LevelMapScene } from './render/LevelMapScene'
import { MenuScene } from './render/MenuScene'
import { BG_CSS } from './render/palette'
import { setSoundEnabled } from './services/audio'
import { setHapticsEnabled } from './services/haptics'
import { initProgress } from './services/progressStore'
import { loadHapticsEnabled, loadSoundEnabled } from './services/storage'

async function boot() {
  // Canvas text uses the bundled font — wait so first paint is correct.
  await document.fonts.ready.catch(() => {})

  const [, soundOn, hapticsOn] = await Promise.all([
    initProgress(),
    loadSoundEnabled(),
    loadHapticsEnabled(),
  ])
  setSoundEnabled(soundOn)
  setHapticsEnabled(hapticsOn)

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
}

void boot()
