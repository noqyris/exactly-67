import Phaser from 'phaser'
import { beamAngleDeg } from '../game/balance'
import { levelByGlobal, TOTAL_LEVELS } from '../game/levels'
import type { LevelRef } from '../game/levels'
import {
  canPlace,
  canRemove,
  evaluate,
  initialPlacement,
  place,
  placedCount,
  remove,
} from '../game/rules'
import type { Placement } from '../game/rules'
import { solveLevel } from '../game/solver'
import { starsForClear } from '../game/stars'
import type { Evaluation } from '../game/types'
import {
  playPlace,
  playPlaceBalloon,
  playRefuse,
  playRemove,
  playWinJingle,
  setSoundEnabled,
  soundEnabled,
} from '../services/audio'
import {
  hapticsEnabled,
  placeTap,
  refuseTap,
  removeTap,
  setHapticsEnabled,
  winTap,
} from '../services/haptics'
import { progress, recordClear } from '../services/progressStore'
import { bestFor } from '../game/progress'
import { saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { prefersReducedMotion, safeArea } from './layout'
import { BG, GOOD, INK, OVER, OUTLINE, PAPER, UNDER } from './palette'
import { ScaleView } from './ScaleView'
import type { ScaleGeometry } from './ScaleView'
import { drawBackIcon, drawHapticsIcon, drawSoundIcon, drawStar, makeButton, makeIconButton, TEXT } from './ui'
import { WeightView } from './WeightView'

const GOOD_CSS = '#37B24D'
const OVER_CSS = '#E8590C'
const UNDER_CSS = '#4DABF7'
const INK_SOFT = '#5D5470'

interface TrayMetrics {
  x: number
  y: number
  width: number
  height: number
  homes: { x: number; y: number; scale: number }[]
}

export class GameScene extends Phaser.Scene {
  private ref!: LevelRef
  private placed: Placement = []
  private minWeights = 1
  private wonState = false
  private reducedMotion = false

  private scaleView!: ScaleView
  private weights: WeightView[] = []
  /** Pan slot per weight index; null = in the tray. */
  private slotOf: (number | null)[] = []
  private nextSlot = 0
  private panScale = 0.62

  private trayG!: Phaser.GameObjects.Graphics
  private tray!: TrayMetrics
  private dropZone!: Phaser.Geom.Rectangle

  private levelText!: Phaser.GameObjects.Text
  private totalText!: Phaser.GameObjects.Text
  private gapText!: Phaser.GameObjects.Text
  private totalChipG!: Phaser.GameObjects.Graphics
  private budgetText!: Phaser.GameObjects.Text | null
  private useAllText!: Phaser.GameObjects.Text | null
  private hintText!: Phaser.GameObjects.Text | null
  private toastText!: Phaser.GameObjects.Text
  private toastTween: Phaser.Tweens.Tween | null = null

  constructor() {
    super('Game')
  }

  init(data: { level?: number }) {
    const ref = levelByGlobal(data.level ?? 1)
    if (!ref) throw new Error(`Unknown level ${data.level}`)
    this.ref = ref
    this.wonState = false
    this.weights = []
    this.toastTween = null
    this.budgetText = null
    this.useAllText = null
    this.hintText = null
    this.nextSlot = 0
  }

  create() {
    this.reducedMotion = prefersReducedMotion()
    const level = this.ref.def
    this.placed = initialPlacement(level)
    this.minWeights = solveLevel(level).minWeights ?? 1
    this.cameras.main.setBackgroundColor(BG)

    this.scaleView = new ScaleView(this, this.scaleGeometry())
    this.trayG = this.add.graphics()
    this.buildHud()
    this.buildWeights()
    this.layoutAll()

    // Locked weights are already aboard: reflect that before first paint.
    for (let i = 0; i < level.weights.length; i++) {
      if (this.placed[i]) this.slotOf[i] = this.nextSlot++
    }
    const ev = evaluate(level, this.placed)
    this.scaleView.setTargetAngle(beamAngleDeg(ev.total))
    this.scaleView.settleImmediately()
    this.updateHud(ev)

    // Snap weights to their homes on the first frame instead of gliding in.
    this.steerWeights(1)

    this.input.dragDistanceThreshold = 10
    this.scale.on('resize', this.layoutAll, this)
    this.events.once('shutdown', () => this.scale.off('resize', this.layoutAll, this))
    this.bindKeyboard()

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__exactly67 = {
        scene: this,
        place: (i: number) => this.placeWeight(i),
        remove: (i: number) => this.removeWeight(i),
        state: () => evaluate(this.ref.def, this.placed),
        level: this.ref,
      }
    }
  }

  // ---------------------------------------------------------------- layout

  private scaleGeometry(): ScaleGeometry {
    const w = this.scale.width
    const h = this.scale.height
    const safe = safeArea()
    const halfBeam = Math.min(w * 0.36, 250)
    return {
      cx: w / 2,
      cy: safe.top + h * 0.245,
      halfBeam,
      ropeLen: Math.min(h * 0.14, 130),
      panWidth: Math.min(w * 0.32, 200),
      panHeight: Math.min(w * 0.32, 200) * 0.22,
    }
  }

  private layoutAll() {
    const w = this.scale.width
    const h = this.scale.height
    const safe = safeArea()
    const geo = this.scaleGeometry()
    this.scaleView.layout(geo)
    this.panScale = Math.min(1, (geo.panWidth * 0.34) / 84)

    // Tray panel: bottom band above the home indicator.
    const trayMargin = Math.max(12, safe.left, safe.right)
    const trayTop = h * 0.635
    const trayBottom = h - safe.bottom - 10
    this.tray = {
      x: trayMargin,
      y: trayTop,
      width: w - trayMargin * 2,
      height: trayBottom - trayTop,
      homes: [],
    }
    this.drawTray()
    this.computeTrayHomes()

    // Drop anywhere in the scale's half of the screen counts as the pan.
    const anchor = this.scaleView.rightPanAnchor()
    this.dropZone = new Phaser.Geom.Rectangle(
      anchor.x - geo.panWidth * 0.9,
      geo.cy - geo.halfBeam * 0.6,
      geo.panWidth * 1.8,
      trayTop - (geo.cy - geo.halfBeam * 0.6) - 8,
    )

    this.layoutHud()
    if (this.placed.length > 0) this.updateHud(evaluate(this.ref.def, this.placed))
  }

  private drawTray() {
    const { x, y, width, height } = this.tray
    const g = this.trayG
    g.clear()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(x, y + 5, width, height, 22)
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(x, y, width, height, 22)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(x, y, width, height, 22)
  }

  private computeTrayHomes() {
    const n = this.ref.def.weights.length
    const cols = n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : Math.ceil(n / 3)
    const rows = Math.ceil(n / cols)
    const pad = 10
    const cellW = (this.tray.width - pad * 2) / cols
    const cellH = (this.tray.height - pad * 2) / rows
    this.tray.homes = []
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, n - row * cols)
      const col = i - row * cols
      // Center the last (possibly short) row.
      const rowOffset = ((cols - inRow) * cellW) / 2
      const view = this.weights[i]
      const size = view ? view.bodySize : 84
      const scale = Math.min(1, (cellW * 0.82) / size, (cellH * 0.72) / (size * 1.4))
      this.tray.homes.push({
        x: this.tray.x + pad + rowOffset + cellW * (col + 0.5),
        y: this.tray.y + pad + cellH * (row + 0.5),
        scale,
      })
    }
  }

  // ------------------------------------------------------------------ HUD

  private buildHud() {
    this.levelText = this.add.text(0, 0, '', TEXT.ink(19)).setOrigin(0.5, 0)
    this.totalChipG = this.add.graphics()
    this.totalText = this.add.text(0, 0, '0', TEXT.ink(40, '800')).setOrigin(0.5)
    this.gapText = this.add.text(0, 0, '', TEXT.ink(16, '600')).setOrigin(0.5, 0)
    this.toastText = this.add.text(0, 0, '', TEXT.ink(15, '600')).setOrigin(0.5).setAlpha(0)
    this.toastText.setDepth(50)

    const level = this.ref.def
    if (level.maxWeights !== undefined) {
      this.budgetText = this.add.text(0, 0, '', TEXT.ink(15)).setOrigin(0, 0.5)
    }
    if (level.useAll) {
      this.useAllText = this.add
        .text(0, 0, 'use every weight', TEXT.ink(15))
        .setOrigin(1, 0.5)
    }
    if (level.hint) {
      this.hintText = this.add.text(0, 0, level.hint, TEXT.ink(15, '600')).setOrigin(0.5)
      this.hintText.setColor(INK_SOFT)
    }

    const size = 46
    const back = makeIconButton(this, size, (g, s) => drawBackIcon(g, s), () => {
      this.scene.start('LevelMap', { scrollTo: this.ref.global })
    })
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
    this.hudButtons = { back, sound, haptics }
  }

  private hudButtons!: {
    back: ReturnType<typeof makeIconButton>
    sound: ReturnType<typeof makeIconButton>
    haptics: ReturnType<typeof makeIconButton>
  }

  private layoutHud() {
    const w = this.scale.width
    const safe = safeArea()
    const top = safe.top + 12
    const size = 46

    this.hudButtons.back.setPosition(Math.max(16, safe.left) + size / 2, top + size / 2)
    this.hudButtons.haptics.setPosition(w - Math.max(16, safe.right) - size / 2, top + size / 2)
    this.hudButtons.sound.setPosition(this.hudButtons.haptics.x - size - 12, top + size / 2)

    this.levelText.setPosition(w / 2, top + 2)
    this.levelText.setText(`Level ${this.ref.global} · ${this.ref.pack.name}`)

    // Total chip sits between the HUD row and the beam.
    const chipY = top + size + 44
    this.totalText.setPosition(w / 2, chipY)
    this.gapText.setPosition(w / 2, chipY + 30)

    const constraintY = this.tray.y - 16
    this.budgetText?.setPosition(this.tray.x + 6, constraintY)
    this.useAllText?.setPosition(this.tray.x + this.tray.width - 6, constraintY)
    this.hintText?.setPosition(w / 2, this.tray.y - (this.budgetText || this.useAllText ? 38 : 16))
    this.hintText?.setWordWrapWidth(this.tray.width - 20)
    this.toastText.setPosition(w / 2, this.tray.y - 60)
  }

  private drawTotalChip(color: number) {
    const w = this.scale.width
    const chipW = 150
    const chipH = 84
    const x = w / 2 - chipW / 2
    const y = this.totalText.y - 30
    const g = this.totalChipG
    g.clear()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(x, y + 4, chipW, chipH, 20)
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(x, y, chipW, chipH, 20)
    g.lineStyle(OUTLINE, color, 1)
    g.strokeRoundedRect(x, y, chipW, chipH, 20)
  }

  private updateHud(ev: Evaluation) {
    const level = this.ref.def
    this.totalText.setText(String(ev.total))

    if (ev.won || (ev.balanced && !ev.won)) {
      this.totalText.setColor(GOOD_CSS)
      this.drawTotalChip(GOOD)
    } else if (ev.gap > 0) {
      this.totalText.setColor(OVER_CSS)
      this.drawTotalChip(OVER)
    } else if (placedCount(this.placed) > 0) {
      this.totalText.setColor(UNDER_CSS)
      this.drawTotalChip(UNDER)
    } else {
      this.totalText.setColor('#2B2440')
      this.drawTotalChip(INK)
    }

    if (ev.won) {
      this.gapText.setText('PERFECT — exactly 67!').setColor(GOOD_CSS)
    } else if (ev.balanced) {
      this.gapText.setText('Balanced! Now use every weight.').setColor(GOOD_CSS)
    } else if (placedCount(this.placed) === 0) {
      this.gapText.setText('Load the right pan to 67').setColor(INK_SOFT)
    } else if (ev.gap > 0) {
      this.gapText.setText(`${ev.gap} too heavy — balloons lift!`).setColor(OVER_CSS)
    } else {
      this.gapText.setText(`${-ev.gap} to go`).setColor(UNDER_CSS)
    }

    if (this.budgetText && level.maxWeights !== undefined) {
      const used = placedCount(this.placed)
      this.budgetText.setText(`weights: ${used}/${level.maxWeights}`)
      this.budgetText.setColor(used >= level.maxWeights ? OVER_CSS : '#2B2440')
    }
  }

  private showToast(message: string) {
    this.toastTween?.stop()
    this.toastText.setText(message).setAlpha(1)
    this.toastTween = this.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 1500,
      duration: 350,
    })
  }

  // -------------------------------------------------------------- weights

  private buildWeights() {
    const level = this.ref.def
    this.slotOf = level.weights.map(() => null)
    level.weights.forEach((value, i) => {
      const locked = (level.locked ?? []).includes(i)
      const view = new WeightView(this, i, value, locked)
      view.setDepth(10)
      this.weights.push(view)
      if (!locked) {
        view.makeInteractive()
        this.bindWeightInput(view)
      }
    })
  }

  private bindWeightInput(view: WeightView) {
    let tapCandidate = false

    view.on('pointerdown', () => {
      tapCandidate = true
    })

    view.on('dragstart', () => {
      if (this.wonState) return
      tapCandidate = false
      view.dragging = true
      this.children.bringToTop(view)
      this.tweens.add({ targets: view, scale: 1, duration: 90 })
    })

    view.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (this.wonState) return
      view.setPosition(dragX, dragY)
    })

    view.on('dragend', (pointer: Phaser.Input.Pointer) => {
      view.dragging = false
      if (this.wonState) return
      const overPan = this.dropZone.contains(pointer.x, pointer.y)
      const isPlaced = this.placed[view.index]
      if (overPan && !isPlaced) this.placeWeight(view.index)
      else if (!overPan && isPlaced) this.removeWeight(view.index)
      // Otherwise the steering lerp glides it back where it belongs.
    })

    view.on('pointerup', () => {
      if (!tapCandidate || this.wonState) return
      tapCandidate = false
      if (this.placed[view.index]) this.removeWeight(view.index)
      else this.placeWeight(view.index)
    })
  }

  private placeWeight(index: number) {
    if (this.wonState) return
    const level = this.ref.def
    const check = canPlace(level, this.placed, index)
    if (!check.ok) {
      if (check.reason === 'budget-full') {
        this.weights[index].wiggle()
        playRefuse()
        refuseTap()
        this.showToast(`Only ${level.maxWeights} weights allowed — take one off first`)
      }
      return
    }
    this.placed = place(level, this.placed, index)
    this.slotOf[index] = this.nextSlot++
    if (this.weights[index].isBalloon) playPlaceBalloon()
    else playPlace()
    placeTap()
    this.afterChange()
  }

  private removeWeight(index: number) {
    if (this.wonState) return
    const level = this.ref.def
    if (!canRemove(level, this.placed, index)) {
      if (this.placed[index]) {
        this.weights[index].wiggle()
        playRefuse()
        refuseTap()
        this.showToast('That weight is bolted on')
      }
      return
    }
    this.placed = remove(level, this.placed, index)
    this.slotOf[index] = null
    playRemove()
    removeTap()
    this.afterChange()
  }

  private afterChange() {
    const ev = evaluate(this.ref.def, this.placed)
    this.scaleView.setTargetAngle(beamAngleDeg(ev.total))
    this.updateHud(ev)
    if (ev.balanced && !ev.won && ev.blockedReason === 'use-all') {
      this.showToast('Balanced — but every weight must be aboard!')
    }
    if (ev.won && !this.wonState) this.winSequence()
  }

  /** Pan layout: blocks stack in the dish, balloons bob above the rim. */
  private panTargets(): Map<number, { x: number; y: number; scale: number }> {
    const targets = new Map<number, { x: number; y: number; scale: number }>()
    const anchor = this.scaleView.rightPanAnchor()
    const geo = this.scaleGeometry()

    const aboard = this.weights
      .filter((v) => this.placed[v.index] && this.slotOf[v.index] !== null)
      .sort((a, b) => (this.slotOf[a.index] ?? 0) - (this.slotOf[b.index] ?? 0))
    const blocks = aboard.filter((v) => !v.isBalloon)
    const balloons = aboard.filter((v) => v.isBalloon)

    blocks.forEach((view, i) => {
      const perRow = 3
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, blocks.length - row * perRow)
      const col = i - row * perRow
      const slotW = geo.panWidth * 0.31
      const x = anchor.x + (col - (inRow - 1) / 2) * slotW
      const bodyH = view.bodySize * 0.8 * this.panScale
      const y = anchor.y - row * bodyH * 1.02 - bodyH / 2 - 2
      targets.set(view.index, { x, y, scale: this.panScale })
    })

    const spread = [-0.3, 0.3, 0, -0.16, 0.16, -0.38, 0.38]
    balloons.forEach((view, i) => {
      const x = anchor.x + geo.panWidth * spread[i % spread.length]
      const y = anchor.y - 6 - (i % 3) * 8
      targets.set(view.index, { x, y, scale: this.panScale })
    })

    return targets
  }

  update(time: number, delta: number) {
    this.scaleView.update(time, delta)
    this.steerWeights(1 - Math.exp(-12 * (delta / 1000)))
  }

  /** Every weight glides toward its home (tray slot or pan position). */
  private steerWeights(t: number) {
    const panTargets = this.panTargets()
    this.weights.forEach((view, i) => {
      if (view.dragging) return
      const target = panTargets.get(i)
      let tx: number
      let ty: number
      let ts: number
      if (target) {
        tx = target.x
        ty = target.y
        ts = target.scale
      } else {
        const home = this.tray.homes[i]
        tx = home.x
        ty = home.y + view.centerOffsetY(home.scale)
        ts = home.scale
      }
      view.x = Phaser.Math.Linear(view.x, tx, t)
      view.y = Phaser.Math.Linear(view.y, ty, t)
      view.setScale(Phaser.Math.Linear(view.scaleX, ts, t))
    })
  }

  // ------------------------------------------------------------------ win

  private winSequence() {
    this.wonState = true
    this.scaleView.setWon(true)
    this.weights.forEach((w) => w.disableInteractive())

    const used = placedCount(this.placed)
    const stars = starsForClear(used, this.minWeights)
    recordClear(this.ref.global, stars, used)

    this.time.delayedCall(500, () => {
      if (!this.reducedMotion) this.cameras.main.shake(180, 0.007)
      playWinJingle()
      winTap()
    })
    this.time.delayedCall(1000, () => this.showWinOverlay(stars, used))
  }

  private showWinOverlay(stars: number, used: number) {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(100)

    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45)
    dim.setInteractive() // swallow taps behind the card

    const cardW = Math.min(w - 48, 360)
    const cardH = 330
    const cx = w / 2
    const cy = h * 0.44
    const card = this.add.graphics()
    card.fillStyle(INK, 1)
    card.fillRoundedRect(cx - cardW / 2, cy - cardH / 2 + 6, cardW, cardH, 26)
    card.fillStyle(PAPER, 1)
    card.fillRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 26)
    card.lineStyle(OUTLINE + 1, INK, 1)
    card.strokeRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 26)

    const title = this.add.text(cx, cy - cardH / 2 + 44, 'EXACTLY 67!', TEXT.ink(30, '800')).setOrigin(0.5)

    // Three star slots; earned ones pop in.
    const starR = 26
    const starViews: Phaser.GameObjects.Graphics[] = []
    for (let i = 0; i < 3; i++) {
      const sg = this.add.graphics()
      const sx = cx + (i - 1) * (starR * 2.6)
      const sy = cy - cardH / 2 + 108
      drawStar(sg, 0, 0, i === 1 ? starR * 1.25 : starR, i < stars)
      sg.setPosition(sx, sy)
      if (i < stars && !this.reducedMotion) {
        sg.setScale(0)
        this.tweens.add({
          targets: sg,
          scale: 1,
          delay: 150 + i * 160,
          duration: 320,
          ease: 'Back.easeOut',
        })
      }
      starViews.push(sg)
    }

    const best = bestFor(progress(), this.ref.global)
    const summary =
      used <= this.minWeights
        ? `Solved with ${used} — the perfect minimum!`
        : `Solved with ${used} · minimum is ${this.minWeights}` +
          (best !== undefined ? ` · your best ${best}` : '')
    const sub = this.add.text(cx, cy - cardH / 2 + 156, summary, TEXT.ink(15, '600')).setOrigin(0.5)
    sub.setColor(INK_SOFT)
    sub.setWordWrapWidth(cardW - 40)
    sub.setAlign('center')

    const hasNext = this.ref.global < TOTAL_LEVELS
    const btnY = cy + cardH / 2 - 56
    const nextBtn = hasNext
      ? makeButton(this, 'Next', cardW * 0.42, 56, 0xf5b942, '#2B2440', () => {
          this.scene.restart({ level: this.ref.global + 1 })
        })
      : makeButton(this, 'The End!', cardW * 0.42, 56, 0xf5b942, '#2B2440', () => {
          this.scene.start('LevelMap', { scrollTo: this.ref.global })
        })
    nextBtn.setPosition(cx + cardW * 0.24, btnY)

    const retryBtn = makeButton(this, 'Retry', cardW * 0.22, 56, PAPER, '#2B2440', () => {
      this.scene.restart({ level: this.ref.global })
    })
    retryBtn.setPosition(cx - cardW * 0.36, btnY)

    const mapBtn = makeButton(this, 'Map', cardW * 0.2, 56, PAPER, '#2B2440', () => {
      this.scene.start('LevelMap', { scrollTo: this.ref.global })
    })
    mapBtn.setPosition(cx - cardW * 0.13, btnY)

    overlay.add([dim, card, title, ...starViews, sub, nextBtn, retryBtn, mapBtn])
    if (!this.reducedMotion) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 200 })
    }
  }

  // ------------------------------------------------------------- keyboard

  /** Dev conveniences: 1–9/0 toggle weights, R restart, N next, M mute. */
  private bindKeyboard() {
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const key = event.key
      if (key >= '0' && key <= '9') {
        const index = key === '0' ? 9 : Number(key) - 1
        if (index < this.weights.length) {
          if (this.placed[index]) this.removeWeight(index)
          else this.placeWeight(index)
        }
      } else if (key === 'r' || key === 'R') {
        this.scene.restart({ level: this.ref.global })
      } else if ((key === 'n' || key === 'N') && this.wonState && this.ref.global < TOTAL_LEVELS) {
        this.scene.restart({ level: this.ref.global + 1 })
      } else if (key === 'm' || key === 'M') {
        setSoundEnabled(!soundEnabled())
        void saveSoundEnabled(soundEnabled())
        this.hudButtons.sound.refresh()
      } else if (key === 'Escape') {
        this.scene.start('LevelMap', { scrollTo: this.ref.global })
      }
    })
  }
}
