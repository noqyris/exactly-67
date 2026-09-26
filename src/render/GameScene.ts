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
  playNear,
  playPlace,
  playPlaceBalloon,
  playRefuse,
  playRemove,
  playReward,
  playStarPop,
  playStreak,
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
import { progress } from '../services/progressStore'
import { shareText } from '../services/share'
import { maybeRequestReview, reviewWouldAsk } from '../services/review'
import { bestFor, isCleared } from '../game/progress'
import { JAR_AD_HINTS, JAR_CAPACITY, JAR_HINTS, PACK_AD_HINTS, PACK_HINTS, type RewardPlacement } from '../game/economy'
import {
  adsDecided,
  adsSettled,
  adsSupported,
  hintsUnlimited,
  grantHint,
  hasHint,
  hintCountValue,
  interstitialWouldShow,
  maybeShowInterstitial,
  noteCleared,
  rewardedAvailable,
  rewardedBusy,
  rewardedOffered,
  showBanner,
  useHint,
  watchRewarded,
  watchRewardedHint,
} from '../services/ads'
import type { InterstitialContext, RewardedOutcome } from '../services/ads'
import {
  claimHints,
  dailyDoneToday,
  isFirstRun,
  noAdsNudgeNow,
  noteNoAdsNudge,
  recordDailyWin,
  recordLevelWin,
  streak as currentStreak,
  welcomeOffered,
  type DailyWin,
  type LevelWin,
} from '../services/progression'
import {
  enableReminders,
  noteReminderOffered,
  reminderPermission,
  setReminderContext,
  shouldOfferReminders,
} from '../services/notifications'
import { signalOnboardingDone, splashFinished } from '../services/session'
import { welcomePrice } from '../services/iap'
import { saveDailyDone, saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, MAX_WIDE_W, prefersReducedMotion, safeArea, u } from './layout'
import { BG, CREAM_CSS, FONT, GOOD, INK, INK_CSS, OVER, OUTLINE, PAPER, STAR, UNDER } from './palette'
import { ScaleView } from './ScaleView'
import type { ScaleGeometry } from './ScaleView'
import {
  drawBackIcon,
  drawBellIcon,
  drawCard,
  drawFlame,
  drawHapticsIcon,
  drawHintIcon,
  drawJar,
  drawMedal,
  drawProgressBar,
  drawSoundIcon,
  drawStar,
  makeButton,
  makeIconButton,
  onTap,
  TEXT,
} from './ui'
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
  /**
   * The consent question has not been asked yet this session (a first run on
   * the early levels, whose ads wait for the tutorial to end): nothing was
   * declined, so videosOff would be untrue.
   */
  notReady: "Hint videos aren't ready yet — earn hints from the Star Jar, or grab a pack.",
  /** Today's hint videos are used up (the per-day cap in game/economy.ts). */
  capped: "That's today's hint videos. More tomorrow, or grab a pack.",
  earned: 'Hint earned!',
  /** No video was ever shown: no fill, a failed or slow load. True of each. */
  unavailable: 'No video available right now — try again soon',
  /** A video was handed over and did not pay out: closed early, or failed to present. */
  notEarned: "No hint this time — the ad didn't play to the end",
} as const

/** A reward the win card offers: the free amount, or `ad` for a rewarded video. */
interface WinReward {
  title: string
  icon: 'jar' | 'medal' | 'flame'
  medal?: 'bronze' | 'silver' | 'gold' | null
  /** Paid the moment the level is won (saved before the card shows), so closing
   *  the app on the win card can never lose it. */
  base: number
  /** The total with the rewarded video: the ad pays `ad - base` on top. */
  ad: number
  placement: RewardPlacement
  /** The ad upgrade was paid. */
  upgraded: boolean
  /** A video is loading or on screen: every other way out of the card waits. */
  busy: boolean
}

/** Everything the win card shows — kept so a claim or a fold can redraw it. */
interface WinCard {
  stars: number
  used: number
  which: number | null
  level?: LevelWin
  daily?: DailyWin
  reward: WinReward | null
  ctx: InterstitialContext
  remind: 'none' | 'offer' | 'on' | 'denied'
  nudge: boolean
  /** A navigation button was pressed: the card is on its way out. */
  acted: boolean
}

/** The pan counts as "close" within this many of 67 (a quiet tick). */
const NEAR_GAP = 3

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sep 21" for a past daily board. */
function dailyLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

/** iOS-style share glyph: a tray with an arrow leaving it. */
function drawShareIcon(g: Phaser.GameObjects.Graphics, size: number) {
  const s = size / 44
  g.lineStyle(3 * s, INK, 1)
  g.beginPath()
  g.moveTo(-6 * s, -2 * s)
  g.lineTo(-10 * s, -2 * s)
  g.lineTo(-10 * s, 12 * s)
  g.lineTo(10 * s, 12 * s)
  g.lineTo(10 * s, -2 * s)
  g.lineTo(6 * s, -2 * s)
  g.strokePath()
  g.lineBetween(0, 5 * s, 0, -13 * s)
  g.beginPath()
  g.moveTo(-5 * s, -8 * s)
  g.lineTo(0, -13 * s)
  g.lineTo(5 * s, -8 * s)
  g.strokePath()
}

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
  /** The Daily Challenge board's date (today, or a past day of this month). */
  private dailyDate = ''
  /** Opened as "today's puzzle" (not a calendar replay): a solve just past
   *  midnight still counts for the day the board belongs to. */
  private dailyAsToday = false
  /** Scale geometry of the current layout (cached: panTargets() runs every frame). */
  private geo!: ScaleGeometry
  /** Side-by-side layout (unfolded iPhone Duo, iPad landscape). */
  private wideMode = false
  /** Everything the win card shows, kept so a resize (a fold) can redraw it. */
  private win: WinCard | null = null
  private winOverlay: Phaser.GameObjects.Container | null = null
  private hintOverlay: Phaser.GameObjects.Container | null = null
  /** Whether the pan total sat within NEAR_GAP of 67 after the last change. */
  private wasNear = false

  constructor() {
    super('Game')
  }

  init(data: { level?: number; daily?: boolean; date?: string }) {
    this.daily = data.daily === true
    if (this.daily) {
      // Same puzzle for everyone on a date; a fake pack carries just a title
      // label. `date` is a past day of this month replayed from the calendar.
      const todayKeyNow = todayKey(new Date())
      this.dailyDate = data.date ?? todayKeyNow
      this.dailyAsToday = data.date === undefined || data.date === todayKeyNow
      const label = this.dailyDate === todayKeyNow ? "Today's puzzle" : dailyLabel(this.dailyDate)
      this.ref = {
        def: dailyLevelFor(this.dailyDate),
        pack: { id: 'daily', name: label, tagline: '', levels: [] } as LevelPack,
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
    this.win = null
    this.winOverlay = null
    this.hintOverlay = null
    this.wasNear = false
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
    this.scale.on('resize', this.onResize, this)
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this))
    this.bindKeyboard()

    // First run: Level 1 teaches itself. If the player has not touched anything
    // after a beat, the ghost demo shows the first move — free, no hint spent.
    if (!this.daily && this.ref.global === 1 && isFirstRun()) {
      // Counted from the moment the splash is gone, not from scene start: the
      // first run's Level 1 is built underneath the sting.
      // It repeats (3 times at most) until the first move: one two-second pass
      // is easy to miss while the eye is still finding the board.
      const board = this.sys
      const demo = (left: number) => {
        if (!board.isActive() || this.ref.global !== 1 || this.wonState || this.trace.length > 0) return
        const index = this.hintIndex()
        if (index != null) this.revealHintDemo(index, evaluate(this.ref.def, this.placed))
        if (left > 1) this.time.delayedCall(4200, () => demo(left - 1))
      }
      void splashFinished().then(() => {
        if (board.isActive()) this.time.delayedCall(1200, () => demo(3))
      })
    }

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

  /** The frame this scene lays out in: phone column, or the wide side-by-side one. */
  private frame() {
    const probe = contentFrame(this.scale.width, this.scale.height)
    return probe.wide ? contentFrame(this.scale.width, this.scale.height, MAX_WIDE_W) : probe
  }

  private scaleGeometry(): ScaleGeometry {
    const f = this.frame()
    const safe = safeArea()
    if (f.wide) {
      // Scale in the left half, tray in the right; the fold (the Duo's inner
      // screen creases down the middle) falls in the gutter between them.
      const { scaleX, colW } = this.wideColumns()
      const top = Math.max(f.oy, safe.top) + u(12) + u(46)
      const bottom = Math.min(f.oy + f.eh, this.scale.height - safe.bottom)
      const availH = bottom - top
      // The pans hang past the beam's ends: keep beam + half a pan inside the column.
      const panWidth = Math.min(colW * 0.27, u(190))
      const halfBeam = Math.min(colW * 0.34, u(240), colW / 2 - panWidth / 2 - u(6))
      return {
        cx: scaleX + colW / 2,
        cy: top + u(112) + Math.max(0, (availH - u(112) - Math.min(availH * 0.3, u(130))) * 0.2),
        halfBeam,
        ropeLen: Math.min(availH * 0.24, u(130)),
        panWidth,
        panHeight: panWidth * 0.22,
      }
    }
    const halfBeam = Math.min(f.ew * 0.33, u(240))
    const panWidth = Math.min(f.ew * 0.29, u(190))
    const panHeight = panWidth * 0.22
    const top = Math.max(f.oy, safe.top)
    // The beam tilts up to 13° (sin ≈ 0.23), so its ends sweep ±0.23·halfBeam
    // around the hub. Keep that sweep clear of the gap message under the total
    // chip — on a short or wide phone (iPhone SE, the folded iPhone Duo) the
    // proportional position alone put the tilted beam through the text.
    const messageBottom = top + u(12) + u(46) + u(48) + u(43) + u(22)
    const cy = Math.max(top + f.eh * 0.245, messageBottom + u(8) + halfBeam * 0.23)
    // …and keep the lower pan clear of the tray AND of the labels stacked just
    // above it (the budget / "use every weight" row, the level hint, both laid
    // out in layoutHud) by shortening the ropes if needed. Once the beam came
    // down on short phones, the dish landed on those words. The hint is fitted
    // before this runs (layoutAll), so a hint that still wraps is paid for.
    const level = this.ref.def
    const hintH = this.hintText ? this.hintText.height : u(22)
    const band =
      u(12) +
      (level.maxWeights !== undefined || level.useAll ? u(24) : 0) +
      (level.hint ? Math.max(u(26), hintH + u(4)) : 0)
    const trayTop = f.oy + f.eh * 0.635
    const ropeLen = Math.max(u(40), Math.min(f.eh * 0.14, u(130), trayTop - band - cy - halfBeam * 0.23 - panHeight))
    return { cx: f.cx, cy, halfBeam, ropeLen, panWidth, panHeight }
  }

  /** Wide layout columns: outer margins, a gutter over the fold, two equal halves. */
  private wideColumns(): { scaleX: number; trayX: number; colW: number } {
    const f = this.frame()
    const safe = safeArea()
    const margin = Math.max(u(16), safe.left, safe.right)
    const gutter = u(28)
    const colW = (f.ew - margin * 2 - gutter) / 2
    return { scaleX: f.ox + margin, trayX: f.ox + margin + colW + gutter, colW }
  }

  /**
   * A resize: a fold or unfold of the iPhone Duo, a Split View change, a desktop
   * window. The board keeps its state (weights are steered, never re-created);
   * overlays built for the old size are redrawn for the new one.
   */
  private onResize() {
    this.layoutAll()
    if (this.winOverlay && this.win) {
      this.winOverlay.destroy()
      this.winOverlay = null
      this.showWinOverlay(false)
    }
    if (this.hintOverlay && !this.hintBusy) {
      this.hintOverlay.destroy()
      this.hintOverlay = null
      this.showHintMenu()
    }
  }

  private layoutAll() {
    const h = this.scale.height
    const f = this.frame()
    const safe = safeArea()
    // The hint first: the portrait scale shortens its ropes to clear whatever
    // height it ends up (scaleGeometry). Portrait wraps it to the tray, inset
    // like the budget row beside it.
    this.fitHint(f.wide ? f.ew / 2 - u(20) : f.ew - Math.max(u(12), safe.left, safe.right) * 2 - u(12))
    const geo = this.scaleGeometry()
    this.geo = geo
    this.wideMode = f.wide
    this.scaleView.layout(geo)
    this.panScale = Math.min(1, (geo.panWidth * 0.34) / u(84))

    if (f.wide) {
      const { trayX, colW } = this.wideColumns()
      const top = Math.max(f.oy, safe.top) + u(12) + u(46) + u(40)
      const trayBottom = Math.min(f.oy + f.eh, h - safe.bottom) - u(10)
      this.tray = { x: trayX, y: top, width: colW, height: trayBottom - top, homes: [] }
    } else {
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
    }
    this.drawTray()
    this.computeTrayHomes()

    // Drop anywhere in the scale's half of the screen counts as the pan.
    const anchor = this.scaleView.rightPanAnchor()
    const zoneTop = geo.cy - geo.halfBeam * 0.6
    this.dropZone = f.wide
      ? new Phaser.Geom.Rectangle(f.ox, zoneTop, f.ew / 2, h - zoneTop)
      : new Phaser.Geom.Rectangle(
          anchor.x - geo.panWidth * 0.9,
          zoneTop,
          geo.panWidth * 1.8,
          this.tray.y - zoneTop - u(8),
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
    const cols = this.wideMode ? this.bestTrayCols(n) : n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : Math.ceil(n / 3)
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

  /** Wide tray (tall and narrow): the column count that makes the pieces biggest. */
  private bestTrayCols(n: number): number {
    const pad = u(10)
    const size = u(84)
    let best = 1
    let bestScale = 0
    for (let cols = 1; cols <= Math.min(n, 6); cols++) {
      const rows = Math.ceil(n / cols)
      const cellW = (this.tray.width - pad * 2) / cols
      const cellH = (this.tray.height - pad * 2) / rows
      const scale = Math.min(1, (cellW * 0.82) / size, (cellH * 0.72) / (size * 1.4))
      if (scale > bestScale + 1e-6) {
        bestScale = scale
        best = cols
      }
    }
    return best
  }

  // ------------------------------------------------------------------ HUD

  private buildHud() {
    this.levelText = this.add.text(0, 0, '', TEXT.ink(20)).setOrigin(0.5, 0)
    this.packText = this.add.text(0, 0, '', TEXT.ink(13, '600')).setOrigin(0.5, 0)
    this.packText.setColor(INK_SOFT)
    this.totalChipG = this.add.graphics()
    this.totalText = this.add.text(0, 0, '0', TEXT.ink(40, '800')).setOrigin(0.5)
    this.gapText = this.add.text(0, 0, '', TEXT.ink(16, '600')).setOrigin(0.5, 0)
    // Cream on a thick ink stroke, like the win-card notes: on a short phone the
    // toast can sit over the lower pan, and ink-on-board text would vanish there.
    this.toastText = this.add.text(0, 0, '', TEXT.cream(15, '800')).setOrigin(0.5).setAlpha(0)
    this.toastText.setStroke(INK_CSS, u(5))
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
      // Centred line by line: on a 320 pt phone the longest hint still wraps.
      this.hintText.setColor(INK_SOFT).setAlign('center')
    }

    const size = u(46)
    const back = makeIconButton(this, size, (g, s) => drawBackIcon(g, s), () => {
      // Always a data object: Phaser keeps a scene's previous data on a bare start().
      if (this.daily) this.scene.start('Daily', {})
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
      // consent, or has used today's hint videos, gets none, so their spent
      // bulb must not advertise one.
      (g, s) => drawHintIcon(g, s, hintsUnlimited() || hasHint() ? 'have' : rewardedAvailable('hint') ? 'empty' : 'spent'),
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
    const f = this.frame()
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
    this.levelText.setText(this.daily ? 'Daily 67' : `Level ${this.ref.global}`)
    this.packText.setPosition(f.cx, top + u(24))
    this.packText.setText(this.ref.pack.name)

    // Total chip sits between the HUD row and the beam (over the scale's column
    // in the wide layout); the gap message hangs just below it.
    const chipX = this.wideMode ? this.geo.cx : f.cx
    const chipY = top + size + u(48)
    this.totalText.setPosition(chipX, chipY)
    this.gapText.setPosition(chipX, chipY + u(43)).setOrigin(0.5, 0)

    const constraintY = this.tray.y - u(16)
    this.budgetText?.setPosition(this.tray.x + u(6), constraintY)
    this.useAllText?.setPosition(this.tray.x + this.tray.width - u(6), constraintY)
    const trayCx = this.tray.x + this.tray.width / 2
    // Portrait: anchored by its bottom, so a hint that still wraps grows up,
    // into the band scaleGeometry keeps clear, never down onto the budget row.
    if (this.wideMode) this.hintText?.setOrigin(0.5).setPosition(chipX, this.scale.height - safe.bottom - u(28))
    else this.hintText?.setOrigin(0.5, 1).setPosition(trayCx, this.tray.y - (this.budgetText || this.useAllText ? u(28) : u(6)))
    this.toastText.setPosition(this.wideMode ? chipX : trayCx, this.wideMode ? chipY + u(80) : this.tray.y - u(60))
    this.toastText.setWordWrapWidth((this.wideMode ? f.ew / 2 : this.tray.width) - u(20))
    this.toastText.setAlign('center')
  }

  /**
   * Wrap the level hint to `wrapW`, stepping its font down (15 → 13) while it
   * still wraps. On a 320 pt phone every tutorial hint runs to two lines at 15,
   * and each extra line is height the pans above it have to give up.
   */
  private fitHint(wrapW: number) {
    const t = this.hintText
    const hint = this.ref.def.hint
    if (!t || !hint) return
    t.setWordWrapWidth(wrapW)
    for (let size = 15; size >= 13; size--) {
      t.setFontSize(`${Math.round(u(size))}px`)
      if (t.getWrappedText(hint).length <= 1) break
    }
  }

  private drawTotalChip(color: number) {
    const chipW = u(132)
    const chipH = u(66)
    const x = this.totalText.x - chipW / 2
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
    // rewardedBusy(): a video started elsewhere (the win card's, before a
    // restart reset hintBusy) is still loading or on screen.
    if (this.hintBusy || this.wonState || rewardedBusy()) return
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
    this.hintOverlay = overlay
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hintOverlay === overlay) this.hintOverlay = null
    })
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
    for (const text of [HINT_COPY.body(0), HINT_COPY.body(99), HINT_COPY.videosOff, HINT_COPY.notReady, HINT_COPY.capped]) {
      body.setText(text)
      bodyBox = Math.max(bodyBox, body.height)
    }

    // The full ladder (packs + the unlimited unlock + restore) lives on the
    // Store screen; this modal stays a quick "earn one now" and just links out.
    // While the one-time Welcome pack is on offer, the link names it — the
    // contextual moment (out of hints, mid-board) is where it is worth most.
    const welcome = welcomeOffered() ? welcomePrice() : null
    const upsell = this.add
      .text(cx, 0, welcome ? `Welcome pack: 25 hints for ${welcome} ›` : 'More hints in the Store ›', TEXT.ink(12, '700'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setPadding({ x: u(12), y: u(10) })
      .setInteractive({ useHandCursor: true })
    onTap(upsell, () => {
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
      // Offered (consent) AND not capped for today: only then is there a video.
      const consent = rewardedOffered()
      const offered = consent && rewardedAvailable('hint')
      // No consent yet is not a "declined" until the question has been asked.
      const off = adsSupported() && !adsDecided() ? HINT_COPY.notReady : HINT_COPY.videosOff
      body.setText(offered ? HINT_COPY.body(hintCountValue()) : consent ? HINT_COPY.capped : off)
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
    // Opened before the consent question was settled: redraw once it is, so a
    // yes brings the watch button and a no replaces "not ready yet" with why.
    if (!adsDecided()) void adsSettled().then(refresh)

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
    void maybeShowInterstitial(this.ref.global, this.win?.ctx).finally(go)
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
    // "Close" is felt before it is read: one quiet tick on entering the band.
    const near = !ev.balanced && placedCount(this.placed) > 0 && Math.abs(ev.gap) <= NEAR_GAP
    if (near && !this.wasNear) {
      playNear()
      placeTap()
    }
    this.wasNear = near
    if (ev.balanced && !ev.won && ev.blockedReason === 'use-all') {
      this.showToast('Balanced — but every weight must be aboard!')
    }
    if (ev.won && !this.wonState) this.winSequence()
  }

  /** Pan layout: blocks stack in the dish, balloons bob above the rim. */
  private panTargets(): Map<number, { x: number; y: number; scale: number }> {
    const targets = new Map<number, { x: number; y: number; scale: number }>()
    const anchor = this.scaleView.rightPanAnchor()
    const geo = this.geo

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
    this.dismissHintDemo()

    const used = placedCount(this.placed)
    const stars = starsForClear(used, this.minWeights)
    const which = solutionIndex(this.ref.def, this.placed)
    let reward: WinReward | null = null
    let level: LevelWin | undefined
    let daily: DailyWin | undefined
    if (this.daily) {
      if (this.dailyDate === todayKey(new Date())) void saveDailyDone(this.dailyDate)
      daily = recordDailyWin(this.dailyDate, this.dailyAsToday)
      const m = daily.milestone
      if (m && m.hints > 0 && !hintsUnlimited()) {
        reward = { title: `${m.day}-day streak!`, icon: 'flame', base: m.hints, ad: m.hints * 2, placement: 'milestone', upgraded: false, busy: false }
      }
    } else {
      level = recordLevelWin(this.ref.global, stars, used)
      const jarBase = level.opened * JAR_HINTS
      const jarAd = level.opened * JAR_AD_HINTS
      if (level.pack?.reward) {
        reward = {
          title: `${level.pack.name} complete!`,
          icon: 'medal',
          medal: level.pack.medal,
          base: PACK_HINTS + jarBase,
          ad: PACK_AD_HINTS + jarAd,
          placement: 'pack',
          upgraded: false,
          busy: false,
        }
      } else if (level.opened > 0) {
        reward = { title: 'Star Jar full!', icon: 'jar', base: jarBase, ad: jarAd, placement: 'jar', upgraded: false, busy: false }
      }
    }
    noteCleared() // count this clear toward the interstitial cadence
    // Pay the free part of any reward NOW, right after the state that earned it
    // was saved (the emptied jar, the pack marked paid, the milestone): a player
    // who closes the app on the win card keeps it. The video only adds on top.
    if (reward) claimHints(reward.base)

    // A clear whose card offers a rewarded upgrade never also gets an
    // interstitial: two ad prompts on one win is the double tax players hate.
    const ctx: InterstitialContext = { rewardPrompt: reward !== null }
    const adFollows = !this.daily && interstitialWouldShow(this.ref.global, ctx)
    const reviewAsks = !this.daily && !adFollows && !reward && reviewWouldAsk(this.ref.global, stars)
    const remind = this.daily
      ? shouldOfferReminders('daily-clear')
      : !reward && !adFollows && !reviewAsks && shouldOfferReminders('level-clear', stars, this.ref.global)
    const nudge = !this.daily && !remind && !adFollows && noAdsNudgeNow()
    if (remind) noteReminderOffered()
    if (nudge) noteNoAdsNudge()
    // Each of those asks was made on the promise that no ad follows. Freeze that
    // answer: leaveAfterClear re-runs the gate at the Next/Map tap, by which time
    // the warm-up or the spacing floor may have run out and opened it.
    ctx.cardAsk = remind || reviewAsks || nudge

    this.win = {
      stars,
      used,
      which,
      level,
      daily,
      reward,
      ctx,
      remind: remind ? 'offer' : 'none',
      nudge,
      acted: false,
    }
    this.pushReminderContext()

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
      this.showWinOverlay(true)
    })
    // Ask for a store rating at the delight peak — after the jingle + star pop,
    // once ever, on an engaged/happy moment. Never paired with an interstitial,
    // a reward to claim or another ask on the same win: review.ts is one-shot and
    // unconsumed when skipped, so it simply defers to the next clean win.
    if (reviewAsks) this.time.delayedCall(1800, () => void maybeRequestReview(this.ref.global, stars))
  }

  /** Hand the reminder planner the latest facts (streak, today's daily, next level). */
  private pushReminderContext() {
    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const s = currentStreak()
    setReminderContext({ streak: s.current, dailyDoneToday: dailyDoneToday(), nextLevel: next, freezes: s.freezes })
  }

  /**
   * "Congratulations!" over the live board, in the half-second before the win
   * card arrives. It sits here rather than on the card on purpose: the card is
   * already carrying the score, the stars and three buttons, and a congratulation
   * squeezed in among them reads as a label. On its own, over the confetti, it
   * reads as someone actually saying it.
   */
  private showCongratulations() {
    const f = this.frame()
    // Below the scale, not across it. The balanced beam IS the achievement —
    // covering it at the exact moment it locks level trades the payoff for the
    // announcement of the payoff. The band under the pans is empty anyway.
    const words = !this.daily && this.ref.global === 67 ? 'Six-seven!' : 'Congratulations!'
    const x = this.wideMode ? this.geo.cx : f.cx
    const label = this.add
      .text(x, this.wideMode ? this.geo.cy + this.geo.ropeLen + u(70) : this.scale.height * 0.47, words, {
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
    const fit = Math.min(1, ((this.wideMode ? f.ew / 2 : f.ew) - u(28)) / Math.max(label.width, 1))

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

  /**
   * A tween that dies with `owner`. The win card is torn down and redrawn under
   * its own tweens (a claim tapped mid-animation, a reminder answer, a fold),
   * and a tween left running on a destroyed Text calls setText on a released
   * canvas, which throws inside Phaser's step and freezes the game. One that
   * loops (Next's pulse) would also outlive every redraw.
   */
  private tweenWith(owner: Phaser.GameObjects.GameObject, tween: Phaser.Tweens.Tween): Phaser.Tweens.Tween {
    owner.once(Phaser.GameObjects.Events.DESTROY, () => tween.stop())
    return tween
  }

  /** Redraw the win card in place (a claim landed, an ad settled, a reminder answer). */
  private redrawWin() {
    if (!this.win) return
    this.winOverlay?.destroy()
    this.winOverlay = null
    this.showWinOverlay(false)
  }

  /**
   * The win card, drawn from `this.win`. Rows, top to bottom: title, stars, the
   * summary, the progress row (Star Jar, or the streak for a daily), an optional
   * reward to claim, an optional quiet extra (reminders / no-ads link), and the
   * navigation row with Next as the biggest target in the thumb zone. `animate`
   * is true only for the first draw; redraws (claims, a fold) are instant.
   */
  private showWinOverlay(animate: boolean) {
    const win = this.win
    if (!win) return
    const anim = animate && !this.reducedMotion
    const w = this.scale.width
    const h = this.scale.height
    const safe = safeArea()
    const overlay = this.add.container(0, 0).setDepth(100)
    this.winOverlay = overlay

    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45)
    dim.setInteractive() // swallow taps behind the card

    const cardW = Math.min(w - u(40), u(372))
    const cx = w / 2

    // --- measure rows first, so the card is exactly as tall as what it holds.
    const summaryText = this.winSummary(win)
    const sub = this.add.text(cx, 0, summaryText, TEXT.ink(15, '600')).setOrigin(0.5, 0)
    sub.setColor(INK_SOFT).setWordWrapWidth(cardW - u(40)).setAlign('center')
    // On a 320 pt phone the longest summary wraps to three lines; step it down.
    for (let size = 15; size > 12 && sub.getWrappedText(summaryText).length > 2; ) {
      size -= 1
      sub.setFontSize(`${Math.round(u(size))}px`)
    }
    const showMeta = this.daily || !hintsUnlimited()
    const rows = {
      top: u(22),
      title: u(40),
      stars: u(70),
      sub: sub.height + u(10),
      meta: showMeta ? u(46) : 0,
      reward: win.reward ? u(104) : 0,
      extra: win.remind !== 'none' ? u(70) : win.nudge ? u(34) : 0,
      nav: u(56) + u(22),
    }
    const cardH = Object.values(rows).reduce((a, b) => a + b, 0) + u(8)
    const avail = h - safe.top - safe.bottom
    const cy = safe.top + Math.max(cardH / 2 + u(8), Math.min(avail * 0.46, avail - cardH / 2 - u(8)))
    const top = cy - cardH / 2

    const card = this.add.graphics()
    drawCard(card, cx - cardW / 2, top, cardW, cardH, u(26))

    let y = top + rows.top
    const titleWords = this.daily ? 'DAILY 67!' : this.ref.global === 67 ? 'SIX-SEVEN!' : 'EXACTLY 67!'
    const title = this.add.text(cx, y + rows.title / 2, titleWords, TEXT.ink(30, '800')).setOrigin(0.5)
    y += rows.title

    // Three star slots; earned ones pop in with a rising pitch.
    const starR = u(26)
    const starViews: Phaser.GameObjects.Graphics[] = []
    for (let i = 0; i < 3; i++) {
      const sg = this.add.graphics()
      drawStar(sg, 0, 0, i === 1 ? starR * 1.25 : starR, i < win.stars)
      sg.setPosition(cx + (i - 1) * (starR * 2.6), y + rows.stars / 2)
      if (i < win.stars && anim) {
        sg.setScale(0)
        this.tweenWith(
          sg,
          this.tweens.add({
            targets: sg,
            scale: 1,
            delay: 150 + i * 180,
            duration: 320,
            ease: 'Back.easeOut',
            onStart: () => playStarPop(i),
          }),
        )
      } else if (i < win.stars && animate) {
        this.time.delayedCall(150 + i * 180, () => {
          if (sg.active) playStarPop(i)
        })
      }
      starViews.push(sg)
    }
    y += rows.stars

    sub.setY(y)
    y += rows.sub

    const kids: Phaser.GameObjects.GameObject[] = [dim, card, title, ...starViews, sub]

    if (rows.meta) {
      kids.push(...(this.daily ? this.streakRow(win, cx, y, cardW, anim) : this.jarRow(win, cx, y, cardW, anim)))
      y += rows.meta
    }
    if (win.reward) {
      kids.push(...this.rewardRow(win.reward, cx, y, cardW))
      y += rows.reward
    }
    if (win.remind !== 'none') {
      kids.push(...this.remindRow(win, cx, y, cardW))
      y += rows.extra
    } else if (win.nudge) {
      const link = this.add
        .text(cx, y + rows.extra / 2, 'Remove ads between levels', TEXT.ink(13, '700'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
        .setPadding({ x: u(16), y: u(12) })
        .setInteractive({ useHandCursor: true })
      // Armed: a press on Next or Map that slides up here must not open the Store.
      onTap(link, () => {
        if (win.acted || win.reward?.busy) return
        this.scene.pause()
        this.scene.launch('Store', { returnTo: 'Game' })
      })
      kids.push(link)
      y += rows.extra
    }

    // Navigation. Every way out first pays any unclaimed free reward — a reward
    // is never lost to a tap on Next — and is locked while a video is up.
    const btnY = top + cardH - rows.nav / 2 - u(4)
    const btnH = u(56)
    const once = (fn: () => void) => () => {
      if (win.acted || win.reward?.busy) return
      win.acted = true
      signalOnboardingDone()
      fn()
    }
    const inner = cardW - u(32)
    let nextBtn: Phaser.GameObjects.Container
    const navKids: Phaser.GameObjects.Container[] = []
    if (this.daily) {
      const calW = inner * 0.42
      const doneW = inner - calW - u(10)
      const cal = makeButton(this, 'Calendar', calW, btnH, PAPER, '#2B2440', once(() => this.scene.start('Daily', {})))
      cal.setPosition(cx - cardW / 2 + u(16) + calW / 2, btnY)
      nextBtn = makeButton(this, 'Done', doneW, btnH, 0xf5b942, '#2B2440', once(() => this.scene.start('Menu')))
      nextBtn.setPosition(cx + cardW / 2 - u(16) - doneW / 2, btnY)
      navKids.push(cal, nextBtn)
    } else {
      const smallW = inner * 0.22
      const nextW = inner - smallW * 2 - u(20)
      const hasNext = this.ref.global < TOTAL_LEVELS
      const retry = makeButton(this, 'Retry', smallW, btnH, PAPER, '#2B2440', once(() => {
        this.scene.restart({ level: this.ref.global })
      }))
      const map = makeButton(this, 'Map', smallW, btnH, PAPER, '#2B2440', once(() => {
        this.leaveAfterClear(() => this.scene.start('LevelMap', { scrollTo: this.ref.global }))
      }))
      nextBtn = makeButton(this, hasNext ? 'Next' : 'The End!', nextW, btnH, 0xf5b942, '#2B2440', once(() => {
        this.leaveAfterClear(() =>
          hasNext ? this.scene.restart({ level: this.ref.global + 1 }) : this.scene.start('LevelMap', { scrollTo: this.ref.global }),
        )
      }))
      const left = cx - cardW / 2 + u(16)
      retry.setPosition(left + smallW / 2, btnY)
      map.setPosition(left + smallW * 1.5 + u(10), btnY)
      nextBtn.setPosition(cx + cardW / 2 - u(16) - nextW / 2, btnY)
      navKids.push(retry, map, nextBtn)

      // Share: a small corner button — sharing does not navigate, so it stays
      // live after the sheet is dismissed, and it is kept out of the nav row.
      const share = makeIconButton(this, u(40), (g, sz) => drawShareIcon(g, sz), () => {
        void this.shareResult(win.used, win.stars, win.which)
      })
      share.setPosition(cx + cardW / 2 - u(30), top + u(30))
      kids.push(share)
    }
    kids.push(...navKids)
    overlay.add(kids)

    // One more level is the whole loop: once the card has settled, Next breathes.
    if (!this.reducedMotion) {
      this.tweenWith(
        nextBtn,
        this.tweens.add({
          targets: nextBtn,
          scale: { from: 1, to: 1.05 },
          duration: 620,
          delay: animate ? 1500 : 0,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
      )
    }
    if (anim) {
      overlay.setAlpha(0)
      this.tweenWith(overlay, this.tweens.add({ targets: overlay, alpha: 1, duration: 200 }))
    }
    // Still this card, still up, and no video started over it meanwhile (a
    // redraw keeps `win`, so the chime survives a fold but not a claim tap).
    if (animate && win.reward) {
      this.time.delayedCall(900, () => {
        if (this.win === win && !win.acted && !win.reward?.busy) playReward()
      })
    }
  }

  /** The card's one-line summary (plus "the only way" / "way 2 of 3"). */
  private winSummary(win: WinCard): string {
    const best = this.daily ? undefined : bestFor(progress(), this.ref.global)
    const ways = this.waysTotal
    const wayLine =
      ways > 1 && win.which !== null ? `\nway ${win.which} of ${ways}` : ways === 1 ? '\nthe only way' : ''
    if (win.used <= this.minWeights) return `Solved with ${win.used} — the perfect minimum!${wayLine}`
    // Below 3★ the honest near-miss is the reason to replay: say the gap.
    return (
      `Used ${win.used} · minimum is ${this.minWeights}` +
      (best !== undefined && best < win.used ? ` · your best ${best}` : '') +
      wayLine
    )
  }

  /** Star Jar progress: the new stars pour in; a full jar is the reward row below. */
  private jarRow(win: WinCard, cx: number, y: number, cardW: number, anim: boolean): Phaser.GameObjects.GameObject[] {
    const lv = win.level
    if (!lv) return []
    const left = cx - cardW / 2 + u(22)
    const icon = this.add.graphics()
    const rowY = y + u(20)
    drawJar(icon, left + u(14), rowY, u(30), 1)
    const barX = left + u(38)
    const barW = cardW - u(44) - u(38) - u(64)
    const bar = this.add.graphics()
    const label = this.add
      .text(barX + barW + u(10), rowY, '', TEXT.ink(14, '800'))
      .setOrigin(0, 0.5)
    const gainText = lv.gained > 0 ? `+${lv.gained}★` : ''
    const caption = this.add
      .text(barX, rowY - u(19), gainText ? `Star Jar ${gainText}` : 'Star Jar', TEXT.ink(11, '700'))
      .setOrigin(0, 0.5)
      .setColor(INK_SOFT)
    const from = lv.jarBefore / JAR_CAPACITY
    const to = lv.opened > 0 ? 1 : lv.jarAfter / JAR_CAPACITY
    const draw = (frac: number) => {
      // The card can be redrawn under the pour (see tweenWith): never write to a dead row.
      if (!label.active || !bar.active) return
      bar.clear()
      drawProgressBar(bar, barX, rowY - u(8), barW, u(16), frac)
      label.setText(lv.opened > 0 && frac >= 1 ? 'Full!' : `${Math.round(frac * JAR_CAPACITY)}/${JAR_CAPACITY}`)
    }
    if (anim && to !== from) {
      draw(from)
      this.tweenWith(
        label,
        this.tweens.addCounter({ from, to, delay: 700, duration: 650, ease: 'Cubic.easeOut', onUpdate: (t) => draw(t.getValue() ?? to) }),
      )
    } else {
      draw(to)
    }
    return [icon, bar, label, caption]
  }

  /** The daily's streak line: the flame catches for today's first solve. */
  private streakRow(win: WinCard, cx: number, y: number, cardW: number, anim: boolean): Phaser.GameObjects.GameObject[] {
    const d = win.daily
    if (!d) return []
    const rowY = y + u(22)
    const flame = this.add.graphics()
    const text = d.counted
      ? `${d.streak}-day streak!`
      : `${d.month.solved}/${d.month.days} days this month`
    const label = this.add.text(0, rowY, text, TEXT.ink(18, '800')).setOrigin(0, 0.5)
    const size = u(30)
    // A trophy takes a slot at the card's right edge: flame + label centre in
    // what is left, and the label shrinks to fit it. On a 320 pt phone "30/31
    // days this month" centred on the whole card ran under the medal.
    const rowLeft = cx - cardW / 2 + u(22)
    const rowRight = cx + cardW / 2 - (d.trophy ? u(56) : u(22))
    const maxLabel = rowRight - rowLeft - size - u(8)
    if (label.width > maxLabel) label.setScale(maxLabel / label.width)
    const total = size + u(8) + label.displayWidth
    const x0 = (rowLeft + rowRight) / 2 - total / 2
    drawFlame(flame, 0, 0, size, d.counted || d.streak > 0)
    flame.setPosition(x0 + size / 2, rowY)
    label.setX(x0 + size + u(8))
    const out: Phaser.GameObjects.GameObject[] = [flame, label]
    if (d.trophy) {
      const medal = this.add.graphics()
      drawMedal(medal, 0, 0, u(28), d.trophy)
      medal.setPosition(cx + cardW / 2 - u(34), rowY)
      out.push(medal)
    }
    if (anim && d.counted) {
      flame.setScale(0.2)
      this.tweenWith(
        flame,
        this.tweens.add({ targets: flame, scale: 1, delay: 650, duration: 420, ease: 'Back.easeOut', onStart: () => playStreak() }),
      )
    }
    return out
  }

  /** A reward, already paid; a rewarded video adds more on top. */
  private rewardRow(r: WinReward, cx: number, y: number, cardW: number): Phaser.GameObjects.GameObject[] {
    const panelX = cx - cardW / 2 + u(14)
    const panelW = cardW - u(28)
    const panelH = u(94)
    const panel = this.add.graphics()
    panel.fillStyle(0xfff1c7, 1)
    panel.fillRoundedRect(panelX, y, panelW, panelH, u(18))
    panel.lineStyle(u(3), INK, 1)
    panel.strokeRoundedRect(panelX, y, panelW, panelH, u(18))
    const icon = this.add.graphics()
    const iconX = panelX + u(30)
    const titleY = y + u(24)
    if (r.icon === 'jar') drawJar(icon, iconX, titleY, u(30), 1)
    else if (r.icon === 'medal') drawMedal(icon, iconX, titleY, u(34), r.medal ?? 'bronze')
    else drawFlame(icon, iconX, titleY, u(28), true)
    const paid = r.upgraded ? r.ad : r.base
    const title = this.add.text(panelX + u(54), titleY - u(8), r.title, TEXT.ink(15, '800')).setOrigin(0, 0.5)
    const got = this.add
      .text(panelX + u(54), titleY + u(12), `+${paid} hint${paid === 1 ? '' : 's'} added ✓`, TEXT.ink(13, '800'))
      .setOrigin(0, 0.5)
      .setColor(GOOD_CSS)
    const maxTitle = panelW - u(64)
    if (title.width > maxTitle) title.setScale(maxTitle / title.width)
    const out: Phaser.GameObjects.GameObject[] = [panel, icon, title, got]
    const extra = r.ad - r.base
    if (r.upgraded || extra <= 0 || !rewardedAvailable(r.placement)) return out
    // The label names the ad AND the reward (Unity's rewarded policy).
    const ad = makeButton(this, r.busy ? 'Loading…' : `Watch ad: +${extra} more`, panelW - u(24), u(40), 0xf5b942, '#2B2440', () =>
      void this.claimWithAd(r),
    )
    ad.setPosition(cx, y + u(68))
    if (r.busy) ad.setAlpha(0.6).disableInteractive()
    out.push(ad)
    return out
  }

  private async claimWithAd(r: WinReward) {
    // rewardedBusy(): another full-screen ad is still loading or closing.
    if (r.busy || r.upgraded || this.win?.acted || rewardedBusy()) return
    r.busy = true
    this.redrawWin()
    let outcome: RewardedOutcome = 'unavailable'
    try {
      outcome = await watchRewarded(r.placement)
    } finally {
      r.busy = false
    }
    // Pay first: a video watched to the end is owed its reward wherever the
    // player is now.
    if (outcome === 'earned') {
      r.upgraded = true
      claimHints(r.ad - r.base)
    }
    if (!this.sys.isActive()) return
    if (outcome === 'earned') playReward()
    this.redrawWin()
    if (outcome !== 'earned') {
      this.showWinNote(outcome === 'unavailable' ? 'No video right now — your hints are safe' : "The ad didn't finish — your hints are safe")
    }
  }

  /** The reminder offer: an inline button, never a pop-up (Apple's "ask in context"). */
  private remindRow(win: WinCard, cx: number, y: number, cardW: number): Phaser.GameObjects.GameObject[] {
    const rowY = y + u(22)
    if (win.remind === 'on' || win.remind === 'denied') {
      const msg =
        win.remind === 'on' ? 'Reminders on — see you tomorrow' : 'Allow notifications in Settings → Exactly 67'
      const t = this.add.text(cx, rowY + u(8), msg, TEXT.ink(13, '700')).setOrigin(0.5).setColor(win.remind === 'on' ? GOOD_CSS : INK_SOFT)
      t.setWordWrapWidth(cardW - u(40)).setAlign('center')
      return [t]
    }
    const btnW = Math.min(cardW - u(60), u(250))
    const bell = this.add.graphics()
    const b = makeButton(this, '     Remind me daily', btnW, u(40), 0xd0ebff, '#2B2440', () => void this.acceptReminders(win))
    b.setPosition(cx, rowY)
    drawBellIcon(bell, u(30), true)
    bell.setPosition(cx - btnW / 2 + u(28), rowY)
    const caption = this.add
      .text(cx, rowY + u(34), 'One nudge a day, around when you play. Off anytime.', TEXT.ink(11, '600'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
    return [b, bell, caption]
  }

  private async acceptReminders(win: WinCard) {
    if (win.acted) return
    const granted = await enableReminders()
    if (granted) {
      win.remind = 'on'
    } else {
      win.remind = (await reminderPermission()) === 'denied' ? 'denied' : 'none'
    }
    if (this.sys.isActive()) this.redrawWin()
  }

  /** A short note just under the win card (the scene toast sits behind it). */
  private showWinNote(message: string) {
    const note = this.add
      .text(this.scale.width / 2, this.scale.height - safeArea().bottom - u(40), message, TEXT.cream(15, '700'))
      .setOrigin(0.5)
      .setDepth(130)
    note.setStroke(INK_CSS, u(5))
    this.tweens.add({ targets: note, alpha: 0, delay: 1800, duration: 350, onComplete: () => note.destroy() })
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
        this.scene.restart(this.daily ? { daily: true, date: this.dailyDate } : { level: this.ref.global })
      } else if ((key === 'n' || key === 'N') && this.wonState && !this.daily && this.ref.global < TOTAL_LEVELS) {
        this.scene.restart({ level: this.ref.global + 1 })
      } else if (key === 'm' || key === 'M') {
        setSoundEnabled(!soundEnabled())
        void saveSoundEnabled(soundEnabled())
        this.hudButtons.sound.refresh()
      } else if (key === 'Escape') {
        if (this.daily) this.scene.start('Daily', {})
        else this.scene.start('LevelMap', { scrollTo: this.ref.global })
      }
    })
  }
}
