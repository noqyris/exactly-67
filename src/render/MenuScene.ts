import Phaser from 'phaser'
import { TOTAL_LEVELS } from '../game/levels'
import { isCleared, totalStars } from '../game/progress'
import { playPlace, setSoundEnabled, soundEnabled } from '../services/audio'
import { hapticsEnabled, placeTap, setHapticsEnabled } from '../services/haptics'
import { progress } from '../services/progressStore'
import { saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, safeArea, u } from './layout'
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
    const h = this.scale.height
    const f = contentFrame(this.scale.width, h)
    const cx = f.cx
    const safe = safeArea()
    const topAnchor = Math.max(f.oy, safe.top)

    // Title: "EXACTLY" above a big chunky 67 block.
    const titleY = topAnchor + f.eh * 0.09
    this.add.text(cx, titleY, 'EXACTLY', TEXT.ink(34, '800')).setOrigin(0.5)

    const blockW = Math.min(f.ew * 0.42, u(190))
    const blockH = blockW * 0.72
    const bg = this.add.graphics()
    const { fill, dark } = weightColor(67)
    const bx = cx - blockW / 2
    // Leave room above the block for its handle so it clears the title.
    const by = titleY + u(24) + blockW * 0.22
    bg.lineStyle(OUTLINE + u(2), INK, 1)
    bg.beginPath()
    bg.arc(cx, by, blockW * 0.2, Math.PI, 0)
    bg.strokePath()
    bg.fillStyle(INK, 1)
    bg.fillRoundedRect(bx, by + u(7), blockW, blockH, blockW * 0.16)
    bg.fillStyle(fill, 1)
    bg.fillRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.lineStyle(OUTLINE + u(1), INK, 1)
    bg.strokeRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.fillStyle(dark, 1)
    bg.fillRoundedRect(bx + u(6), by + blockH - blockW * 0.14, blockW - u(12), blockW * 0.09, blockW * 0.05)
    bg.fillStyle(0xffffff, 0.35)
    bg.fillRoundedRect(bx + blockW * 0.08, by + blockW * 0.06, blockW * 0.4, blockW * 0.09, blockW * 0.05)
    this.add
      .text(cx, by + blockH / 2, '67', {
        fontFamily: '"Baloo 2", sans-serif',
        fontSize: `${Math.round(blockH * 0.56)}px`,
        fontStyle: '800',
        color: '#FFF8EA',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, by + blockH + u(28), 'Balance the scale. Land on exactly 67.', TEXT.ink(16, '600'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)

    // A little live scale, gently weighing — the game's idle heartbeat.
    this.scaleView = new ScaleView(this, {
      cx: cx,
      cy: by + blockH + f.eh * 0.17,
      halfBeam: Math.min(f.ew * 0.26, u(150)),
      ropeLen: f.eh * 0.075,
      panWidth: Math.min(f.ew * 0.2, u(110)),
      panHeight: Math.min(f.ew * 0.2, u(110)) * 0.22,
    })
    this.scaleView.setTargetAngle(0)
    this.scaleView.settleImmediately()

    // Continue where the player left off.
    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const started = totalStars(p) > 0

    const playY = Math.min(f.oy + f.eh, h - safe.bottom) - f.eh * 0.19
    const play = makeButton(
      this,
      started ? `Play  ·  level ${next}` : 'Play',
      Math.min(f.ew * 0.6, u(260)),
      u(64),
      0xf5b942,
      '#2B2440',
      () => this.scene.start('Game', { level: next }),
    )
    play.setPosition(cx, playY)

    const levels = makeButton(this, 'Level map', Math.min(f.ew * 0.6, u(260)), u(52), PAPER, '#2B2440', () =>
      this.scene.start('LevelMap', {}),
    )
    levels.setPosition(cx, playY + u(74))

    // Sound + haptics toggles.
    const size = u(46)
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
    sound.setPosition(cx - size * 0.75, playY + u(74) + u(64))
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
    haptics.setPosition(cx + size * 0.75, playY + u(74) + u(64))

    // Portrait-locked on device, but dev browsers can resize: rebuild once.
    this.scale.once('resize', () => {
      this.time.delayedCall(60, () => this.scene.restart())
    })
  }

  update(time: number, delta: number) {
    this.scaleView.update(time, delta)
  }
}
