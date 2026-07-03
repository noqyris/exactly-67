import './style.css'
import '@fontsource/baloo-2/500.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/baloo-2/800.css'
import Phaser from 'phaser'

async function boot() {
  // Canvas text uses the bundled font — wait so first paint is correct.
  await document.fonts.ready.catch(() => {})

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#F6EEDF',
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [],
  })
}

void boot()
