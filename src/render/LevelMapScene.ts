import Phaser from 'phaser'
import { globalOf, PACKS, TOTAL_LEVELS } from '../game/levels'
import { isUnlocked, starsFor, totalStars } from '../game/progress'
import { progress } from '../services/progressStore'
import { prefersReducedMotion, safeArea } from './layout'
import { BEAM, BG, INK, OUTLINE, PAPER } from './palette'
import { drawBackIcon, drawStar, makeIconButton, TEXT } from './ui'

const INK_SOFT = '#5D5470'

/** Scrollable star/level map: three packs, a button per level. */
export class LevelMapScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container
  private contentHeight = 0
  private scrollY = 0
  private dragStartY = 0
  private dragStartScroll = 0
  private moved = false
  private scrollTo: number | undefined

  constructor() {
    super('LevelMap')
  }

  init(data: { scrollTo?: number }) {
    this.scrollTo = data.scrollTo
  }

  create() {
    this.cameras.main.setBackgroundColor(BG)
    const w = this.scale.width
    const safe = safeArea()
    const top = safe.top + 12

    const back = makeIconButton(this, 46, (g, s) => drawBackIcon(g, s), () => {
      this.scene.start('Menu')
    })
    back.setPosition(Math.max(16, safe.left) + 23, top + 23).setDepth(10)

    this.add
      .text(w / 2, top + 10, 'Levels', TEXT.ink(26, '800'))
      .setOrigin(0.5, 0)
      .setDepth(10)

    // Total-stars chip on the right.
    const starsChip = this.add.container(w - Math.max(16, safe.right) - 54, top + 23).setDepth(10)
    const chipG = this.add.graphics()
    chipG.fillStyle(PAPER, 1)
    chipG.fillRoundedRect(-52, -20, 104, 40, 14)
    chipG.lineStyle(OUTLINE - 1, INK, 1)
    chipG.strokeRoundedRect(-52, -20, 104, 40, 14)
    const starG = this.add.graphics()
    drawStar(starG, -26, 0, 11, true)
    const totals = this.add
      .text(6, 0, `${totalStars(progress())}/${TOTAL_LEVELS * 3}`, TEXT.ink(16))
      .setOrigin(0.5)
    starsChip.add([chipG, starG, totals])

    // Header backdrop so scrolled content slides underneath.
    const headerH = top + 60
    const headerBg = this.add.rectangle(w / 2, headerH / 2, w, headerH, BG).setDepth(5)
    headerBg.setStrokeStyle(0)

    this.content = this.add.container(0, headerH)
    this.buildContent(headerH)
    this.bindScrolling(headerH)

    if (this.scrollTo !== undefined) {
      // Land with the requested level in view.
      const row = Math.floor((this.scrollTo - 1) / 4)
      this.scrollY = Phaser.Math.Clamp(
        -(row * 96 - 120),
        Math.min(0, this.scale.height - headerH - this.contentHeight),
        0,
      )
      this.content.y = headerH + this.scrollY
    }
  }

  private buildContent(headerH: number) {
    const w = this.scale.width
    const safe = safeArea()
    const margin = Math.max(20, safe.left, safe.right)
    const cols = 4
    const gap = 12
    const cell = Math.min(84, (w - margin * 2 - gap * (cols - 1)) / cols)
    const gridW = cell * cols + gap * (cols - 1)
    const startX = (w - gridW) / 2 + cell / 2

    let y = 16
    PACKS.forEach((pack, packIndex) => {
      const name = this.add.text(margin, y, pack.name, TEXT.ink(21, '800'))
      const tagline = this.add
        .text(margin, y + 28, pack.tagline, TEXT.ink(14, '600'))
        .setColor(INK_SOFT)
      this.content.add([name, tagline])
      y += 58

      pack.levels.forEach((_, levelIndex) => {
        const global = globalOf(packIndex, levelIndex)
        const row = Math.floor(levelIndex / cols)
        const col = levelIndex % cols
        const x = startX + col * (cell + gap)
        const cy = y + row * (cell + gap) + cell / 2
        this.content.add(this.levelButton(global, x, cy, cell))
      })
      y += Math.ceil(pack.levels.length / cols) * (cell + gap) + 26
    })

    this.contentHeight = y + safeArea().bottom + 20
    void headerH
  }

  private levelButton(global: number, x: number, y: number, size: number) {
    const p = progress()
    const unlocked = isUnlocked(p, global)
    const stars = starsFor(p, global)
    const current = unlocked && stars === 0

    const c = this.add.container(x, y)
    const g = this.add.graphics()
    const r = size * 0.26
    const fill = !unlocked ? 0xe7ddcb : current ? BEAM : PAPER

    g.fillStyle(INK, unlocked ? 1 : 0.35)
    g.fillRoundedRect(-size / 2, -size / 2 + 4, size, size, r)
    g.fillStyle(fill, 1)
    g.fillRoundedRect(-size / 2, -size / 2, size, size, r)
    g.lineStyle(OUTLINE - 1, INK, unlocked ? 1 : 0.35)
    g.strokeRoundedRect(-size / 2, -size / 2, size, size, r)
    c.add(g)

    if (unlocked) {
      const num = this.add
        .text(0, stars > 0 ? -size * 0.13 : 0, String(global), TEXT.ink(Math.round(size * 0.34), '800'))
        .setOrigin(0.5)
      c.add(num)
      if (stars > 0) {
        const sg = this.add.graphics()
        for (let i = 0; i < 3; i++) {
          drawStar(sg, (i - 1) * size * 0.24, size * 0.24, size * 0.1, i < stars)
        }
        c.add(sg)
      }
      c.setSize(size, size)
      c.setInteractive({ useHandCursor: true })
      c.on('pointerup', () => {
        if (!this.moved) this.scene.start('Game', { level: global })
      })
    } else {
      // Padlock.
      const lg = this.add.graphics()
      lg.lineStyle(3.5, INK, 0.45)
      lg.beginPath()
      lg.arc(0, -size * 0.08, size * 0.11, Math.PI, 0)
      lg.strokePath()
      lg.fillStyle(INK, 0.45)
      lg.fillRoundedRect(-size * 0.15, -size * 0.08, size * 0.3, size * 0.22, size * 0.05)
      c.add(lg)
    }
    return c
  }

  private bindScrolling(headerH: number) {
    const clampScroll = () => {
      const minY = Math.min(0, this.scale.height - headerH - this.contentHeight)
      this.scrollY = Phaser.Math.Clamp(this.scrollY, minY, 0)
      this.content.y = headerH + this.scrollY
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartY = pointer.y
      this.dragStartScroll = this.scrollY
      this.moved = false
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return
      const dy = pointer.y - this.dragStartY
      if (Math.abs(dy) > 8) this.moved = true
      this.scrollY = this.dragStartScroll + dy
      clampScroll()
    })
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.scrollY -= dy * (prefersReducedMotion() ? 1 : 0.9)
        this.moved = true
        clampScroll()
        this.time.delayedCall(50, () => (this.moved = false))
      },
    )
  }
}
