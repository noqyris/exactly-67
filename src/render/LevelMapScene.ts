import Phaser from 'phaser'
import { globalOf, PACKS, TOTAL_LEVELS } from '../game/levels'
import { isUnlocked, starsFor, totalStars } from '../game/progress'
import { packInfo } from '../services/progression'
import { allLevelsUnlocked } from '../services/buildFlags'
import { progress } from '../services/progressStore'
import { adBannerReserve, contentFrame, prefersReducedMotion, safeArea, u } from './layout'
import { BEAM, BG, FONT, INK, INK_CSS, OUTLINE, PAPER } from './palette'
import { drawBackIcon, drawMedal, drawStar, makeIconButton, TEXT } from './ui'

const INK_SOFT = '#5D5470'

/**
 * Design points the map's footer backdrop extends above the banner reserve.
 * The reserve already holds 8 pt of air over the 50 pt ad, so this puts the
 * nearest visible (and tappable) tile edge 24 pt above the ad instead of 8.
 */
const FOOTER_GAP = 16

/** Scrollable star/level map: three packs, a button per level. */
export class LevelMapScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container
  private contentHeight = 0
  /**
   * Level tiles are VIRTUALIZED. Building all of them was fine at 72 levels but
   * collapses at 300: each tile is its own Graphics (plus Text), and every
   * Graphics is a separate draw call, which measured 16fps against 121fps on
   * the menu. `slots` holds the precomputed geometry (pure numbers, no
   * GameObjects); only the tiles inside the viewport are ever instantiated.
   */
  private slots: { global: number; x: number; y: number; size: number }[] = []
  private live = new Map<number, Phaser.GameObjects.Container>()
  private headerH = 0
  /** Height of the opaque strip over the ad banner (0 with no banner reserve). */
  private footerH = 0
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
    const f = contentFrame(w, this.scale.height)
    const safe = safeArea()
    const top = Math.max(f.oy, safe.top) + u(12)

    const back = makeIconButton(this, u(46), (g, s) => drawBackIcon(g, s), () => {
      this.scene.start('Menu')
    })
    back.setPosition(f.ox + Math.max(u(16), safe.left) + u(23), top + u(23)).setDepth(10)

    const title = this.add
      .text(f.cx, top + u(10), 'Levels', TEXT.ink(26, '800'))
      .setOrigin(0.5, 0)
      .setDepth(10)
    if (allLevelsUnlocked()) {
      // Unmistakable marker: if this ever shows up in a production build, the
      // wrong build script was used.
      this.add
        .text(f.cx, top + u(40), 'TEST BUILD · all levels unlocked', TEXT.ink(10, '700'))
        .setOrigin(0.5, 0)
        .setColor(INK_SOFT)
        .setDepth(10)
    }

    // Total-stars chip on the right, anchored by its right edge and as wide as
    // its count: a fixed width fit "93/1800" and overflowed from 100 stars on.
    // Left-align the count just right of the star so its point never
    // overlaps the first digit.
    const totals = this.add
      .text(u(36), 0, `${totalStars(progress())}/${TOTAL_LEVELS * 3}`, TEXT.ink(16))
      .setOrigin(0, 0.5)
    const chipRight = f.ox + f.ew - Math.max(u(16), safe.right) - u(2)
    const natural = () => u(36) + totals.width + u(14)
    // On a narrow phone the chip must stop short of the title: there it
    // drops the "/1800" and hugs the count.
    const narrow = chipRight - Math.max(u(104), natural()) < title.x + title.width / 2 + u(8)
    if (narrow) totals.setText(`${totalStars(progress())}`)
    const chipW = narrow ? natural() : Math.max(u(104), natural())
    const starsChip = this.add
      .container(chipRight - chipW, top + u(23))
      .setDepth(10)
    const chipG = this.add.graphics()
    chipG.fillStyle(PAPER, 1)
    chipG.fillRoundedRect(0, -u(20), chipW, u(40), u(14))
    chipG.lineStyle(u(3), INK, 1)
    chipG.strokeRoundedRect(0, -u(20), chipW, u(40), u(14))
    const starG = this.add.graphics()
    drawStar(starG, u(20), 0, u(11), true)
    starsChip.add([chipG, starG, totals])

    // Header backdrop so scrolled content slides underneath. It is
    // interactive so buttons scrolled under it cannot be tapped through it.
    const headerH = top + u(60)
    const headerBg = this.add.rectangle(w / 2, headerH / 2, w, headerH, BG).setDepth(5)
    headerBg.setStrokeStyle(0)
    headerBg.setInteractive()

    this.headerH = headerH

    // Footer backdrop over the banner strip, mirroring the header. The map is
    // the one screen whose tappable tiles SCROLL: without it a tile slides
    // through the reserve's 8 pt of air and under the native banner, so a tap on
    // a half-hidden tile lands a finger right next to the ad. Unity's placement
    // policy forbids ads where fingers land by accident, and accidental clicks
    // are what closed the AdMob account. Opaque so no tile is drawn beside the
    // ad, interactive so a tile under it cannot be tapped through it. With no
    // banner reserve (No ads, Unlimited, no ad surface) there is no footer:
    // tiles scroll under the home indicator like any iOS list, as they always did.
    const footerH = adBannerReserve() > 0 ? safe.bottom + u(FOOTER_GAP) : 0
    this.footerH = footerH
    if (footerH > 0) {
      const footerBg = this.add
        .rectangle(w / 2, this.scale.height - footerH / 2, w, footerH, BG)
        .setDepth(5)
      footerBg.setStrokeStyle(0)
      footerBg.setInteractive()
    }

    // Phaser REUSES the scene instance, so `scrollY` survives leaving the map
    // and coming back. It has to be reset here or it disagrees with the content
    // container, which always starts at the top: the tiles were then
    // instantiated for wherever the player last scrolled and every one of them
    // landed off-screen, so the map looked empty until the first drag resynced
    // it. Harmless before virtualization (all tiles existed regardless), which
    // is why it only surfaced now.
    this.scrollY = 0
    this.content = this.add.container(0, headerH + this.scrollY)
    this.slots = []
    this.live.clear()
    this.buildContent()
    this.bindScrolling(headerH)
    this.syncVisible()

    if (this.scrollTo !== undefined) {
      // Land with the requested level in view. This used to estimate the row as
      // `floor((level - 1) / 4) * u(96)`, which ignores the height of every pack
      // header above it — a rounding error with 3 packs, but it accumulates
      // across 25 and pushed the target off the bottom of the screen. The exact
      // position is already known, so use it and centre the tile.
      const slot = this.slots.find((s) => s.global === this.scrollTo)
      // The visible band is between the header and the footer, not the screen
      // bottom — otherwise a level near the end centres partly under the footer.
      const viewH = this.scale.height - headerH - footerH
      this.scrollY = Phaser.Math.Clamp(
        slot ? -(slot.y - viewH * 0.45) : 0,
        Math.min(0, this.scale.height - headerH - this.contentHeight),
        0,
      )
      this.content.y = headerH + this.scrollY
      this.syncVisible()
    }

    // Portrait-locked on device, but dev browsers can resize: rebuild once.
    this.scale.once('resize', () => {
      this.time.delayedCall(60, () => this.scene.restart({ scrollTo: this.scrollTo }))
    })
  }

  private buildContent() {
    const f = contentFrame(this.scale.width, this.scale.height)
    const safe = safeArea()
    const pad = Math.max(u(20), safe.left, safe.right)
    const margin = f.ox + pad
    const inner = f.ew - pad * 2
    const cols = 4
    const gap = u(12)
    const cell = Math.min(u(88), (inner - gap * (cols - 1)) / cols)
    const gridW = cell * cols + gap * (cols - 1)
    const startX = f.cx - gridW / 2 + cell / 2

    let y = u(16)
    PACKS.forEach((pack, packIndex) => {
      const name = this.add.text(margin, y, pack.name, TEXT.ink(21, '800'))
      const tagline = this.add
        .text(margin, y + u(30), pack.tagline, TEXT.ink(14, '600'))
        .setColor(INK_SOFT)
      // Keep the tagline inside the frame; grow the header if it wraps.
      tagline.setWordWrapWidth(inner - u(96))
      // Pack stars and, once every level is cleared, its medal (bronze, silver
      // at a 2.5★ average, gold at a perfect pack) — a reason to go back for 3★.
      const info = packInfo(packIndex)
      const right = margin + inner
      const badge = this.add.graphics()
      drawMedal(badge, right - u(14), y + u(16), u(28), info.medal)
      drawStar(badge, right - u(84), y + u(16), u(9), info.stars > 0)
      const count = this.add
        .text(right - u(34), y + u(16), `${info.stars}/${info.levels * 3}`, TEXT.ink(14, '800'))
        .setOrigin(1, 0.5)
      badge.setAlpha(info.cleared > 0 ? 1 : 0.5)
      this.content.add([name, tagline, badge, count])
      y += u(30) + tagline.height + u(14)

      pack.levels.forEach((_, levelIndex) => {
        const global = globalOf(packIndex, levelIndex)
        const row = Math.floor(levelIndex / cols)
        const col = levelIndex % cols
        const x = startX + col * (cell + gap)
        const cy = y + row * (cell + gap) + cell / 2
        this.slots.push({ global, x, y: cy, size: cell })
      })
      y += Math.ceil(pack.levels.length / cols) * (cell + gap) + u(26)
    })

    // Pad the scroll end past whatever covers the bottom — the footer backdrop
    // when a banner is reserved, else the home-indicator inset — so the last row
    // can always scroll fully clear of it, never parked half under the footer.
    this.contentHeight = y + Math.max(safe.bottom, this.footerH) + u(20)
  }

  /**
   * Instantiate the tiles now on screen and destroy the ones that left, so the
   * live object count stays proportional to the viewport instead of to 300.
   * The buffer keeps a screen of tiles ready on each side, so a fast flick
   * never reveals empty space before the next sync.
   */
  private syncVisible() {
    const buffer = this.scale.height
    const top = -this.scrollY - buffer
    const bottom = -this.scrollY + (this.scale.height - this.headerH) + buffer

    const wanted = new Set<number>()
    for (const slot of this.slots) {
      if (slot.y + slot.size / 2 < top || slot.y - slot.size / 2 > bottom) continue
      wanted.add(slot.global)
      if (this.live.has(slot.global)) continue
      const btn = this.levelButton(slot.global, slot.x, slot.y, slot.size)
      this.content.add(btn)
      this.live.set(slot.global, btn)
    }
    for (const [global, btn] of this.live) {
      if (wanted.has(global)) continue
      btn.destroy()
      this.live.delete(global)
    }
  }

  private levelButton(global: number, x: number, y: number, size: number) {
    const p = progress()
    // TestFlight builds open everything so a tester can reach level 600 without
    // clearing 599 first. False in any App Store build — see buildFlags.ts.
    const unlocked = allLevelsUnlocked() || isUnlocked(p, global)
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
      // `size` is already in device pixels, so use a raw px font here — going
      // through TEXT.ink() would apply the DPR scale a second time and blow
      // the number up over the stars.
      const hasStars = stars > 0
      const num = this.add
        .text(0, hasStars ? -size * 0.16 : 0, String(global), {
          fontFamily: FONT,
          fontSize: `${Math.round(size * (hasStars ? 0.34 : 0.42))}px`,
          fontStyle: '800',
          color: INK_CSS,
        })
        .setOrigin(0.5)
      c.add(num)
      if (hasStars) {
        const sg = this.add.graphics()
        for (let i = 0; i < 3; i++) {
          drawStar(sg, (i - 1) * size * 0.26, size * 0.31, size * 0.11, i < stars)
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
      lg.lineStyle(u(3.5), INK, 0.45)
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
      this.syncVisible()
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartY = pointer.y
      this.dragStartScroll = this.scrollY
      this.moved = false
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return
      const dy = pointer.y - this.dragStartY
      if (Math.abs(dy) > u(8)) this.moved = true
      this.scrollY = this.dragStartScroll + dy
      clampScroll()
    })
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.scrollY -= u(dy) * (prefersReducedMotion() ? 1 : 0.9)
        this.moved = true
        clampScroll()
        this.time.delayedCall(50, () => (this.moved = false))
      },
    )
  }
}
