import Phaser from 'phaser'
import { beamAngleDeg } from '../game/balance'
import { levelByGlobal, TOTAL_LEVELS } from '../game/levels'
import type { LevelRef } from '../game/levels'
import { dailyLevelFor, todayKey } from '../game/daily'
import type { LevelPack } from '../game/types'
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
import { countSolutions, minimalSolution, solutionIndex, solveLevel } from '../game/solver'
import { shareCard } from '../game/share'
import { starsForClear } from '../game/stars'
import type { Evaluation } from '../game/types'
import {
  playCelebration,
  playHintChime,
  playPlace,
  playPlaceBalloon,
  playRefuse,
  playRemove,
  playWinJingle,
  setSoundEnabled,
  soundEnabled,
} from '../services/audio'
import { duckMusic } from '../services/music'
import {
  hapticsEnabled,
  placeTap,
  refuseTap,
  removeTap,
  setHapticsEnabled,
  winTap,
} from '../services/haptics'
import { progress, recordClear } from '../services/progressStore'
import { shareText } from '../services/share'
import { maybeRequestReview } from '../services/review'
import { bestFor } from '../game/progress'
import {
  hintsUnlimited,
  grantHint,
  hasHint,
  hintCountValue,
  interstitialWouldShow,
  maybeShowInterstitial,
  noteCleared,
  rewardedOffered,
  showBanner,
  useHint,
  watchRewardedHint,
} from '../services/ads'
import type { RewardedOutcome } from '../services/ads'
import { saveDailyDone, saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, prefersReducedMotion, safeArea, u } from './layout'
import { BG, CREAM_CSS, FONT, GOOD, INK, INK_CSS, OVER, OUTLINE, PAPER, STAR, UNDER } from './palette'
import { ScaleView } from './ScaleView'
import type { ScaleGeometry } from './ScaleView'
import { drawBackIcon, drawHapticsIcon, drawHintIcon, drawSoundIcon, drawStar, makeButton, makeIconButton, TEXT } from './ui'
import { WeightView } from './WeightView'

const GOOD_CSS = '#37B24D'
const OVER_CSS = '#E8590C'
const UNDER_CSS = '#4DABF7'
const INK_SOFT = '#5D5470'

/**
 * Every word the hint modal says about the rewarded video.
 *
 * The offer names BOTH the ad and the reward before the player opts in, and it
 * keeps naming them after a hint is banked and the modal stays open. Unity's
 * Rewarded Inventory Policy requires publishers to "clearly disclose the reward
 * and the required action for each applicable reward (e.g. 'View this Ad to
 * receive 10 gems')", and withholds payment for inventory that does not. The
 * old "Watch video" said neither. Nothing here asks the player to support us:
 * the same policy names that framing as a violation.
 */
const HINT_COPY = {
  /** Needs a ~180 pt button; hintWatchLabel() falls back to the short one on a 320 pt phone. */
  watch: 'Watch ad: +1 hint',
  watchShort: 'Ad: +1 hint',
  loading: 'Loading…',
  /** The modal opens at zero hints; the stash can grow while it stays open. */
  body: (n: number) =>
    n === 0
      ? 'Out of hints — watch a short ad for 1 hint, or grab a pack.'
      : `You have ${n} hint${n === 1 ? '' : 's'}. Watch a short ad for 1 more.`,
  /**
   * No consent, no SDK, so no video can ever play — say why, and where the
   * decision lives (MenuScene's "Privacy choices" link), instead of offering a
   * button that fails on every tap after a consent modal that promised "no
   * hint videos".
   */
  videosOff:
    'Hint videos are off because ads were declined. Turn them on under Privacy choices on the menu, or grab a pack.',
  earned: 'Hint earned!',
  /** No video was ever shown: no fill, a failed or slow load. True of each. */
  unavailable: 'No video available right now — try again soon',
  /** A video was handed over and did not pay out: closed early, or failed to present. */
  notEarned: "No hint this time — the ad didn't play to the end",
} as const

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
  /** How many distinct placements win this level; 1 for most of them. */
  private waysTotal = 1
  /** Pan total after every board change — the route, for the share card. */
  private trace: number[] = []
  /** performance.now() at the first placement, or null before it. */
  private startedAt: number | null = null
  private wonState = false
  private reducedMotion = false
  private hintBusy = false
  /** A hint was already revealed for the current board — a re-tap replays the
   *  demo for free (no double-charge). Reset on any board change (afterChange). */
  private hintShown = false
  private hintCooldownUntil = 0
  private hintObjects: Phaser.GameObjects.GameObject[] = []
  private hintTweens: Phaser.Tweens.Tween[] = []

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
  private packText!: Phaser.GameObjects.Text
  private totalText!: Phaser.GameObjects.Text
  private gapText!: Phaser.GameObjects.Text
  private totalChipG!: Phaser.GameObjects.Graphics
  private budgetText!: Phaser.GameObjects.Text | null
  private useAllText!: Phaser.GameObjects.Text | null
  private hintText!: Phaser.GameObjects.Text | null
  private toastText!: Phaser.GameObjects.Text
  private toastTween: Phaser.Tweens.Tween | null = null
  private confettiKeys: string[] = []
  private prevTotal: number | null = null
  private daily = false

  constructor() {
    super('Game')
  }

  init(data: { level?: number; daily?: boolean }) {
    this.daily = data.daily === true
    if (this.daily) {
      // Same puzzle for everyone today; a fake pack carries just a title label.
      this.ref = {
        def: dailyLevelFor(todayKey(new Date())),
        pack: { id: 'daily', name: "Today's puzzle", tagline: '', levels: [] } as LevelPack,
        packIndex: -1,
        levelIndex: -1,
        global: -1,
      }
    } else {
      const ref = levelByGlobal(data.level ?? 1)
      if (!ref) throw new Error(`Unknown level ${data.level}`)
      this.ref = ref
    }
    this.wonState = false
    this.weights = []
    this.toastTween = null
    this.budgetText = null
    this.useAllText = null
    this.hintText = null
    this.nextSlot = 0
    this.hintShown = false
    this.hintCooldownUntil = 0
    this.hintObjects = []
    this.hintTweens = []
    this.trace = []
    this.startedAt = null
    this.prevTotal = null
  }

  create() {
    this.reducedMotion = prefersReducedMotion()
    const level = this.ref.def
    this.placed = initialPlacement(level)
    this.minWeights = solveLevel(level).minWeights ?? 1
    this.waysTotal = countSolutions(level)
    this.cameras.main.setBackgroundColor(BG)
    this.makeConfettiTextures()

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

    // Re-ask for the bottom banner on every level start. Idempotent (a live
    // banner is only resumed), and it heals a first request that found no fill
    // or an SDK still waiting on consent — otherwise the strip layoutAll() just
    // reserved could stay empty for the whole session. No-op without ads.
    void showBanner()

    this.input.dragDistanceThreshold = u(10)
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
    const f = contentFrame(this.scale.width, this.scale.height)
    const safe = safeArea()
    const halfBeam = Math.min(f.ew * 0.33, u(240))
    const panWidth = Math.min(f.ew * 0.29, u(190))
    return {
      cx: f.cx,
      cy: Math.max(f.oy, safe.top) + f.eh * 0.245,
      halfBeam,
      ropeLen: Math.min(f.eh * 0.14, u(130)),
      panWidth,
      panHeight: panWidth * 0.22,
    }
  }

  private layoutAll() {
    const h = this.scale.height
    const f = contentFrame(this.scale.width, this.scale.height)
    const safe = safeArea()
    const geo = this.scaleGeometry()
    this.scaleView.layout(geo)
    this.panScale = Math.min(1, (geo.panWidth * 0.34) / u(84))

    // Tray panel: centered in the content frame, above the home indicator.
    const trayMargin = Math.max(u(12), safe.left, safe.right)
    const trayTop = f.oy + f.eh * 0.635
    const trayBottom = Math.min(f.oy + f.eh, h - safe.bottom) - u(10)
    this.tray = {
      x: f.ox + trayMargin,
      y: trayTop,
      width: f.ew - trayMargin * 2,
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
      trayTop - (geo.cy - geo.halfBeam * 0.6) - u(8),
    )

    this.layoutHud()
    if (this.placed.length > 0) this.updateHud(evaluate(this.ref.def, this.placed))
  }

  private drawTray() {
    const { x, y, width, height } = this.tray
    const g = this.trayG
    g.clear()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(x, y + u(5), width, height, u(22))
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(x, y, width, height, u(22))
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(x, y, width, height, u(22))
  }

  private computeTrayHomes() {
    const n = this.ref.def.weights.length
    const cols = n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : Math.ceil(n / 3)
    const rows = Math.ceil(n / cols)
    const pad = u(10)
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
      const size = view ? view.bodySize : u(84)
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
    this.levelText = this.add.text(0, 0, '', TEXT.ink(20)).setOrigin(0.5, 0)
    this.packText = this.add.text(0, 0, '', TEXT.ink(13, '600')).setOrigin(0.5, 0)
    this.packText.setColor(INK_SOFT)
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

    const size = u(46)
    const back = makeIconButton(this, size, (g, s) => drawBackIcon(g, s), () => {
      if (this.daily) this.scene.start('Menu')
      else this.scene.start('LevelMap', { scrollTo: this.ref.global })
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
    const hint = makeIconButton(
      this,
      size,
      // 'empty' promises a hint video (the ▶ chip); a player who declined ad
      // consent gets none, so their spent bulb must not advertise one.
      (g, s) => drawHintIcon(g, s, hintsUnlimited() || hasHint() ? 'have' : rewardedOffered() ? 'empty' : 'spent'),
      () => {
        void this.doHint()
      },
    )
    // The stash count can't be a Graphics primitive, so it rides as a Text child
    // on top of the green disc; refreshHint() keeps it in sync.
    this.hintBadge = this.add
      .text(size * 0.295, -size * 0.295, '1', TEXT.cream(12, '800'))
      .setOrigin(0.5)
    hint.add(this.hintBadge)
    this.hudButtons = { back, sound, haptics, hint }
    this.refreshHint()
    // Coming back from the Store overlay, the stash may have grown (or hints may
    // have become unlimited) — resync the badge instead of showing a stale count.
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.refreshHint())
  }

  private hudButtons!: {
    back: ReturnType<typeof makeIconButton>
    sound: ReturnType<typeof makeIconButton>
    haptics: ReturnType<typeof makeIconButton>
    hint: ReturnType<typeof makeIconButton>
  }

  private hintBadge!: Phaser.GameObjects.Text

  /** Re-render the hint button + its count badge for the current stash size. */
  private refreshHint() {
    this.hudButtons.hint.refresh()
    if (hintsUnlimited()) {
      // Bundle owners have unlimited free hints — lit bulb, no count.
      this.hintBadge.setVisible(false)
      return
    }
    const n = hintCountValue()
    this.hintBadge.setText(n > 9 ? '9+' : String(n))
    this.hintBadge.setVisible(n > 0)
  }

  private layoutHud() {
    const f = contentFrame(this.scale.width, this.scale.height)
    const safe = safeArea()
    const top = Math.max(f.oy, safe.top) + u(12)
    const size = u(46)
    const leftX = f.ox + Math.max(u(16), safe.left) + size / 2
    const rightX = f.ox + f.ew - Math.max(u(16), safe.right) - size / 2

    this.hudButtons.back.setPosition(leftX, top + size / 2)
    this.hudButtons.hint.setPosition(leftX + size + u(12), top + size / 2)
    this.hudButtons.haptics.setPosition(rightX, top + size / 2)
    this.hudButtons.sound.setPosition(rightX - size - u(12), top + size / 2)

    this.levelText.setPosition(f.cx, top - u(2))
    this.levelText.setText(this.daily ? 'Daily Challenge' : `Level ${this.ref.global}`)
    this.packText.setPosition(f.cx, top + u(24))
    this.packText.setText(this.ref.pack.name)

    // Total chip sits between the HUD row and the beam; the gap message
    // hangs just below it.
    const chipY = top + size + u(48)
    this.totalText.setPosition(f.cx, chipY)
    this.gapText.setPosition(f.cx, chipY + u(43)).setOrigin(0.5, 0)

    const constraintY = this.tray.y - u(16)
    this.budgetText?.setPosition(this.tray.x + u(6), constraintY)
    this.useAllText?.setPosition(this.tray.x + this.tray.width - u(6), constraintY)
    this.hintText?.setPosition(
      f.cx,
      this.tray.y - (this.budgetText || this.useAllText ? u(38) : u(16)),
    )
    this.hintText?.setWordWrapWidth(this.tray.width - u(20))
    this.toastText.setPosition(f.cx, this.tray.y - u(60))
    this.toastText.setWordWrapWidth(this.tray.width - u(20))
    this.toastText.setAlign('center')
  }

  private drawTotalChip(color: number) {
    const chipW = u(132)
    const chipH = u(66)
    const x = contentFrame(this.scale.width, this.scale.height).cx - chipW / 2
    const y = this.totalText.y - chipH / 2
    const g = this.totalChipG
    g.clear()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(x, y + u(4), chipW, chipH, u(20))
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(x, y, chipW, chipH, u(20))
    g.lineStyle(OUTLINE, color, 1)
    g.strokeRoundedRect(x, y, chipW, chipH, u(20))
  }

  private updateHud(ev: Evaluation) {
    const level = this.ref.def
    this.totalText.setText(String(ev.total))
    if (!this.reducedMotion && this.prevTotal !== null && this.prevTotal !== ev.total) {
      this.tweens.killTweensOf(this.totalText)
      this.tweens.add({ targets: this.totalText, scale: { from: 1.3, to: 1 }, duration: 240, ease: 'Back.out' })
    }
    this.prevTotal = ev.total

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
      // Only point at balloons when one is actually still available to add;
      // on positive-only levels (or once every balloon is placed) the only
      // recovery is to take a weight back off.
      const canLift = level.weights.some((wv, i) => wv < 0 && !this.placed[i])
      const overMsg = canLift ? `${ev.gap} too heavy — balloons lift!` : `${ev.gap} too heavy — remove a weight`
      this.gapText.setText(overMsg).setColor(OVER_CSS)
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

  /**
   * Tap the 💡: spend one banked hint to run the ghost demo of the exact next
   * piece — which the player still drags themselves (relieves being stuck
   * without hollowing out "I solved it"). A re-tap on the SAME board replays the
   * demo for free (no double-charge); at zero hints, open the earn modal. The
   * "why" is taught by the demo toast + the live gap text under the total chip.
   */
  private doHint() {
    if (this.wonState || this.hintBusy) return
    if (this.time.now < this.hintCooldownUntil) return
    const index = this.hintIndex()
    if (index == null) return
    // Bundle owners get hints on the house: free, unlimited, never an ad. Note
    // this is hintsUnlimited(), NOT adsRemoved() — the $0.99 ads-only product
    // removes ads without buying the hint perk.
    if (!hintsUnlimited() && !this.hintShown) {
      if (!hasHint()) {
        this.showHintMenu()
        return
      }
      useHint()
      this.refreshHint()
      this.hintShown = true
    }
    const ev = evaluate(this.ref.def, this.placed)
    this.revealHintDemo(index, ev)
    this.hintCooldownUntil = this.time.now + 2400
  }

  /** The weight a hint should point at: the next unplaced solution piece. */
  private hintIndex(): number | null {
    const solution = minimalSolution(this.ref.def)
    if (!solution) return null
    const unplaced = solution.filter((i) => !this.placed[i] && !this.weights[i].locked)
    const pool = unplaced.length ? unplaced : solution.filter((i) => !this.weights[i].locked)
    return pool.length ? pool[0] : null
  }

  /** The satisfying ghost demo of the exact next piece. Player still drags it. */
  private revealHintDemo(index: number, ev: Evaluation) {
    this.dismissHintDemo()
    const view = this.weights[index]
    view.highlight(STAR, this.reducedMotion) // gold ring on the REAL tray piece

    const v = this.ref.def.weights[index]
    const what = v < 0 ? `the −${-v} balloon` : `the ${v} weight`
    const diff = ev.total - 67
    const why =
      diff > 0 ? `${diff} over — add ${what}` : diff < 0 ? `${-diff} to go — add ${what}` : `Add ${what}`
    this.showToast(why)

    // Motion lives on an independent GHOST, never the real piece: steerWeights()
    // overwrites the real weight's x/y/scale every frame.
    const home = this.tray.homes[index]
    const start = { x: home.x, y: home.y + view.centerOffsetY(home.scale) }
    const anchor = this.scaleView.rightPanAnchor()
    const end = { x: anchor.x, y: anchor.y - (view.isBalloon ? u(40) : u(6)) }

    const ghost = new WeightView(this, index, v, false)
    ghost.setAlpha(0.32).setDepth(12).setPosition(start.x, start.y).setScale(home.scale)
    this.hintObjects.push(ghost)

    const arrowY = start.y - view.bodySize * 0.85
    if (this.reducedMotion) {
      // No arc/loop: park a static silhouette on the destination + a static arrow.
      ghost.setPosition(end.x, end.y).setScale(this.panScale)
      this.makeHintArrow(start.x, arrowY)
      return
    }

    this.makeHintArrow(start.x, arrowY)

    const control = new Phaser.Math.Vector2((start.x + end.x) / 2, Math.min(start.y, end.y) - u(60))
    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(start.x, start.y),
      control,
      new Phaser.Math.Vector2(end.x, end.y),
    )
    const p = new Phaser.Math.Vector2()
    let landed = false
    const tw = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 700,
      ease: 'Sine.easeInOut',
      repeat: 1,
      repeatDelay: 420,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0
        curve.getPoint(t, p)
        ghost.setPosition(p.x, p.y)
        ghost.setScale(Phaser.Math.Linear(home.scale, this.panScale, t))
        if (t < 0.4) landed = false
        else if (t > 0.98 && !landed) {
          landed = true
          this.onGhostLand(end)
        }
      },
      onComplete: () => this.dismissHintDemo(),
    })
    this.hintTweens.push(tw)
  }

  /** The "resolution" beat: a settle ring + soft chime + light haptic on landing. */
  private onGhostLand(pos: { x: number; y: number }) {
    if (!this.reducedMotion) {
      const ring = this.add.graphics().setDepth(12).setPosition(pos.x, pos.y)
      ring.lineStyle(u(3), STAR, 1)
      ring.strokeCircle(0, 0, u(14))
      this.hintObjects.push(ring)
      const t = this.tweens.add({
        targets: ring,
        scale: { from: 0.6, to: 2 },
        alpha: { from: 1, to: 0 },
        duration: 380,
        onComplete: () => ring.destroy(),
      })
      this.hintTweens.push(t)
    }
    playHintChime()
    placeTap()
  }

  /** A small gold chevron above the piece, bobbing toward the pan. */
  private makeHintArrow(x: number, y: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(12).setPosition(x, y)
    g.lineStyle(u(4), STAR, 1)
    g.beginPath()
    g.moveTo(-u(9), u(6))
    g.lineTo(0, -u(6))
    g.lineTo(u(9), u(6))
    g.strokePath()
    this.hintObjects.push(g)
    if (!this.reducedMotion) {
      const t = this.tweens.add({
        targets: g,
        y: y - u(10),
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
      this.hintTweens.push(t)
    }
    return g
  }

  /** Tear down every hint-demo object + tween (first input / any board change). */
  private dismissHintDemo() {
    this.hintTweens.forEach((t) => t.remove())
    this.hintObjects.forEach((o) => o.destroy())
    this.hintTweens = []
    this.hintObjects = []
  }

  /**
   * Watch a rewarded video to bank ONE hint. It does not reveal anything — the
   * player spends it later on their own terms — which is exactly why it's safe
   * to keep the modal open so they can stock up. Updates the badge + the modal.
   *
   * While it runs, `hintBusy` holds the modal shut (see showHintMenu): the load
   * can take seconds, and a modal closed under it let the video present late —
   * over the level map, or over a board the player had meanwhile won, where the
   * reward they then sat through was thrown away.
   */
  private async watchForHint(modal: { refresh: () => void; say: (message: string) => void }) {
    if (this.hintBusy || this.wonState) return
    this.hintBusy = true
    modal.refresh() // "Loading…" on the button, every way out locked
    let outcome: RewardedOutcome = 'unavailable'
    try {
      // 'earned' only on a reward actually earned; never a hang (see RewardedOutcome).
      outcome = await watchRewardedHint()
    } finally {
      this.hintBusy = false
    }
    // Pay FIRST, before any question about where the player is now: the stash
    // is global, and a video watched to the end is owed its hint whatever
    // happened to this board meanwhile.
    if (outcome === 'earned') grantHint()
    // Scene stopped under the ad (the desktop keyboard shortcuts still work):
    // its Texts are destroyed, and the next create() reads the stash fresh.
    if (!this.sys.isActive()) return
    this.refreshHint()
    modal.refresh()
    if (this.wonState) return
    if (outcome === 'earned') modal.say(HINT_COPY.earned)
    // Consent withdrawn meanwhile: refresh() just put the reason in the modal.
    else if (!rewardedOffered()) return
    else modal.say(outcome === 'unavailable' ? HINT_COPY.unavailable : HINT_COPY.notEarned)
  }

  /** The watch button's label: the full disclosure when it fits, the short one on a 320 pt phone. */
  private hintWatchLabel(buttonW: number, rowH: number): string {
    // Same style makeButton gives its label, measured off the display list.
    const probe = this.make.text(
      {
        text: HINT_COPY.watch,
        style: { fontFamily: FONT, fontSize: `${Math.round(rowH * 0.42)}px`, fontStyle: '700' },
      },
      false,
    )
    const fits = probe.width <= buttonW - u(20)
    probe.destroy()
    return fits ? HINT_COPY.watch : HINT_COPY.watchShort
  }

  /** Modal to earn a hint (a rewarded ad) or buy a hint pack. */
  private showHintMenu() {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(120)
    // No way out while a video is loading or on screen — see watchForHint().
    const close = () => {
      if (this.hintBusy) return
      overlay.destroy()
    }

    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45).setInteractive()

    const cardW = Math.min(w - u(48), u(340))
    const cx = w / 2

    const title = this.add.text(cx, 0, 'Hints', TEXT.ink(21, '800')).setOrigin(0.5)
    const body = this.add.text(cx, 0, '', TEXT.ink(13, '600')).setOrigin(0.5, 0)
    body.setColor(INK_SOFT).setAlign('center').setWordWrapWidth(cardW - u(40))
    // The body's box is sized once, for the longest thing it can ever say, so
    // the card never resizes — and the buttons never move — under a thumb when
    // a hint is banked or the offer changes while the modal is open.
    let bodyBox = 0
    for (const text of [HINT_COPY.body(0), HINT_COPY.body(99), HINT_COPY.videosOff]) {
      body.setText(text)
      bodyBox = Math.max(bodyBox, body.height)
    }

    // The full ladder (packs + the unlimited unlock + restore) lives on the
    // Store screen; this modal stays a quick "earn one now" and just links out.
    const upsell = this.add
      .text(cx, 0, 'More hints in the Store', TEXT.ink(12, '700'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setInteractive({ useHandCursor: true })
    upsell.on('pointerup', () => {
      if (this.hintBusy) return
      close()
      // Overlay, not a scene swap: the player is buying hints to finish THIS
      // board, so it has to still be here when they come back.
      this.scene.pause()
      this.scene.launch('Store', { returnTo: 'Game' })
    })

    // Vertical rhythm, top down: title, the body box, the Store link, the buttons.
    const rowH = u(52)
    const bodyOff = u(54)
    const upsellOff = bodyOff + bodyBox + u(10) + upsell.height / 2
    const btnOff = upsellOff + upsell.height / 2 + u(14) + rowH / 2
    const cardH = btnOff + rowH / 2 + u(20)
    const cy = Math.min(h * 0.44, h - safeArea().bottom - cardH / 2 - u(16))
    const top = cy - cardH / 2
    const btnY = top + btnOff

    const card = this.add.graphics()
    card.fillStyle(INK, 1)
    card.fillRoundedRect(cx - cardW / 2, top + u(6), cardW, cardH, u(24))
    card.fillStyle(PAPER, 1)
    card.fillRoundedRect(cx - cardW / 2, top, cardW, cardH, u(24))
    card.lineStyle(OUTLINE + u(1), INK, 1)
    card.strokeRoundedRect(cx - cardW / 2, top, cardW, cardH, u(24))
    title.setY(top + u(34))
    upsell.setY(top + upsellOff)

    // Button row: Done left, the (wider) watch button right, with fixed side
    // margins and gap so the pair fills a 320 pt card as well as a 430 pt one.
    const margin = u(16)
    const gap = u(12)
    const rowInner = cardW - margin * 2 - gap
    const doneW = rowInner * 0.33
    const watchW = rowInner - doneW
    const watchLabel = this.hintWatchLabel(watchW, rowH)

    let watch: Phaser.GameObjects.Container | null = null
    let done: Phaser.GameObjects.Container | null = null

    // What happened to a tap, said just under the card. The scene's own toast
    // sits under the dim and, on most phones, behind this very card — a "no
    // video available" nobody can read is the dead tap this modal exists to avoid.
    const note = this.add
      .text(cx, top + cardH + u(30), '', TEXT.cream(15, '700'))
      .setOrigin(0.5)
      .setAlign('center')
      .setWordWrapWidth(cardW)
      .setAlpha(0)
    note.setStroke(INK_CSS, u(5))
    let noteTween: Phaser.Tweens.Tween | null = null
    const say = (message: string) => {
      // Modal already closed: the scene's toast is in plain sight again.
      if (!note.active) {
        this.showToast(message)
        return
      }
      noteTween?.stop()
      note.setText(message).setAlpha(1)
      noteTween = this.tweens.add({ targets: note, alpha: 0, delay: 1800, duration: 350 })
    }
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => noteTween?.stop())

    overlay.add([dim, card, title, body, upsell, note])

    // Re-reads everything on every call — the stash, the busy flag and whether
    // the offer stands — so a GRANTED decision made later from Privacy choices
    // brings the watch button back the next time the modal draws.
    const refresh = () => {
      // The modal can already be gone when a video settles (its scene left).
      if (!body.active) return
      const offered = rewardedOffered()
      body.setText(offered ? HINT_COPY.body(hintCountValue()) : HINT_COPY.videosOff)
      body.setY(top + bodyOff + (bodyBox - body.height) / 2)
      upsell.setAlpha(this.hintBusy ? 0.5 : 1)

      watch?.destroy()
      done?.destroy()
      watch = null
      done = null
      if (offered) {
        watch = makeButton(
          this,
          this.hintBusy ? HINT_COPY.loading : watchLabel,
          watchW,
          rowH,
          0xf5b942,
          '#2B2440',
          () => void this.watchForHint({ refresh, say }),
        )
        watch.setPosition(cx + cardW / 2 - margin - watchW / 2, btnY)
        if (this.hintBusy) watch.setAlpha(0.6).disableInteractive()
        done = makeButton(this, 'Done', doneW, rowH, PAPER, '#2B2440', () => close())
        done.setPosition(cx - cardW / 2 + margin + doneW / 2, btnY)
      } else {
        // Nothing to watch: Done alone, centred; the body says why and where.
        done = makeButton(this, 'Done', cardW * 0.4, rowH, PAPER, '#2B2440', () => close())
        done.setPosition(cx, btnY)
      }
      if (this.hintBusy) done.setAlpha(0.5)
      overlay.add(watch ? [watch, done] : [done])
    }
    refresh()

    if (!this.reducedMotion) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 160 })
    }
  }

  /**
   * Show a cadence-gated interstitial, then run the navigation either way.
   * maybeShowInterstitial resolves only once the player has DISMISSED the ad (or
   * at once when none shows, fails to load or fails to present), so the next
   * level never starts underneath a live ad. The game loop sleeps while the ad
   * is up; the ad service wakes it before this resolves.
   */
  private leaveAfterClear(go: () => void) {
    void maybeShowInterstitial(this.ref.global).finally(go)
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
      this.dismissHintDemo() // player took the wheel — end any hint demo
    })

    view.on('dragstart', () => {
      if (this.wonState) return
      tapCandidate = false
      this.dismissHintDemo()
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
    // Any place/remove ends a running demo and lets the next hint charge again.
    this.hintShown = false
    this.dismissHintDemo()
    const ev = evaluate(this.ref.def, this.placed)
    // The route, for the share card: one entry per change, totals only. Locked
    // pieces are already aboard before the first change, so the trace records
    // what the player did, not what they were given.
    this.trace.push(ev.total)
    this.startedAt ??= performance.now()
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

    let stackTop = 0
    blocks.forEach((view, i) => {
      const perRow = 3
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, blocks.length - row * perRow)
      const col = i - row * perRow
      const slotW = geo.panWidth * 0.31
      const x = anchor.x + (col - (inRow - 1) / 2) * slotW
      const bodyH = view.bodySize * 0.8 * this.panScale
      const y = anchor.y - row * bodyH * 1.02 - bodyH / 2 - u(2)
      stackTop = Math.max(stackTop, row * bodyH * 1.02 + bodyH)
      targets.set(view.index, { x, y, scale: this.panScale })
    })

    // Balloons hover above whatever is stacked in the dish, strings down.
    const spread = [-0.3, 0.3, 0, -0.16, 0.16, -0.38, 0.38]
    balloons.forEach((view, i) => {
      const x = anchor.x + geo.panWidth * spread[i % spread.length]
      const y = anchor.y - stackTop - u(4) - (i % 3) * u(8)
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

  /** Generate a few candy-colored confetti textures once (no image assets). */
  private makeConfettiTextures() {
    const colors = [0xf5b942, 0x37b24d, 0xff6b9d, 0x4da3ff, 0xa66bff, 0xff8c5a]
    const cw = Math.round(u(9))
    const ch = Math.round(u(13))
    this.confettiKeys = colors.map((c, i) => {
      const key = `e67-confetti-${i}`
      if (!this.textures.exists(key)) {
        const g = this.add.graphics()
        g.fillStyle(c, 1)
        g.fillRoundedRect(0, 0, cw, ch, Math.round(u(3)))
        g.generateTexture(key, cw, ch)
        g.destroy()
      }
      return key
    })
  }

  /** A shower of candy confetti over the win card. Skipped under reduced motion. */
  private burstConfetti() {
    if (this.reducedMotion || this.confettiKeys.length === 0) return
    const w = this.scale.width
    for (const key of this.confettiKeys) {
      const emitter = this.add
        .particles(0, 0, key, {
          x: { min: 0, max: w },
          y: -u(24),
          lifespan: 2400,
          speedY: { min: u(160), max: u(430) },
          speedX: { min: -u(90), max: u(90) },
          gravityY: u(360),
          scale: { start: 1.05, end: 0.6 },
          rotate: { min: 0, max: 360 },
          emitting: false,
        })
        .setDepth(101)
      emitter.explode(12)
      this.time.delayedCall(2700, () => emitter.destroy())
    }
  }

  // ------------------------------------------------------------------ win

  private winSequence() {
    this.wonState = true
    this.scaleView.setWon(true)
    this.weights.forEach((w) => w.disableInteractive())

    const used = placedCount(this.placed)
    const stars = starsForClear(used, this.minWeights)
    if (this.daily) void saveDailyDone(todayKey(new Date()))
    else recordClear(this.ref.global, stars, used)
    noteCleared() // count this clear toward the interstitial cadence

    // The celebration runs in two beats. First the impact: the beam locks, the
    // camera kicks, confetti drops, the jingle fires and "Congratulations!"
    // pops over the board. Then the reward: the card slides up with the stars
    // and the fanfare. Splitting them is what makes a clear feel earned rather
    // than merely acknowledged — one lump of feedback reads as a notification.
    this.time.delayedCall(500, () => {
      if (!this.reducedMotion) this.cameras.main.shake(180, 0.007)
      this.burstConfetti()
      // Pull the music bed down so the jingle and fanfare cut through instead
      // of fighting the pad underneath.
      duckMusic(0.2, 2.6)
      playWinJingle()
      winTap()
      this.showCongratulations()
    })
    this.time.delayedCall(1000, () => {
      playCelebration()
      this.showWinOverlay(stars, used)
    })
    // Ask for a store rating at the delight peak — after the jingle + star pop,
    // once ever, on an engaged/happy moment. But never pair the ask with an
    // interstitial on the same win: that one-two punch poisons the ask. If an ad
    // is armed for this clear, skip — the review is one-shot (the flag isn't
    // consumed when skipped), so it simply defers to the next clean, ad-free win.
    this.time.delayedCall(1800, () => {
      if (!interstitialWouldShow(this.ref.global)) void maybeRequestReview(this.ref.global, stars)
    })
  }

  /**
   * "Congratulations!" over the live board, in the half-second before the win
   * card arrives. It sits here rather than on the card on purpose: the card is
   * already carrying the score, the stars and three buttons, and a congratulation
   * squeezed in among them reads as a label. On its own, over the confetti, it
   * reads as someone actually saying it.
   */
  private showCongratulations() {
    const f = contentFrame(this.scale.width, this.scale.height)
    // Below the scale, not across it. The balanced beam IS the achievement —
    // covering it at the exact moment it locks level trades the payoff for the
    // announcement of the payoff. The band under the pans is empty anyway.
    const label = this.add
      .text(f.cx, this.scale.height * 0.47, 'Congratulations!', {
        fontFamily: FONT,
        fontSize: `${Math.round(u(34))}px`,
        fontStyle: '800',
        color: CREAM_CSS,
      })
      .setOrigin(0.5)
      .setDepth(102) // above the confetti, below the card
    // Chunky ink outline — the same treatment as the buttons, and the only way
    // cream text stays readable over a busy board.
    label.setStroke(INK_CSS, u(7))
    label.setShadow(0, u(3), '#2B2440', 0, true, true)
    // One long word at a fixed size runs off a narrow phone; scale it to the
    // frame rather than let it clip. (The stroke grows the measured width, so
    // measure after it is applied.)
    const fit = Math.min(1, (f.ew - u(28)) / Math.max(label.width, 1))

    const fade = () =>
      this.tweens.add({
        targets: label,
        alpha: 0,
        duration: 220,
        onComplete: () => label.destroy(),
      })

    if (this.reducedMotion) {
      label.setScale(fit)
      this.time.delayedCall(700, fade)
      return
    }
    label.setScale(fit * 0.4)
    this.tweens.add({
      targets: label,
      scale: fit,
      duration: 380,
      ease: 'Back.easeOut',
      // Hold it just long enough to be read, then clear the way for the card.
      onComplete: () => this.time.delayedCall(260, fade),
    })
  }

  private showWinOverlay(stars: number, used: number) {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(100)

    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45)
    dim.setInteractive() // swallow taps behind the card

    const cardW = Math.min(w - u(48), u(360))
    const cardH = u(330)
    const cx = w / 2
    const cy = h * 0.44
    const card = this.add.graphics()
    card.fillStyle(INK, 1)
    card.fillRoundedRect(cx - cardW / 2, cy - cardH / 2 + u(6), cardW, cardH, u(26))
    card.fillStyle(PAPER, 1)
    card.fillRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, u(26))
    card.lineStyle(OUTLINE + u(1), INK, 1)
    card.strokeRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, u(26))

    const title = this.add
      .text(cx, cy - cardH / 2 + u(44), 'EXACTLY 67!', TEXT.ink(30, '800'))
      .setOrigin(0.5)

    // Three star slots; earned ones pop in.
    const starR = u(26)
    const starViews: Phaser.GameObjects.Graphics[] = []
    for (let i = 0; i < 3; i++) {
      const sg = this.add.graphics()
      const sx = cx + (i - 1) * (starR * 2.6)
      const sy = cy - cardH / 2 + u(108)
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

    const best = this.daily ? undefined : bestFor(progress(), this.ref.global)
    // Which of the level's winning placements this was. Most levels have exactly
    // one, and saying "the only way" is worth more than saying nothing; where
    // there are several, naming the one you found turns a clear into something
    // two players can compare. It gets its own line: appended with a middle dot
    // it wrapped at the card's width and left "way" stranded on a line alone.
    const ways = this.waysTotal
    const which = solutionIndex(this.ref.def, this.placed)
    const wayLine =
      ways > 1 && which !== null
        ? `\nway ${which} of ${ways}`
        : ways === 1
          ? '\nthe only way'
          : ''
    const summary =
      used <= this.minWeights
        ? `Solved with ${used} — the perfect minimum!${wayLine}`
        : `Solved with ${used} · minimum is ${this.minWeights}` +
          // The clear above is already recorded, so `best` can equal `used`;
          // only a better earlier run is worth naming.
          (best !== undefined && best < used ? ` · your best ${best}` : '') +
          wayLine
    const sub = this.add
      .text(cx, cy - cardH / 2 + u(156), summary, TEXT.ink(15, '600'))
      .setOrigin(0.5)
    sub.setColor(INK_SOFT)
    sub.setWordWrapWidth(cardW - u(40))
    sub.setAlign('center')
    // On a 320 pt phone the longest summary wraps to three lines and climbs into
    // the stars above; step the size down until it is back to two (or the floor).
    for (let size = 15; size > 12 && sub.getWrappedText(summary).length > 2; ) {
      size -= 1
      sub.setFontSize(`${Math.round(u(size))}px`)
    }

    // The Next/Map paths await an interstitial before navigating, leaving the
    // overlay live for a beat. Lock every button on the first press so a second
    // tap (e.g. Retry) can't queue a competing, mis-routed navigation.
    let overlayActed = false
    const once = (fn: () => void) => () => {
      if (overlayActed) return
      overlayActed = true
      fn()
    }

    const btnY = cy + cardH / 2 - u(56)
    const btnH = u(56)
    let nextBtn: Phaser.GameObjects.Container
    let retryBtn: Phaser.GameObjects.Container
    let mapBtn: Phaser.GameObjects.Container
    if (this.daily) {
      // Daily has no "next level": Done/Menu return home, Retry replays today.
      nextBtn = makeButton(this, 'Done', cardW * 0.42, btnH, 0xf5b942, '#2B2440', once(() => {
        this.scene.start('Menu')
      }))
      retryBtn = makeButton(this, 'Retry', cardW * 0.22, btnH, PAPER, '#2B2440', once(() => {
        this.scene.restart({ daily: true })
      }))
      mapBtn = makeButton(this, 'Menu', cardW * 0.2, btnH, PAPER, '#2B2440', once(() => {
        this.scene.start('Menu')
      }))
    } else {
      const hasNext = this.ref.global < TOTAL_LEVELS
      nextBtn = hasNext
        ? makeButton(this, 'Next', cardW * 0.42, btnH, 0xf5b942, '#2B2440', once(() => {
            this.leaveAfterClear(() => this.scene.restart({ level: this.ref.global + 1 }))
          }))
        : makeButton(this, 'The End!', cardW * 0.42, btnH, 0xf5b942, '#2B2440', once(() => {
            this.leaveAfterClear(() => this.scene.start('LevelMap', { scrollTo: this.ref.global }))
          }))
      retryBtn = makeButton(this, 'Retry', cardW * 0.22, btnH, PAPER, '#2B2440', once(() => {
        this.scene.restart({ level: this.ref.global })
      }))
      mapBtn = makeButton(this, 'Map', cardW * 0.2, btnH, PAPER, '#2B2440', once(() => {
        this.leaveAfterClear(() => this.scene.start('LevelMap', { scrollTo: this.ref.global }))
      }))
    }
    nextBtn.setPosition(cx + cardW * 0.24, btnY)
    retryBtn.setPosition(cx - cardW * 0.36, btnY)
    mapBtn.setPosition(cx - cardW * 0.13, btnY)

    // Share sits above the navigation row, not in it: the row is a decision
    // ("what next"), and mixing an optional action into it costs a mis-tap.
    // It is deliberately outside `once()` — sharing does not navigate, so it
    // must stay live after the sheet is dismissed.
    const kids: Phaser.GameObjects.GameObject[] = [dim, card, title, ...starViews, sub, nextBtn, retryBtn, mapBtn]
    // The share card is keyed by level number, which the daily board doesn't have — skip share there.
    if (!this.daily) {
      const shareBtn = makeButton(this, 'Share', cardW * 0.34, u(46), PAPER, '#2B2440', () =>
        void this.shareResult(used, stars, which),
      )
      shareBtn.setPosition(cx, btnY - u(62))
      kids.push(shareBtn)
    }
    overlay.add(kids)
    if (!this.reducedMotion) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 200 })
    }
  }

  /**
   * Hand the route to the OS share sheet. The card carries totals and glyphs
   * only — never a weight value — so posting it cannot spoil the level for the
   * person receiving it. See `game/share.ts`.
   */
  private async shareResult(used: number, starCount: number, which: number | null) {
    const seconds =
      this.startedAt === null ? undefined : (performance.now() - this.startedAt) / 1000
    const card = shareCard(
      {
        level: this.ref.global,
        pieces: used,
        stars: starCount,
        way: which ?? undefined,
        waysTotal: this.waysTotal,
        seconds,
      },
      this.trace,
    )
    const outcome = await shareText(card)
    if (outcome === 'copied') this.showToast('Copied — paste it anywhere')
    else if (outcome === 'unavailable') this.showToast('Sharing is not available here')
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
        this.scene.restart(this.daily ? { daily: true } : { level: this.ref.global })
      } else if ((key === 'n' || key === 'N') && this.wonState && !this.daily && this.ref.global < TOTAL_LEVELS) {
        this.scene.restart({ level: this.ref.global + 1 })
      } else if (key === 'm' || key === 'M') {
        setSoundEnabled(!soundEnabled())
        void saveSoundEnabled(soundEnabled())
        this.hudButtons.sound.refresh()
      } else if (key === 'Escape') {
        if (this.daily) this.scene.start('Menu')
        else this.scene.start('LevelMap', { scrollTo: this.ref.global })
      }
    })
  }
}
