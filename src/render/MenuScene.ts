import Phaser from 'phaser'
import { TOTAL_LEVELS } from '../game/levels'
import { isCleared, totalStars } from '../game/progress'
import { playPlace, setSoundEnabled, soundEnabled } from '../services/audio'
import { hapticsEnabled, placeTap, setHapticsEnabled } from '../services/haptics'
import { progress } from '../services/progressStore'
import { saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { safeArea } from './layout'
import { BG, INK, OUTLINE, PAPER, weightColor } from './palette'
import { ScaleView } from './ScaleView'
import { drawHapticsIcon, drawSoundIcon, makeButton, makeIconButton, TEXT } from './ui'

const INK_SOFT = '#5D5470'

export class MenuScene extends Phaser.Scene {
  private scaleView!: ScaleView

  constructor() {
    super('Menu')
  }

  create() {
    this.cameras.main.setBackgroundColor(BG)
    const w = this.scale.width
    const h = this.scale.height
    const safe = safeArea()

    // Title: "EXACTLY" above a big chunky 67 block.
    const titleY = safe.top + h * 0.11
    this.add.text(w / 2, titleY, 'EXACTLY', TEXT.ink(34, '800')).setOrigin(0.5)

    const blockW = Math.min(w * 0.42, 190)
    const blockH = blockW * 0.72
    const bg = this.add.graphics()
    const { fill, dark } = weightColor(67)
    const bx = w / 2 - blockW / 2
    const by = titleY + 32
    bg.lineStyle(OUTLINE + 2, INK, 1)
    bg.beginPath()
    bg.arc(w / 2, by, blockW * 0.2, Math.PI, 0)
    bg.strokePath()
    bg.fillStyle(INK, 1)
    bg.fillRoundedRect(bx, by + 7, blockW, blockH, blockW * 0.16)
    bg.fillStyle(fill, 1)
    bg.fillRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.lineStyle(OUTLINE + 1, INK, 1)
    bg.strokeRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.fillStyle(dark, 1)
    bg.fillRoundedRect(bx + 6, by + blockH - blockW * 0.14, blockW - 12, blockW * 0.09, blockW * 0.05)
    bg.fillStyle(0xffffff, 0.35)
    bg.fillRoundedRect(bx + blockW * 0.08, by + blockW * 0.06, blockW * 0.4, blockW * 0.09, blockW * 0.05)
    this.add
      .text(w / 2, by + blockH / 2, '67', {
        fontFamily: '"Baloo 2", sans-serif',
        fontSize: `${Math.round(blockH * 0.56)}px`,
        fontStyle: '800',
        color: '#FFF8EA',
      })
      .setOrigin(0.5)

    this.add
      .text(w / 2, by + blockH + 28, 'Balance the scale. Land on exactly 67.', TEXT.ink(16, '600'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)

    // A little live scale, gently weighing — the game's idle heartbeat.
    this.scaleView = new ScaleView(this, {
      cx: w / 2,
      cy: by + blockH + h * 0.17,
      halfBeam: Math.min(w * 0.26, 150),
      ropeLen: h * 0.075,
      panWidth: Math.min(w * 0.2, 110),
      panHeight: Math.min(w * 0.2, 110) * 0.22,
    })
    this.scaleView.setTargetAngle(0)
    this.scaleView.settleImmediately()

    // Continue where the player left off.
    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const started = totalStars(p) > 0

    const playY = h - safe.bottom - h * 0.19
    const play = makeButton(
      this,
      started ? `Play  ·  level ${next}` : 'Play',
      Math.min(w * 0.6, 260),
      64,
      0xf5b942,
      '#2B2440',
      () => this.scene.start('Game', { level: next }),
    )
    play.setPosition(w / 2, playY)

    const levels = makeButton(this, 'Level map', Math.min(w * 0.6, 260), 52, PAPER, '#2B2440', () =>
      this.scene.start('LevelMap', {}),
    )
    levels.setPosition(w / 2, playY + 74)

    // Sound + haptics toggles.
    const size = 46
    const sound = makeIconButton(
      this,
      size,
      (g, s) => drawSoundIcon(g, s, soundEnabled()),
      () => {
        setSoundEnabled(!soundEnabled())
        void saveSoundEnabled(soundEnabled())
        sound.refresh()
        if (soundEnabled()) playPlace()
      },
    )
    sound.setPosition(w / 2 - size * 0.75, playY + 74 + 64)
    const haptics = makeIconButton(
      this,
      size,
      (g, s) => drawHapticsIcon(g, s, hapticsEnabled()),
      () => {
        setHapticsEnabled(!hapticsEnabled())
        void saveHapticsEnabled(hapticsEnabled())
        haptics.refresh()
        if (hapticsEnabled()) placeTap()
      },
    )
    haptics.setPosition(w / 2 + size * 0.75, playY + 74 + 64)
  }

  update(time: number, delta: number) {
    this.scaleView.update(time, delta)
  }
}
