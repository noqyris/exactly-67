import Phaser from 'phaser'
import { globalOf, PACKS, TOTAL_LEVELS } from '../game/levels'
import { cellState, nextLevel, packIndexOf, packLocked, packUnlockLevel } from '../game/journey'
import type { CellState } from '../game/journey'
import { starsFor, totalStars } from '../game/progress'
import { cellSlot, cellX, columnsFor, fullDrawerH, rowReveal, shelfLayout } from '../game/shelfLayout'
import type { ShelfGeometry, ShelfMetrics } from '../game/shelfLayout'
import { allLevelsUnlocked } from '../services/buildFlags'
import { packInfo } from '../services/progression'
import { progress } from '../services/progressStore'
import { adBannerReserve, contentFrame, prefersReducedMotion, safeArea, u } from './layout'
import { BEAM, BG, FONT, INK, INK_CSS, OUTLINE, PAPER } from './palette'
import { drawBackIcon, drawMedal, drawProgressBar, drawStar, makeIconButton, TEXT } from './ui'

const INK_SOFT = '#5D5470'

/**
 * Design points the map's footer backdrop extends above the banner reserve.
 * The reserve already holds 8 pt of air over the 50 pt ad, so this puts the
 * nearest visible (and tappable) tile edge 24 pt above the ad instead of 8.
 */
const FOOTER_GAP = 16

/** Pack sizes in order: what the shelf geometry and the level → pack lookup read. */
const PACK_SIZES: readonly number[] = PACKS.map((p) => p.levels.length)

/** Card fill for the pack the player is working through: the Daily card's warm cream. */
const CURRENT_FILL = 0xfff1c7
/** The open drawer under a card: the calendar's "missed day" beige, a step below the cream. */
const DRAWER_FILL = 0xefe6d6
/** Pack progress, the menu's green. */
const PACK_BAR = 0x69db7c
/** The card's slab under its face; the face drops onto it while pressed. */
const CARD_DROP = 5
/** Drawer open/close, ms: the cards below ride its edge. */
const DRAWER_MS = 300
/** A locked pack's card. */
const LOCKED_ALPHA = 0.55

interface CardView {
  c: Phaser.GameObjects.Container
  drawer: Phaser.GameObjects.Graphics
  chevron: Phaser.GameObjects.Graphics
  /** Drawer height last drawn, so a frame without a change redraws nothing. */
  drawn: number
}

/**
 * The level map as pack shelves: one card per pack (its medal, name, tagline,
 * cleared/stars progress), each opening a drawer of its 24 level cells. The
 * pack holding the player's next level opens on arrival and is scrolled into
 * view, so the map reads as a journey instead of 600 cells, 95% of them locked.
 */
export class LevelMapScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container
  /** Cards (with their drawers) under the cells, whatever order they are built in. */
  private cardLayer!: Phaser.GameObjects.Container
  private cellLayer!: Phaser.GameObjects.Container
  private contentHeight = 0
  /**
   * Cards and cells are VIRTUALIZED. Building every level tile was fine at 72
   * levels but collapsed at 300: each tile is its own Graphics (plus Text), and
   * every Graphics is a separate draw call, which measured 16fps against 121fps
   * on the menu. The geometry is pure numbers (game/shelfLayout.ts); only what
   * lies within a screen of the viewport is ever instantiated.
   */
  private liveCards = new Map<number, CardView>()
  private liveCells = new Map<number, Phaser.GameObjects.Container>()
  private metrics!: ShelfMetrics
  private geo!: ShelfGeometry
  private cardX = 0
  private cardW = 0
  /** Centre x of every drawer's grid. */
  private gridCx = 0
  /** How far each pack's drawer is open now (0–1); `expanded` is where it is heading. */
  private open: number[] = []
  private expanded: boolean[] = []
  /** Reduced motion: an opened drawer's cells fade in (≤150 ms) instead of sliding. */
  private fade: number[] = []
  private drawerTweens = new Map<number, Phaser.Tweens.Tween>()
  private next = 1
  private currentPack = 0
  private headerH = 0
  /** Height of the opaque strip over the ad banner (0 with no banner reserve). */
  private footerH = 0
  private scrollY = 0
  private dragStartY = 0
  private dragStartScroll = 0
  private moved = false
  /** Pops a pressed card back up when its press turns into a scroll. */
  private unpress: (() => void) | null = null
  private scrollTo: number | undefined
  private openAtStart: number[] | undefined

  constructor() {
    super('LevelMap')
  }

  init(data: { scrollTo?: number; open?: number[] }) {
    this.scrollTo = data.scrollTo
    this.openAtStart = data.open
  }

  create() {
    this.cameras.main.setBackgroundColor(BG)
    const w = this.scale.width
    const h = this.scale.height
    const f = contentFrame(w, h)
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
        .rectangle(w / 2, h - footerH / 2, w, footerH, BG)
        .setDepth(5)
      footerBg.setStrokeStyle(0)
      footerBg.setInteractive()
    }

    // Phaser REUSES the scene instance, so every field survives leaving the map
    // and coming back. `scrollY` especially has to be reset here or it disagrees
    // with the content container, which always starts at the top: the tiles were
    // then instantiated for wherever the player last scrolled and every one of
    // them landed off-screen, so the map looked empty until the first drag.
    this.scrollY = 0
    this.moved = false
    this.unpress = null
    this.content = this.add.container(0, headerH + this.scrollY)
    this.cardLayer = this.add.container(0, 0)
    this.cellLayer = this.add.container(0, 0)
    this.content.add([this.cardLayer, this.cellLayer])
    this.liveCards.clear()
    this.liveCells.clear()
    this.drawerTweens.clear()

    // The pack holding the next level opens on arrival, and so does the one
    // holding the level just played (they differ after a pack's last level).
    const p = progress()
    this.next = nextLevel(p, TOTAL_LEVELS)
    this.currentPack = packIndexOf(PACK_SIZES, this.next)
    const opened = new Set(this.openAtStart ?? [this.currentPack])
    if (this.scrollTo !== undefined) opened.add(packIndexOf(PACK_SIZES, this.scrollTo))
    this.expanded = PACK_SIZES.map((_, i) => opened.has(i))
    this.open = this.expanded.map((on) => (on ? 1 : 0))
    this.fade = PACK_SIZES.map(() => 1)

    this.measure()
    this.geo = shelfLayout(PACK_SIZES, this.open, this.metrics)
    this.updateContentHeight()
    this.bindScrolling()

    // Land with the level in view: the one just played, centred (the old
    // `scrollTo` contract), else the current pack's card at the top — or, when
    // that would leave the next level below the fold, that level centred.
    const viewH = this.viewH()
    let target: number
    const playedY = this.scrollTo !== undefined ? this.cellCentreY(this.scrollTo) : null
    if (playedY !== null) {
      target = -(playedY - viewH * 0.45)
    } else {
      target = -(this.geo.cardTop[this.currentPack] - u(12))
      const nextY = this.cellCentreY(this.next)
      if (nextY !== null && nextY + this.metrics.cell / 2 + target > viewH - u(12)) target = -(nextY - viewH * 0.5)
    }
    this.scrollY = target
    this.applyScroll()

    // Portrait-locked on device, but a fold, Split View or a dev browser can
    // resize: rebuild once it settles, keeping the open drawers. Removed on
    // shutdown — a listener left on the scale manager restarted the map from
    // whatever screen the player was on by then.
    let pending: Phaser.Time.TimerEvent | null = null
    const onResize = () => {
      pending?.remove()
      pending = this.time.delayedCall(150, () =>
        this.scene.restart({ scrollTo: this.scrollTo, open: this.expanded.flatMap((on, i) => (on ? [i] : [])) }),
      )
    }
    this.scale.on('resize', onResize)
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize)
      this.drawerTweens.forEach((t) => t.stop())
      this.drawerTweens.clear()
    })
  }

  /** The scrolling band between the header and the footer (or the screen's bottom). */
  private viewH(): number {
    return this.scale.height - this.headerH - this.footerH
  }

  /** A press or release inside the visible band, not under the header or the footer. */
  private inBand(y: number): boolean {
    return y > this.headerH && y < this.scale.height - this.footerH
  }

  private measure() {
    const f = contentFrame(this.scale.width, this.scale.height)
    // contentFrame already sits between the side insets: the card is the frame
    // less 16 pt each side.
    this.cardX = f.ox + u(16)
    this.cardW = f.ew - u(32)
    this.gridCx = this.cardX + this.cardW / 2
    const inset = u(8) // the drawer is a little narrower than its card
    const padX = u(10)
    const gap = u(10)
    const inner = this.cardW - 2 * inset - 2 * padX
    const cols = columnsFor(inner, gap, u(64))
    const cell = Math.floor(Math.min(u(88), (inner - gap * (cols - 1)) / cols))
    this.metrics = {
      top: u(14),
      cardH: u(112),
      cardGap: u(14),
      padTop: u(18),
      padBottom: u(18),
      cell,
      cellGap: gap,
      cols,
      revealFade: u(24),
    }
  }

  private updateContentHeight() {
    // Pad the scroll end past whatever covers the bottom — the footer backdrop
    // when a banner is reserved, else the home-indicator inset — so the last
    // shelf can always scroll fully clear of it, never parked half under it.
    this.contentHeight = this.geo.bottom + Math.max(safeArea().bottom, this.footerH) + u(20)
  }

  private minScroll(): number {
    return Math.min(0, this.scale.height - this.headerH - this.contentHeight)
  }

  private applyScroll() {
    this.scrollY = Phaser.Math.Clamp(this.scrollY, this.minScroll(), 0)
    this.content.y = this.headerH + this.scrollY
    this.syncVisible()
  }

  /** A level's cell centre in content coordinates, or null while its drawer is shut. */
  private cellCentreY(global: number): number | null {
    const pack = packIndexOf(PACK_SIZES, global)
    if (this.open[pack] <= 0) return null
    const slot = cellSlot(global - globalOf(pack, 0), this.metrics)
    return this.geo.cardTop[pack] + this.metrics.cardH + slot.dy
  }

  /**
   * Instantiate the cards and cells now near the screen, place every live one,
   * and destroy the ones that left — the live object count stays proportional
   * to the viewport. The buffer keeps a screen ready on each side, so a fast
   * flick never reveals empty space before the next sync.
   */
  private syncVisible() {
    const m = this.metrics
    const buffer = this.scale.height
    const top = -this.scrollY - buffer
    const bottom = -this.scrollY + (this.scale.height - this.headerH) + buffer
    const p = progress()
    const unlockAll = allLevelsUnlocked()

    const wantedCells = new Set<number>()
    PACK_SIZES.forEach((count, i) => {
      const cardTop = this.geo.cardTop[i]
      const drawerH = this.geo.drawerH[i]
      const near = cardTop + m.cardH + drawerH >= top && cardTop <= bottom
      let card = this.liveCards.get(i)
      if (!near) {
        if (card) {
          card.c.destroy()
          this.liveCards.delete(i)
        }
        return
      }
      if (!card) {
        card = this.buildCard(i)
        this.liveCards.set(i, card)
      }
      this.placeCard(card, i)
      if (drawerH <= 0) return

      const first = globalOf(i, 0)
      for (let li = 0; li < count; li++) {
        const slot = cellSlot(li, m)
        const y = cardTop + m.cardH + slot.dy
        const reveal = rowReveal(slot.row, drawerH, m) * this.fade[i]
        if (reveal <= 0 || y + m.cell / 2 < top || y - m.cell / 2 > bottom) continue
        const global = first + li
        wantedCells.add(global)
        let cell = this.liveCells.get(global)
        if (!cell) {
          cell = this.levelCell(global, m.cell, cellState(p, global, unlockAll))
          this.cellLayer.add(cell)
          this.liveCells.set(global, cell)
        }
        cell.setPosition(cellX(slot.col, this.gridCx, m), y).setAlpha(reveal)
      }
    })
    for (const [global, cell] of this.liveCells) {
      if (wantedCells.has(global)) continue
      cell.destroy()
      this.liveCells.delete(global)
    }
  }

  private placeCard(card: CardView, i: number) {
    const m = this.metrics
    card.c.y = this.geo.cardTop[i] + m.cardH / 2
    card.chevron.setAngle(180 * this.open[i])
    const dh = this.geo.drawerH[i]
    if (Math.abs(dh - card.drawn) < 0.5) return
    card.drawn = dh
    const g = card.drawer
    g.clear()
    if (dh < u(2)) return
    // Tucked under the card's bottom edge, so it reads as pulled out from under it.
    const inset = u(8)
    const tuck = u(22)
    const x = -this.cardW / 2 + inset
    const y = m.cardH / 2 - tuck
    const hh = dh + tuck
    const r = Math.min(u(18), hh / 2)
    g.fillStyle(DRAWER_FILL, 1)
    g.fillRoundedRect(x, y, this.cardW - 2 * inset, hh, r)
    g.lineStyle(u(2.5), INK, 0.22)
    g.strokeRoundedRect(x, y, this.cardW - 2 * inset, hh, r)
  }

  /** One pack card: medal, name, tagline, and its progress (or what opens it). */
  private buildCard(i: number): CardView {
    const m = this.metrics
    const pack = PACKS[i]
    const count = PACK_SIZES[i]
    const first = globalOf(i, 0)
    const info = packInfo(i)
    const locked = packLocked(progress(), first, count, allLevelsUnlocked())
    const cw = this.cardW
    const ch = m.cardH
    const r = u(22)

    // A locked card reads at 0.55 alpha. Not as one container alpha: the slab
    // would show through the half-clear face and grey the whole card. The face
    // stays opaque in the colour PAPER takes at 0.55 over the background, and
    // everything on it (and the slab's visible lip, the outline) is drawn at 0.55.
    const a = locked ? LOCKED_ALPHA : 1
    const c = this.add.container(this.cardX + cw / 2, 0)
    const drawer = this.add.graphics()
    const slab = this.add.graphics()
    slab.fillStyle(INK, a)
    slab.fillRoundedRect(-cw / 2, -ch / 2 + u(CARD_DROP), cw, ch, r)
    const face = this.add.container(0, 0)
    const bg = this.add.graphics()
    bg.fillStyle(locked ? mix(PAPER, BG, a) : i === this.currentPack ? CURRENT_FILL : PAPER, 1)
    bg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, r)
    bg.lineStyle(OUTLINE, INK, a)
    bg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, r)
    const g = this.add.graphics()

    // The medal, its disc centred on the card (the ribbon rises above it); an
    // empty ring until the pack is finished.
    const pad = u(16)
    const medal = u(44)
    drawMedal(g, -cw / 2 + pad + medal / 2, -medal * 0.12, medal, locked ? null : info.medal)

    const textX = -cw / 2 + pad + medal + u(14)
    const right = cw / 2 - pad
    const name = this.add.text(textX, 0, pack.name, TEXT.ink(20, '800')).setOrigin(0, 0.5)
    fitWidth(name, right - u(26) - textX)
    const tagline = this.add
      .text(textX, 0, pack.tagline, TEXT.ink(13, '600'))
      .setOrigin(0, 0)
      .setColor(INK_SOFT)
      .setWordWrapWidth(right - textX)
    // Two lines at most (a 320 pt phone); a longer one shrinks rather than spill.
    const lineH = this.add.text(0, 0, 'Ag', TEXT.ink(13, '600'))
    const maxTag = lineH.height * 2
    lineH.destroy()
    if (tagline.height > maxTag + 1) tagline.setScale(maxTag / tagline.height)

    // Name, tagline and the progress row, centred as a block in the card. A
    // Text's box is about its font size tall in Baloo 2, so the gaps are air.
    const rowH = u(16)
    const tagH = tagline.displayHeight
    const blockH = name.displayHeight + u(6) + tagH + u(12) + rowH
    let y = -blockH / 2
    name.setY(y + name.displayHeight / 2)
    y += name.displayHeight + u(6)
    tagline.setY(y)
    y += tagH + u(12)
    const rowY = y + rowH / 2

    const chevron = this.add.graphics()
    chevron.lineStyle(u(3), INK, 1)
    chevron.beginPath()
    chevron.moveTo(-u(6), -u(3))
    chevron.lineTo(0, u(3))
    chevron.lineTo(u(6), -u(3))
    chevron.strokePath()
    chevron.setPosition(right - u(7), name.y)

    const kids: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.AlphaSingle)[] = [g, name, tagline, chevron]
    if (locked) {
      const lock = this.add.graphics()
      drawPadlock(lock, textX + u(6), rowY, u(14))
      const opens = this.add
        .text(textX + u(18), rowY, `Clear Level ${packUnlockLevel(first)} to open`, TEXT.ink(13, '700'))
        .setOrigin(0, 0.5)
        .setColor(INK_SOFT)
      fitWidth(opens, right - opens.x)
      kids.push(lock, opens)
    } else {
      // "18/24 · 52/72★": levels cleared, then stars; the star is drawn, not a glyph.
      const starR = u(7)
      const label = this.add
        .text(right - starR * 2 - u(4), rowY, `${info.cleared}/${info.levels} · ${info.stars}/${info.levels * 3}`, TEXT.ink(13, '800'))
        .setOrigin(1, 0.5)
      drawStar(g, right - starR, rowY, starR, info.stars > 0)
      const barRight = label.x - label.width - u(10)
      drawProgressBar(g, textX, rowY - u(6), Math.max(u(24), barRight - textX), u(12), info.cleared / info.levels, PACK_BAR)
      kids.push(label)
    }
    if (locked) kids.forEach((k) => k.setAlpha(a))
    face.add([bg, ...kids])
    c.add([drawer, slab, face])

    c.setSize(cw, ch)
    c.setInteractive({ useHandCursor: true })
    this.bandTap(c, () => this.toggle(i), (down) => (face.y = down ? u(CARD_DROP) : 0))
    this.cardLayer.add(c)
    return { c, drawer, chevron, drawn: 0 }
  }

  /** Open or shut a pack's drawer; the cards below follow its edge. */
  private toggle(i: number) {
    this.expanded[i] = !this.expanded[i]
    const to = this.expanded[i] ? 1 : 0
    this.drawerTweens.get(i)?.stop()
    this.drawerTweens.delete(i)
    const m = this.metrics
    // Opening one near the bottom brings its drawer into view — never past its
    // own card's top.
    const scrollFor = () => {
      const shelfBottom = this.geo.cardTop[i] + m.cardH + fullDrawerH(PACK_SIZES[i], m) + u(12)
      const cardTop = this.geo.cardTop[i] - u(12)
      const need = this.viewH() - shelfBottom
      return Math.max(Math.min(this.scrollY, need), -cardTop)
    }
    if (prefersReducedMotion()) {
      // No sliding: the drawer is there at once and its cells fade in.
      this.open[i] = to
      this.relayout()
      if (to === 1) {
        this.scrollY = Math.min(this.scrollY, scrollFor())
        this.fade[i] = 0
        const proxy = { a: 0 }
        const tw = this.tweens.add({
          targets: proxy,
          a: 1,
          duration: 150,
          onUpdate: () => {
            this.fade[i] = proxy.a
            this.syncVisible()
          },
          onComplete: () => this.drawerTweens.delete(i),
        })
        this.drawerTweens.set(i, tw)
      }
      this.applyScroll()
      return
    }
    this.fade[i] = 1
    const from = this.open[i]
    const startScroll = this.scrollY
    // The scroll target is where the shelf ends once fully open; worked out up front.
    const endScroll = to === 1 ? Math.min(startScroll, this.scrollTarget(i, scrollFor)) : startScroll
    const proxy = { t: 0 }
    const tw = this.tweens.add({
      targets: proxy,
      t: 1,
      duration: DRAWER_MS * Math.max(0.4, Math.abs(to - from)),
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.open[i] = from + (to - from) * proxy.t
        this.scrollY = startScroll + (endScroll - startScroll) * proxy.t
        this.relayout()
      },
      onComplete: () => this.drawerTweens.delete(i),
    })
    this.drawerTweens.set(i, tw)
  }

  /** `scrollFor` evaluated with drawer `i` fully open (the layout it is heading to). */
  private scrollTarget(i: number, scrollFor: () => number): number {
    const was = this.open[i]
    this.open[i] = 1
    this.geo = shelfLayout(PACK_SIZES, this.open, this.metrics)
    const s = scrollFor()
    this.open[i] = was
    this.geo = shelfLayout(PACK_SIZES, this.open, this.metrics)
    return s
  }

  private relayout() {
    this.geo = shelfLayout(PACK_SIZES, this.open, this.metrics)
    this.updateContentHeight()
    this.applyScroll()
  }

  /** One level cell: today's look for cleared and open levels; a dimmed number for the road ahead. */
  private levelCell(global: number, size: number, state: CellState) {
    const c = this.add.container(0, 0)
    const g = this.add.graphics()
    const r = size * 0.26
    const ahead = state === 'locked' || state === 'next'
    // The very next level to open reads a step nearer than the rest of the road.
    const a = state === 'locked' ? 0.35 : state === 'next' ? 0.6 : 1
    const fill = ahead ? 0xe7ddcb : state === 'open' ? BEAM : PAPER

    g.fillStyle(INK, a)
    g.fillRoundedRect(-size / 2, -size / 2 + 4, size, size, r)
    g.fillStyle(fill, 1)
    g.fillRoundedRect(-size / 2, -size / 2, size, size, r)
    g.lineStyle(OUTLINE - 1, INK, a)
    g.strokeRoundedRect(-size / 2, -size / 2, size, size, r)
    c.add(g)

    // `size` is already in device pixels, so use a raw px font here — going
    // through TEXT.ink() would apply the DPR scale a second time and blow the
    // number up over the stars.
    const stars = state === 'cleared' ? starsFor(progress(), global) : 0
    const num = this.add
      .text(0, stars > 0 ? -size * 0.16 : 0, String(global), {
        fontFamily: FONT,
        fontSize: `${Math.round(size * (stars > 0 ? 0.34 : 0.42))}px`,
        fontStyle: '800',
        color: INK_CSS,
      })
      .setOrigin(0.5)
      .setAlpha(a)
    c.add(num)
    if (stars > 0) {
      const sg = this.add.graphics()
      for (let i = 0; i < 3; i++) {
        drawStar(sg, (i - 1) * size * 0.26, size * 0.31, size * 0.11, i < stars)
      }
      c.add(sg)
    }
    if (!ahead) {
      c.setSize(size, size)
      c.setInteractive({ useHandCursor: true })
      this.bandTap(c, () => this.scene.start('Game', { level: global }))
    }
    return c
  }

  /**
   * Fire on a press AND a release on `obj`, both inside the visible band, never
   * at the end of a scroll. A bare `pointerup` fired for a finger that went down
   * anywhere — on the header, on the footer over the ad banner — and merely
   * lifted over a cell, and a cell scrolled half under the header or the footer
   * took the tap on its hidden part.
   */
  private bandTap(obj: Phaser.GameObjects.Container, fire: () => void, press?: (down: boolean) => void) {
    let armed = false
    const release = () => {
      if (armed) press?.(false)
      armed = false
    }
    obj.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      armed = this.inBand(pointer.y)
      if (!armed) return
      press?.(true)
      this.unpress = release
    })
    obj.on('pointerout', release)
    obj.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const was = armed
      release()
      if (!was || this.moved || !this.inBand(pointer.y)) return
      fire()
    })
  }

  private bindScrolling() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartY = pointer.y
      this.dragStartScroll = this.scrollY
      this.moved = false
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return
      const dy = pointer.y - this.dragStartY
      if (Math.abs(dy) > u(8) && !this.moved) {
        this.moved = true
        this.unpress?.()
        this.unpress = null
      }
      this.scrollY = this.dragStartScroll + dy
      this.applyScroll()
    })
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scrollY -= u(dy) * (prefersReducedMotion() ? 1 : 0.9)
      this.moved = true
      this.applyScroll()
      this.time.delayedCall(50, () => (this.moved = false))
    })
  }
}

/** `fg` drawn at `alpha` over `bg`, as one opaque colour. */
function mix(fg: number, bg: number, alpha: number): number {
  const ch = (shift: number) => {
    const f = (fg >> shift) & 0xff
    const b = (bg >> shift) & 0xff
    return Math.round(f * alpha + b * (1 - alpha)) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

/** Shrink `t` to `room` px wide when it is wider (a 320 pt phone, a long name). */
function fitWidth(t: Phaser.GameObjects.Text, room: number): void {
  if (room > 0 && t.width > room) t.setScale(room / t.width)
}

/** A small padlock centred on (cx, cy), `size` tall. */
function drawPadlock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number) {
  const bodyW = size * 0.8
  const bodyH = size * 0.56
  const top = cy - size / 2 + size * 0.44
  g.lineStyle(Math.max(u(2), size * 0.16), INK, 0.7)
  g.beginPath()
  g.arc(cx, top, size * 0.26, Math.PI, 0)
  g.strokePath()
  g.fillStyle(INK, 0.7)
  g.fillRoundedRect(cx - bodyW / 2, top, bodyW, bodyH, size * 0.12)
}
