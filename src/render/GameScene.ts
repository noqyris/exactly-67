import Phaser from 'phaser'
import { beamAngleDeg } from '../game/balance'
import { levelByGlobal, PACKS, TOTAL_LEVELS } from '../game/levels'
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
import { TARGET } from '../game/types'
import {
  playCelebration,
  playCloser,
  playHintChime,
  playLock,
  playPlace,
  playPlaceBalloon,
  playRefuse,
  playRemove,
  playStarPop,
  playStreak,
  playWinJingle,
  setSoundEnabled,
  soundEnabled,
} from '../services/audio'
import { duckMusic, musicEnabled, setMusicEnabled } from '../services/music'
import {
  hapticsEnabled,
  lockTap,
  pickupTap,
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
import { JAR_AD_HINTS, JAR_CAPACITY, JAR_HINTS, keepHintOfferDue, PACK_AD_HINTS, PACK_HINTS, type RewardPlacement } from '../game/economy'
import {
  adsDecided,
  adsSettled,
  adsSupported,
  hintsUnlimited,
  grantHint,
  hasHint,
  hintCountValue,
  interstitialWouldShow,
  keepHintDeclinesThisSession,
  maybeShowInterstitial,
  noteCleared,
  noteKeepHintDeclined,
  ONBOARDING_LEVELS,
  rewardedAvailable,
  rewardedBusy,
  rewardedOffered,
  setBannerOnScreen,
  useHint,
  watchRewarded,
  watchRewardedHint,
} from '../services/ads'
import type { InterstitialContext, RewardedOutcome } from '../services/ads'
import {
  claimHints,
  dailyDoneToday,
  dailyIntroDueNow,
  giftTomorrow,
  isFirstRun,
  noAdsNudgeNow,
  noteDailyIntro,
  packInfo,
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
import { splashFinished } from '../services/session'
import { noAdsPrice, welcomePrice } from '../services/iap'
import { loadHintNudged, saveDailyDone, saveHapticsEnabled, saveHintNudged, saveMusicEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, MAX_WIDE_W, prefersReducedMotion, safeArea, setBannerStrip, u } from './layout'
import { BG, CREAM_CSS, FONT, GOOD, INK, INK_CSS, OVER, OUTLINE, PAPER, STAR, UNDER } from './palette'
import { ScaleView } from './ScaleView'
import type { ScaleGeometry } from './ScaleView'
import {
  drawBackIcon,
  drawBellIcon,
  drawCard,
  drawFlame,
  drawHapticsIcon,
  drawMusicIcon,
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
import { drawCloseIcon, drawGridIcon, drawMoreIcon, flyBulbs, landingPuff, popTarget, ringBurst } from './fx'
import { meta } from '../services/metaStore'

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
  /** Needs a ~180 pt button; fitLabel() falls back to the short one on a 320 pt phone. */
  watch: 'Watch ad: +1 hint',
  watchShort: 'Ad: +1 hint',
  loading: 'Loading…',
  /** The modal opens at zero hints; the stash can grow while it stays open. */
  body: (n: number) =>
    n === 0
      ? 'Out of hints — watch a short ad for one more.'
      : `You have ${n} hint${n === 1 ? '' : 's'}. Watch a short ad for 1 more.`,
  /**
   * The player said no to ads, recently (option A keeps a refusal's offers off
   * the screen for 180 days — game/adConsent): no button that leads nowhere.
   * Say so plainly, where the answer is changed, and that hints come without
   * ads — neutral, the same words the consent question uses, no nudge.
   */
  videosOff: 'No hint videos: you chose no ads. Change it in Settings → Privacy & ads. Hints also come from the Star Jar and the daily gift.',
  /**
   * The stored consent answer is still being read (the first moments after the
   * splash): nothing was declined, so videosOff would be untrue.
   */
  notReady: "Hint videos aren't ready yet — earn hints from the Star Jar, or grab a pack.",
  /** Today's hint videos are used up (the per-day cap in game/economy.ts). */
  capped: "That's today's hint videos. More tomorrow, or grab a pack.",
  earned: 'Hint earned!',
  /** No video was ever shown: no fill, a failed or slow load. True of each. */
  unavailable: 'No video available right now — try again soon',
  /** A video was handed over and did not pay out: closed early, or failed to present. */
  notEarned: "No hint this time — the ad didn't play to the end",

  /**
   * The keep-your-hint sheet (game/economy keepHintOfferDue): a tap with one or
   * two hints left. The ad buys THIS hint — the demo runs at once — and the
   * stash stays as it is; both buttons say what they do before the tap.
   */
  keepBody: (n: number) =>
    n === 1
      ? '1 hint left. Use it, or watch a short ad for this one and keep yours.'
      : `${n} hints left. Use one, or watch a short ad for this one and keep yours.`,
  /** Needs a ~210 pt button; fitLabel() falls back to the short one on a 320 pt phone. */
  keepWatch: 'Watch ad: keep my hint',
  keepWatchShort: 'Ad: keep my hint',
  keepUse: 'Use 1 hint',
  /** Nothing was spent either way: say so, so the stash does not look at risk. */
  keepUnavailable: 'No video right now — your hint is safe',
  keepNotEarned: "The ad didn't finish — your hint is safe",
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
  /** The free hints already flew to the hint button (once per card, not per redraw). */
  flown?: boolean
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
  /** The Daily intro row: "Play today's puzzle" for a player who never solved one (game/dailyIntro). */
  intro: boolean
  /** Over the first streak's flame: what tomorrow brings ("Tomorrow: a new puzzle + a 2-hint gift"). */
  tomorrow: string | null
  /** A navigation button was pressed: the card is on its way out. */
  acted: boolean
  /** Where the reward row's icon sits, for hints flying home from it. */
  rewardAt?: { x: number; y: number }
}

/** Room kept between the pans and the tray for the equation strip (`53 + 19 − 5`). */
const EQUATION_BAND = u(30)

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
  /** Pan scale with more than four blocks aboard (three to a row)… */
  private panScale = 0.62
  /** …and with four or fewer (two to a row, about a third bigger), so a small sum stays readable. */
  private panScaleWide = 0.8
  /** Weights placed and still on their way to the pan: each lands (squash, kick, dust) once. */
  private pendingLand = new Set<number>()
  /** The weight placed last — the one that may complete the board. */
  private lastPlaced: number | null = null
  /** The completing weight still in flight, and what runs when it lands (whenWinningWeightLands). */
  private pendingWinIndex: number | null = null
  private onWinLanded: (() => void) | null = null
  /** The lock moment's hit-stop: update() holds the board until this scene time. */
  private hitStopUntil = 0
  /** The sum on the pan, written out under the scale (`53 + 19 − 5 = 67`). */
  private equation: Phaser.GameObjects.Container | null = null
  /** While dragging: what the total would become ("→ 72"), beside the total chip. */
  private previewText: Phaser.GameObjects.Text | null = null
  /** |gap| after the last change (null while the pan is empty), for the closer ladder. */
  private prevGapAbs: number | null = null
  private countTween: Phaser.Tweens.Tween | null = null
  /** Came here from the win card's Next (or Retry): the camera fades in. */
  private enterFade = false
  /** Per weight: the scene time it pops into its tray cell (the level's entrance). */
  private enterAt: number[] = []
  /** Fires the one-time "Stuck?" nudge after a quiet spell (armStuckNudge). */
  private idleTimer: Phaser.Time.TimerEvent | null = null
  /** The nudge was shown once already, on any level (exactly67.hintNudged). */
  private nudgeSeen = true
  private toastBg!: Phaser.GameObjects.Graphics

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
  /** Which sheet hintOverlay is, so a resize redraws the same one. */
  private hintOverlayKind: 'menu' | 'keep' = 'menu'

  constructor() {
    super('Game')
  }

  init(data: { level?: number; daily?: boolean; date?: string; enter?: boolean }) {
    this.daily = data.daily === true
    this.enterFade = data.enter === true
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
    // Phaser re-uses the scene object on restart: every per-board field resets here.
    this.pendingLand = new Set()
    this.lastPlaced = null
    this.pendingWinIndex = null
    this.onWinLanded = null
    this.hitStopUntil = 0
    this.equation = null
    this.previewText = null
    this.prevGapAbs = null
    this.enterAt = []
    this.idleTimer = null
  }

  create() {
    // No banner while a level is in play: the tray's bottom row sat 8 pt above
    // it, right where a dragging finger lands (ads.setBannerOnScreen). Before
    // anything lays out, so the board takes the strip; the next scene gets it
    // back. A Store launched over a paused level keeps it off too.
    setBannerStrip(false)
    setBannerOnScreen(false)
    this.events.once('shutdown', () => {
      setBannerStrip(true)
      setBannerOnScreen(true)
    })
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
    // The beam starts level and swings to the board's weight: the scale weighs
    // what is on it as the level opens. Reduced motion: it starts settled.
    if (this.reducedMotion) this.scaleView.settleImmediately()
    this.updateHud(ev)
    this.updateEquation(false)

    // Snap weights to their homes on the first frame instead of gliding in…
    this.steerWeights(1)
    // …then pop the tray pieces in one after another (they grow from nothing).
    if (!this.reducedMotion) {
      let k = 0
      this.weights.forEach((view, i) => {
        if (this.placed[i]) return
        this.enterAt[i] = this.time.now + 60 + 35 * k++
        view.setScale(0.01)
      })
    }
    if (this.enterFade && !this.reducedMotion) this.cameras.main.fadeIn(160, 246, 238, 223)
    this.maybeShowPackIntro()
    void loadHintNudged().then((seen) => {
      this.nudgeSeen = seen
      if (this.sys.isActive()) this.armStuckNudge()
    })

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
    const minCy = Math.max(top + f.eh * 0.245, messageBottom + u(8) + halfBeam * 0.23)
    // …and keep the lower pan clear of the tray AND of the labels stacked just
    // above it (the budget / "use every weight" row, the level hint, both laid
    // out in layoutHud) by shortening the ropes if needed. Once the beam came
    // down on short phones, the dish landed on those words. The hint is fitted
    // before this runs (layoutAll), so a hint that still wraps is paid for.
    const level = this.ref.def
    const hintH = this.hintText ? this.hintText.height : u(22)
    const band =
      u(12) +
      EQUATION_BAND +
      (level.maxWeights !== undefined || level.useAll ? u(24) : 0) +
      (level.hint ? Math.max(u(26), hintH + u(4)) : 0)
    const trayTop = this.portraitTrayTop()
    // The scale takes the room the content-fit tray gave back: longer ropes, and
    // the rest split about evenly above and below it, instead of a dead band
    // between the pans and the tray.
    const room = trayTop - band - minCy - halfBeam * 0.23 - panHeight
    const ropeLen = Math.max(u(40), Math.min(u(160), room * 0.6))
    const cy = minCy + Math.max(0, room - ropeLen) * 0.45
    return { cx: f.cx, cy, halfBeam, ropeLen, panWidth, panHeight }
  }

  /** The tray's grid: only the pieces that start in it (a locked piece starts on the pan). */
  private trayGrid(): { n: number; cols: number; rows: number } {
    const n = this.ref.def.weights.filter((_, i) => !(this.ref.def.locked ?? []).includes(i)).length
    const cols = this.wideMode ? this.bestTrayCols(n) : n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : Math.ceil(n / 3)
    return { n, cols, rows: Math.max(1, Math.ceil(n / Math.max(1, cols))) }
  }

  /**
   * Portrait: the tray is as tall as its rows need, not a fixed 36% of the
   * screen — a one-row level used to leave a 300 pt panel around two weights and
   * a dead band over it. Never above 56% of the frame, so a full tray still fits.
   */
  private portraitTrayTop(): number {
    const f = this.frame()
    const trayBottom = Math.min(f.oy + f.eh, this.scale.height - safeArea().bottom) - u(10)
    const n = this.ref.def.weights.filter((_, i) => !(this.ref.def.locked ?? []).includes(i)).length
    const cols = n <= 4 ? Math.max(1, n) : n <= 8 ? 4 : Math.ceil(n / 3)
    const rows = Math.max(1, Math.ceil(n / cols))
    const rowH = f.ew < u(375) ? u(100) : u(118)
    return Math.max(trayBottom - (rows * rowH + u(20)), f.oy + f.eh * 0.56)
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
      const kind = this.hintOverlayKind
      this.hintOverlay.destroy()
      this.hintOverlay = null
      if (kind === 'keep') this.showKeepHintSheet()
      else this.showHintMenu()
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
    this.panScaleWide = Math.min(1, (geo.panWidth * 0.47) / u(84))

    if (f.wide) {
      const { trayX, colW } = this.wideColumns()
      const top = Math.max(f.oy, safe.top) + u(12) + u(46) + u(40)
      const trayBottom = Math.min(f.oy + f.eh, h - safe.bottom) - u(10)
      this.tray = { x: trayX, y: top, width: colW, height: trayBottom - top, homes: [] }
    } else {
      // Tray panel: centered in the content frame, above the home indicator.
      const trayMargin = Math.max(u(12), safe.left, safe.right)
      const trayTop = this.portraitTrayTop()
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
    if (this.placed.length > 0) {
      this.updateHud(evaluate(this.ref.def, this.placed))
      this.updateEquation(false)
    }
  }

  /**
   * The pan's sum written out under the scale, in the order the pieces went on
   * (locked ones first): `53 + 19 − 5 = 67`. Balloons in their own colour. The
   * newest term pops in. More than seven terms show "…" and the last six.
   * Hidden until there are two pieces to add up.
   */
  private updateEquation(pop = true) {
    this.equation?.destroy()
    this.equation = null
    const aboard = this.weights
      .filter((v) => this.placed[v.index] && this.slotOf[v.index] !== null)
      .sort((a, b) => (this.slotOf[a.index] ?? 0) - (this.slotOf[b.index] ?? 0))
    // One piece is not a sum ("90 = 90" says nothing the chip does not).
    if (aboard.length < 2) return
    const geo = this.geo
    const f = this.frame()
    const x = this.wideMode ? geo.cx : f.cx
    const y = geo.cy + geo.halfBeam * 0.23 + geo.ropeLen + geo.panHeight + u(16)
    const c = this.add.container(x, y).setDepth(5)
    const shown = aboard.length > 7 ? aboard.slice(-6) : aboard
    const parts: { text: string; color: string; view?: WeightView }[] = []
    if (aboard.length > 7) parts.push({ text: '… ', color: INK_SOFT })
    shown.forEach((v, i) => {
      const n = Math.abs(v.value)
      const first = i === 0 && aboard.length <= 7
      const text = first ? (v.value < 0 ? `−${n}` : `${n}`) : v.value < 0 ? ` − ${n}` : ` + ${n}`
      parts.push({ text, color: v.isBalloon ? '#D66690' : INK_CSS, view: v })
    })
    const total = evaluate(this.ref.def, this.placed).total
    parts.push({ text: ` = ${total}`, color: INK_SOFT })
    let w = 0
    const texts = parts.map((p) => {
      const t = this.add.text(w, 0, p.text, TEXT.ink(17, '800')).setOrigin(0, 0.5).setColor(p.color)
      w += t.width
      return { t, p }
    })
    for (const { t } of texts) t.x -= w / 2
    c.add(texts.map((e) => e.t))
    const maxW = (this.wideMode ? f.ew / 2 : this.tray.width) - u(20)
    if (w > maxW) c.setScale(maxW / w)
    this.equation = c
    // The term just put on pops in (a place, not a removal or a relayout).
    const newest = texts.find((e) => e.p.view && e.p.view.index === this.lastPlaced)
    if (pop && newest && this.lastPlaced !== null && this.placed[this.lastPlaced] && !this.reducedMotion) {
      newest.t.setScale(1.25)
      this.tweens.add({ targets: newest.t, scale: 1, duration: 160, ease: 'Back.out' })
    }
  }

  /** Leave for another board (Next, Retry) through a short fade, so levels don't hard-cut. */
  private restartWithFade(data: { level: number }) {
    if (this.reducedMotion) {
      this.scene.restart({ ...data, enter: false })
      return
    }
    const cam = this.cameras.main
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ ...data, enter: true }))
    cam.fadeOut(120, 246, 238, 223)
  }

  /**
   * A new pack's first level, the first time: its name and tagline slide down
   * over the board for a moment ("Pack 3 of 25"). A tap skips it.
   */
  private maybeShowPackIntro() {
    if (this.daily || this.ref.levelIndex !== 0 || this.ref.packIndex <= 0) return
    if (isCleared(progress(), this.ref.global)) return
    const f = this.frame()
    const safe = safeArea()
    const w = Math.min(f.ew - u(48), u(340))
    const x = f.cx
    const name = this.add.text(0, u(-26), this.ref.pack.name, TEXT.ink(28, '800')).setOrigin(0.5)
    const tag = this.add.text(0, u(10), this.ref.pack.tagline, TEXT.ink(14, '600')).setOrigin(0.5).setColor(INK_SOFT)
    tag.setWordWrapWidth(w - u(32)).setAlign('center')
    const which = this.add.text(0, u(10) + tag.height / 2 + u(16), `Pack ${this.ref.packIndex + 1} of ${PACKS.length}`, TEXT.ink(12, '700')).setOrigin(0.5).setColor(INK_SOFT)
    const h = u(96) + tag.height
    const card = this.add.graphics()
    drawCard(card, -w / 2, -h / 2 + u(-8), w, h, u(22))
    const slab = this.add.container(x, 0, [card, name, tag, which]).setDepth(95).setSize(w, h).setInteractive()
    const rest = Math.max(f.oy, safe.top) + u(12) + u(46) + u(16) + h / 2
    const hide = () => {
      if (!slab.active) return
      slab.disableInteractive()
      this.tweens.add({ targets: slab, alpha: 0, y: rest - u(24), duration: 200, onComplete: () => slab.destroy() })
    }
    onTap(slab, hide)
    if (this.reducedMotion) {
      slab.setY(rest).setAlpha(0)
      this.tweens.add({ targets: slab, alpha: 1, duration: 150 })
    } else {
      slab.setY(rest - h - u(40))
      this.tweens.add({ targets: slab, y: rest, duration: 240, ease: 'Back.out' })
    }
    this.time.delayedCall(1400, hide)
  }

  /**
   * Once ever, on Level 3 or later: after 25 s with nothing changed and a hint to
   * spend, the hint button pulses and a toast says what it does. Any change on
   * the board starts the 25 s again.
   */
  private armStuckNudge() {
    this.idleTimer?.remove(false)
    this.idleTimer = null
    if (this.daily || this.ref.global < 3 || this.nudgeSeen || this.wonState) return
    this.idleTimer = this.time.delayedCall(25_000, () => {
      if (this.wonState || this.hintShown || this.hintOverlay || this.nudgeSeen) return
      if (!hintsUnlimited() && !hasHint()) return
      this.nudgeSeen = true
      void saveHintNudged()
      if (!this.reducedMotion) {
        this.tweens.add({ targets: this.hudButtons.hint, scale: 1.12, duration: 300, yoyo: true, repeat: 2 })
      }
      this.showToast('Stuck? A hint shows the next piece.')
    })
  }

  /** While a weight is dragged: light the pan as a drop target and preview the new total. */
  private dragFeedback(view: WeightView, x: number, y: number) {
    const over = this.dropZone.contains(x, y)
    const placed = this.placed[view.index]
    this.scaleView.setDropHover(over && !placed)
    const now = evaluate(this.ref.def, this.placed).total
    const next = !placed && over ? now + view.value : placed && !over ? now - view.value : null
    if (next === null) {
      this.previewText?.setVisible(false)
      return
    }
    if (!this.previewText) {
      this.previewText = this.add.text(0, 0, '', TEXT.ink(15, '800')).setOrigin(0, 0.5).setAlpha(0.75).setDepth(6)
    }
    const color = next === TARGET ? GOOD_CSS : next > TARGET ? OVER_CSS : UNDER_CSS
    this.previewText
      .setText(`→ ${next}`)
      .setColor(color)
      .setPosition(this.totalText.x + u(74), this.totalText.y)
      .setVisible(true)
  }

  private endDragFeedback() {
    this.scaleView.setDropHover(false)
    this.previewText?.setVisible(false)
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
    const all = this.ref.def.weights.length
    const locked = this.ref.def.locked ?? []
    const { n, cols, rows } = this.trayGrid()
    const pad = u(10)
    const cellW = (this.tray.width - pad * 2) / cols
    const cellH = (this.tray.height - pad * 2) / rows
    this.tray.homes = []
    // Only the pieces that can come back to the tray get a cell: a locked piece
    // starts on the pan and never leaves it, and its empty cell read as a
    // missing weight. It keeps a home at the tray's centre that is never used.
    let slot = 0
    for (let i = 0; i < all; i++) {
      if (locked.includes(i)) {
        this.tray.homes.push({ x: this.tray.x + this.tray.width / 2, y: this.tray.y + this.tray.height / 2, scale: 1 })
        continue
      }
      const row = Math.floor(slot / cols)
      const inRow = Math.min(cols, n - row * cols)
      const col = slot - row * cols
      slot++
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
    // A pill: cream text on ink. (Cream on a thick ink stroke smeared on a busy board.)
    this.toastBg = this.add.graphics().setDepth(49).setAlpha(0)
    this.toastText = this.add.text(0, 0, '', TEXT.cream(14, '800')).setOrigin(0.5).setAlpha(0)
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
    // One "more" button instead of two switches in the HUD: the sheet holds
    // sound, music and haptics, and Restart / Levels (showMoreSheet).
    const more = makeIconButton(this, size, (g, s) => drawMoreIcon(g, s), () => {
      if (this.wonState || this.hintOverlay) return
      this.showMoreSheet()
    })
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
    this.hudButtons = { back, more, hint }
    this.refreshHint()
    // Coming back from the Store overlay, the stash may have grown (or hints may
    // have become unlimited) — resync the badge instead of showing a stale count.
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.refreshHint())
  }

  private hudButtons!: {
    back: ReturnType<typeof makeIconButton>
    more: ReturnType<typeof makeIconButton>
    hint: ReturnType<typeof makeIconButton>
  }

  private hintBadge!: Phaser.GameObjects.Text

  /** Re-render the hint button + its count badge for the current stash size. */
  private refreshHint(shown?: number) {
    this.hudButtons.hint.refresh()
    if (hintsUnlimited()) {
      // Bundle owners have unlimited free hints — lit bulb, no count.
      this.hintBadge.setVisible(false)
      return
    }
    // `shown`: a count on its way to the real one (hints flying in from a card).
    const n = Math.max(0, shown ?? hintCountValue())
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
    this.hudButtons.more.setPosition(rightX, top + size / 2)

    this.levelText.setPosition(f.cx, top - u(2))
    this.levelText.setText(this.daily ? 'Daily 67' : `Level ${this.ref.global}`)
    this.packText.setPosition(f.cx, top + u(24))
    this.packText.setText(this.ref.pack.name)
    // The title lives between the two button clusters: on a 320 pt phone
    // "Level 372" ran under the hint button and "Dead Reckoning" lost its ends.
    // Symmetric about the centre: the left cluster (back + hint) is the wider one.
    const room = 2 * (f.cx - (leftX + size + u(12) + size / 2)) - u(8)
    for (const t of [this.levelText, this.packText]) t.setScale(Math.min(1, room / Math.max(t.width, 1)))

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
    if (!this.reducedMotion && this.prevTotal !== null && this.prevTotal !== ev.total) {
      // The total counts to its new value instead of snapping: the sum is felt.
      const from = this.prevTotal
      this.countTween?.stop()
      this.countTween = this.tweens.addCounter({
        from,
        to: ev.total,
        duration: 160,
        ease: 'Quad.out',
        onUpdate: (t) => this.totalText.setText(String(Math.round(t.getValue() ?? ev.total))),
        onComplete: () => this.totalText.setText(String(ev.total)),
      })
      this.tweens.killTweensOf(this.totalText)
      this.tweens.add({ targets: this.totalText, scale: { from: 1.3, to: 1 }, duration: 240, ease: 'Back.out' })
    } else {
      this.totalText.setText(String(ev.total))
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
    this.tweens.killTweensOf([this.toastText, this.toastBg])
    const t = this.toastText.setText(message)
    const padX = u(14)
    const padY = u(9)
    const bg = this.toastBg.clear()
    bg.fillStyle(INK, 0.92)
    bg.fillRoundedRect(t.x - t.width / 2 - padX, t.y - t.height / 2 - padY, t.width + padX * 2, t.height + padY * 2, u(14))
    if (this.reducedMotion) {
      t.setAlpha(1)
      bg.setAlpha(1).setY(0)
    } else {
      t.setAlpha(0)
      bg.setAlpha(0).setY(u(10))
      const y0 = t.y
      t.setY(y0 + u(10))
      this.tweens.add({ targets: t, alpha: 1, y: y0, duration: 160, ease: 'Quad.out' })
      this.tweens.add({ targets: bg, alpha: 1, y: 0, duration: 160, ease: 'Quad.out' })
    }
    this.toastTween = this.tweens.add({ targets: [t, bg], alpha: 0, delay: 1660, duration: 300 })
  }

  /**
   * Tap the 💡: spend one banked hint to run the ghost demo of the exact next
   * piece — which the player still drags themselves (relieves being stuck
   * without hollowing out "I solved it"). A re-tap on the SAME board replays the
   * demo for free (no double-charge); at zero hints, open the earn modal; with
   * one or two left, ask whether to spend one or keep it for an ad (see
   * showKeepHintSheet). The "why" is taught by the demo toast + the live gap
   * text under the total chip.
   */
  private doHint() {
    if (this.wonState || this.hintBusy) return
    if (this.time.now < this.hintCooldownUntil) return
    if (this.hintIndex() == null) return
    // Bundle owners get hints on the house: free, unlimited, never an ad. Note
    // this is hintsUnlimited(), NOT adsRemoved() — the $0.99 ads-only product
    // removes ads without buying the hint perk.
    if (!hintsUnlimited() && !this.hintShown) {
      if (!hasHint()) {
        this.showHintMenu()
        return
      }
      const keep = keepHintOfferDue({
        hints: hintCountValue(),
        unlimited: hintsUnlimited(),
        videoOffered: rewardedAvailable('hint'),
        freeReplay: this.hintShown,
        declines: keepHintDeclinesThisSession(),
        pastOnboarding: this.daily || this.ref.global > ONBOARDING_LEVELS,
      })
      if (keep) {
        this.showKeepHintSheet()
        return
      }
      this.spendHintAndPlay()
      return
    }
    this.playHint()
  }

  /** Spend one banked hint on this board, then run its demo. */
  private spendHintAndPlay() {
    if (!useHint()) {
      this.showHintMenu()
      return
    }
    this.refreshHint()
    this.hintShown = true
    this.playHint()
  }

  /** Run the demo of the next piece — paid for already, or free. False when there is none. */
  private playHint(): boolean {
    const index = this.hintIndex()
    if (index == null) return false
    this.revealHintDemo(index, evaluate(this.ref.def, this.placed))
    this.hintCooldownUntil = this.time.now + 2400
    return true
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
    // The tap asked for ad consent and got no yes: the player just chose, and a
    // no already took the button away (refresh() put the reason in the modal).
    else if (outcome === 'no-consent') return
    // Consent withdrawn meanwhile: refresh() just put the reason in the modal.
    else if (!rewardedOffered()) return
    else modal.say(outcome === 'unavailable' ? HINT_COPY.unavailable : HINT_COPY.notEarned)
  }

  /**
   * Watch a rewarded video to KEEP a hint: the video pays for this board's hint,
   * whose demo runs at once, and the stash is not touched. Same lock as
   * watchForHint — no way out of the sheet while the video loads or plays.
   */
  private async watchToKeepHint(sheet: { refresh: () => void; say: (message: string) => void; close: () => void }) {
    if (this.hintBusy || this.wonState || rewardedBusy()) return
    this.hintBusy = true
    sheet.refresh() // "Loading…" on the button, every way out locked
    let outcome: RewardedOutcome = 'unavailable'
    try {
      outcome = await watchRewarded('hint')
    } finally {
      this.hintBusy = false
    }
    // A video watched to the end is owed its hint. Where its demo can no longer
    // run — the scene stopped under the ad, the board is won, no next piece —
    // the hint goes into the stash instead.
    if (!this.sys.isActive()) {
      if (outcome === 'earned') grantHint()
      return
    }
    if (outcome === 'earned') {
      sheet.close()
      this.hintShown = true
      if (this.wonState || !this.playHint()) {
        this.hintShown = false
        grantHint()
        this.refreshHint()
      }
      return
    }
    // The tap asked for ad consent and got no yes, or the offer went away
    // meanwhile (consent withdrawn): nothing was spent, and the next tap spends.
    if (outcome === 'no-consent' || !rewardedAvailable('hint')) {
      sheet.close()
      return
    }
    sheet.refresh()
    sheet.say(outcome === 'unavailable' ? HINT_COPY.keepUnavailable : HINT_COPY.keepNotEarned)
  }

  /** A button's label: the full disclosure when it fits, the short one on a 320 pt phone. */
  private fitLabel(full: string, short: string, buttonW: number, rowH: number): string {
    // Same style makeButton gives its label, measured off the display list.
    const probe = this.make.text(
      {
        text: full,
        style: { fontFamily: FONT, fontSize: `${Math.round(rowH * 0.42)}px`, fontStyle: '700' },
      },
      false,
    )
    const fits = probe.width <= buttonW - u(20)
    probe.destroy()
    return fits ? full : short
  }

  /**
   * The HUD's "⋯": sound, music and haptics switches, then Restart level and
   * Levels (or the Daily calendar). The same switches as the menu's Settings.
   */
  private showMoreSheet() {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(120)
    const close = () => overlay.destroy()
    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45).setInteractive()
    onTap(dim, close)
    const cardW = Math.min(w - u(48), u(340))
    const cx = w / 2
    const rowPitch = u(52)
    const btnH = u(50)
    const rowsTop = u(62)
    const cardH = rowsTop + rowPitch * 3 + u(14) + btnH * 2 + u(12) + u(22)
    const top = Math.max(safeArea().top + u(70), Math.min(h * 0.44 - cardH / 2, h - safeArea().bottom - cardH - u(16)))
    const card = this.drawHintCard(cx, top, cardW, cardH)
    const cardHit = this.add.zone(cx, top + cardH / 2, cardW, cardH).setInteractive()
    const title = this.add.text(cx, top + u(32), this.daily ? 'Daily 67' : `Level ${this.ref.global}`, TEXT.ink(21, '800')).setOrigin(0.5)
    overlay.add([dim, card, cardHit, title, this.closeGlyph(cx + cardW / 2 - u(30), top + u(30), close)])
    const rowX = cx - cardW / 2 + u(22)
    const rowW = cardW - u(44)
    let y = top + rowsTop + rowPitch / 2
    const row = (
      label: string,
      icon: (g: Phaser.GameObjects.Graphics, size: number, on: boolean) => void,
      get: () => boolean,
      set: (on: boolean) => void,
    ) => {
      const yy = y
      const g = this.add.graphics().setPosition(rowX + u(16), yy)
      const text = this.add.text(rowX + u(44), yy, label, TEXT.ink(16, '700')).setOrigin(0, 0.5)
      const sw = this.add.graphics()
      const hit = this.add.zone(rowX + rowW / 2, yy, rowW, u(48)).setInteractive({ useHandCursor: true })
      const paint = () => {
        g.clear()
        icon(g, u(34), get())
        const on = get()
        const sx = rowX + rowW - u(52)
        sw.clear()
        sw.fillStyle(on ? 0x69db7c : 0xe7ddcb, 1)
        sw.fillRoundedRect(sx, yy - u(14), u(52), u(28), u(14))
        sw.lineStyle(u(3), INK, 1)
        sw.strokeRoundedRect(sx, yy - u(14), u(52), u(28), u(14))
        sw.fillStyle(PAPER, 1)
        sw.fillCircle(on ? sx + u(38) : sx + u(14), yy, u(10))
        sw.strokeCircle(on ? sx + u(38) : sx + u(14), yy, u(10))
      }
      paint()
      onTap(hit, () => {
        set(!get())
        if (hit.active) paint()
      })
      overlay.add([g, text, sw, hit])
      y += rowPitch
    }
    row('Sound', drawSoundIcon, soundEnabled, (on) => {
      setSoundEnabled(on)
      void saveSoundEnabled(on)
      if (on) playPlace()
    })
    row('Music', drawMusicIcon, musicEnabled, (on) => {
      setMusicEnabled(on)
      void saveMusicEnabled(on)
    })
    row('Haptics', drawHapticsIcon, hapticsEnabled, (on) => {
      setHapticsEnabled(on)
      void saveHapticsEnabled(on)
      if (on) placeTap()
    })
    const bw = cardW - u(44)
    let by = y - rowPitch / 2 + u(14) + btnH / 2
    const restart = makeButton(this, 'Restart level', bw, btnH, PAPER, '#2B2440', () => {
      close()
      this.scene.restart(this.daily ? { daily: true, date: this.dailyDate } : { level: this.ref.global })
    })
    restart.setPosition(cx, by)
    by += btnH + u(12)
    const away = makeButton(this, this.daily ? 'Daily calendar' : 'Levels', bw, btnH, PAPER, '#2B2440', () => {
      close()
      if (this.daily) this.scene.start('Daily', {})
      else this.scene.start('LevelMap', { scrollTo: this.ref.global })
    })
    away.setPosition(cx, by)
    overlay.add([restart, away])
    if (!this.reducedMotion) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 140 })
    }
  }

  /** A sheet's visible way out: an ✕ in the card's top-right corner (40 pt, a 48 pt target). */
  private closeGlyph(x: number, y: number, close: () => void): Phaser.GameObjects.Container {
    const b = makeIconButton(this, u(40), (g, sz) => drawCloseIcon(g, sz), close)
    b.setPosition(x, y)
    return b
  }

  /** The hint card's frame: an ink drop shadow, paper, an ink outline. */
  private drawHintCard(cx: number, top: number, cardW: number, cardH: number): Phaser.GameObjects.Graphics {
    const card = this.add.graphics()
    card.fillStyle(INK, 1)
    card.fillRoundedRect(cx - cardW / 2, top + u(6), cardW, cardH, u(24))
    card.fillStyle(PAPER, 1)
    card.fillRoundedRect(cx - cardW / 2, top, cardW, cardH, u(24))
    card.lineStyle(OUTLINE + u(1), INK, 1)
    card.strokeRoundedRect(cx - cardW / 2, top, cardW, cardH, u(24))
    return card
  }

  /**
   * What happened to a tap, said just under a hint card. The scene's own toast
   * sits under the dim and, on most phones, behind the card itself — a "no
   * video available" nobody can read is the dead tap these sheets exist to avoid.
   */
  private hintCardNote(overlay: Phaser.GameObjects.Container, cx: number, y: number, cardW: number) {
    const note = this.add
      .text(cx, y, '', TEXT.cream(15, '700'))
      .setOrigin(0.5)
      .setAlign('center')
      .setWordWrapWidth(cardW)
      .setAlpha(0)
    note.setStroke(INK_CSS, u(5))
    let noteTween: Phaser.Tweens.Tween | null = null
    const say = (message: string) => {
      // Sheet already closed: the scene's toast is in plain sight again.
      if (!note.active) {
        this.showToast(message)
        return
      }
      noteTween?.stop()
      note.setText(message).setAlpha(1)
      noteTween = this.tweens.add({ targets: note, alpha: 0, delay: 1800, duration: 350 })
    }
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => noteTween?.stop())
    return { note, say }
  }

  /**
   * One or two hints left: "use one, or watch an ad for this one and keep
   * yours" (game/economy keepHintOfferDue). Two stacked buttons of the same
   * size, each saying what it does; a tap on the dim closes it and spends
   * nothing. Opened only by the player's own hint tap.
   */
  private showKeepHintSheet() {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(120)
    this.hintOverlay = overlay
    this.hintOverlayKind = 'keep'
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hintOverlay === overlay) this.hintOverlay = null
    })
    // No way out while a video is loading or on screen — see watchToKeepHint().
    const close = () => {
      if (this.hintBusy) return
      overlay.destroy()
    }

    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45).setInteractive()
    onTap(dim, close)

    const cardW = Math.min(w - u(48), u(340))
    const cx = w / 2
    const title = this.add.text(cx, 0, 'Hints', TEXT.ink(21, '800')).setOrigin(0.5)
    const body = this.add.text(cx, 0, '', TEXT.ink(13, '600')).setOrigin(0.5, 0)
    body.setColor(INK_SOFT).setAlign('center').setWordWrapWidth(cardW - u(40))
    // Sized once for the longer text, so the buttons never move under a thumb.
    let bodyBox = 0
    for (const n of [1, 2]) {
      body.setText(HINT_COPY.keepBody(n))
      bodyBox = Math.max(bodyBox, body.height)
    }

    // Stacked, full width, the same size: side by side, the watch label would
    // fit neither form on a 320 pt phone.
    const margin = u(16)
    const rowH = u(52)
    const btnW = cardW - margin * 2
    const bodyOff = u(54)
    const watchOff = bodyOff + bodyBox + u(18) + rowH / 2
    const useOff = watchOff + rowH + u(12)
    // The Store, one quiet link under the choice — the moment a player is down
    // to their last hints is where the one-time Welcome pack is worth most, and
    // a new player who chains Next never passes the menu where it otherwise sits.
    const upsellOff = useOff + rowH / 2 + u(26)
    const cardH = upsellOff + u(22)
    const cy = Math.min(h * 0.44, h - safeArea().bottom - cardH / 2 - u(16))
    const top = cy - cardH / 2

    const card = this.drawHintCard(cx, top, cardW, cardH)
    // The card swallows taps, so only the dim around it closes the sheet.
    const cardHit = this.add.zone(cx, top + cardH / 2, cardW, cardH).setInteractive()
    title.setY(top + u(34))
    const watchLabel = this.fitLabel(HINT_COPY.keepWatch, HINT_COPY.keepWatchShort, btnW, rowH)
    const { note, say } = this.hintCardNote(overlay, cx, top + cardH + u(30), cardW)
    overlay.add([dim, card, cardHit, title, body, note, this.closeGlyph(cx + cardW / 2 - u(30), top + u(30), close)])
    const welcome = welcomeOffered() ? welcomePrice() : null
    const upsell = this.add
      .text(cx, top + upsellOff, welcome ? `Welcome pack: 25 hints for ${welcome} ›` : 'More hints in the Store ›', TEXT.ink(12, '700'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setPadding({ x: u(12), y: u(8) })
      .setInteractive({ useHandCursor: true })
    onTap(upsell, () => {
      if (this.hintBusy) return
      close()
      // Overlay, not a scene swap: the board must still be here afterwards.
      this.scene.pause()
      this.scene.launch('Store', { returnTo: 'Game' })
    })
    overlay.add(upsell)

    let watch: Phaser.GameObjects.Container | null = null
    let use: Phaser.GameObjects.Container | null = null
    const refresh = () => {
      // The sheet can already be gone when a video settles (its scene left).
      if (!body.active) return
      body.setText(HINT_COPY.keepBody(hintCountValue()))
      body.setY(top + bodyOff + (bodyBox - body.height) / 2)
      watch?.destroy()
      use?.destroy()
      watch = makeButton(this, this.hintBusy ? HINT_COPY.loading : watchLabel, btnW, rowH, 0xf5b942, '#2B2440', () =>
        void this.watchToKeepHint({ refresh, say, close }),
      )
      watch.setPosition(cx, top + watchOff)
      use = makeButton(this, HINT_COPY.keepUse, btnW, rowH, PAPER, '#2B2440', () => {
        if (this.hintBusy) return
        noteKeepHintDeclined()
        close()
        this.spendHintAndPlay()
      })
      use.setPosition(cx, top + useOff)
      if (this.hintBusy) {
        watch.setAlpha(0.6).disableInteractive()
        use.setAlpha(0.5)
      }
      overlay.add([watch, use])
    }
    refresh()

    if (!this.reducedMotion) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 160 })
    }
  }

  /** Modal to earn a hint (a rewarded ad) or buy a hint pack. */
  private showHintMenu() {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(120)
    this.hintOverlay = overlay
    this.hintOverlayKind = 'menu'
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

    const card = this.drawHintCard(cx, top, cardW, cardH)
    title.setY(top + u(34))
    upsell.setY(top + upsellOff)
    const closeX = this.closeGlyph(cx + cardW / 2 - u(30), top + u(30), close)

    // Button row: Done left, the (wider) watch button right, with fixed side
    // margins and gap so the pair fills a 320 pt card as well as a 430 pt one.
    const margin = u(16)
    const gap = u(12)
    const rowInner = cardW - margin * 2 - gap
    const doneW = rowInner * 0.33
    const watchW = rowInner - doneW
    const watchLabel = this.fitLabel(HINT_COPY.watch, HINT_COPY.watchShort, watchW, rowH)

    let watch: Phaser.GameObjects.Container | null = null
    let done: Phaser.GameObjects.Container | null = null

    // What happened to a tap, said just under the card (see hintCardNote).
    const { note, say } = this.hintCardNote(overlay, cx, top + cardH + u(30), cardW)

    overlay.add([dim, card, title, body, upsell, note, closeX])

    // Re-reads everything on every call — the stash, the busy flag and whether
    // the offer stands — so a yes given later in Settings → "Privacy & ads"
    // brings the watch button back the next time the modal draws.
    const refresh = () => {
      // The modal can already be gone when a video settles (its scene left).
      if (!body.active) return
      // Offered (consent, or a tap that would ask for it) AND not capped for
      // today: only then is there a video.
      const consent = rewardedOffered()
      const offered = consent && rewardedAvailable('hint')
      // An answer not read yet is not a "no".
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
        done = makeButton(this, 'Close', doneW, rowH, PAPER, '#2B2440', () => close())
        done.setPosition(cx - cardW / 2 + margin + doneW / 2, btnY)
      } else {
        // Nothing to watch: Done alone, centred; the body says why and where.
        done = makeButton(this, 'Close', cardW * 0.4, rowH, PAPER, '#2B2440', () => close())
        done.setPosition(cx, btnY)
      }
      if (this.hintBusy) done.setAlpha(0.5)
      overlay.add(watch ? [watch, done] : [done])
    }
    refresh()
    // Opened before the stored consent answer was read: redraw once it is, so
    // the watch button appears and "not ready yet" goes.
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
      this.tweens.add({ targets: view, scale: 1, duration: 90, ease: 'Quad.out' })
      pickupTap()
    })

    view.on('drag', (p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (this.wonState) return
      view.setPosition(dragX, dragY)
      this.dragFeedback(view, p.x, p.y)
    })

    view.on('dragend', (pointer: Phaser.Input.Pointer) => {
      view.dragging = false
      this.endDragFeedback()
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
    const view = this.weights[index]
    if (view.isBalloon) playPlaceBalloon()
    else playPlace(view.value)
    placeTap(view.value)
    this.pendingLand.add(index)
    this.lastPlaced = index
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
    this.pendingLand.delete(index)
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
    // "Closer" is heard before it is read: one note of a rising ladder, higher
    // the nearer 67 — only when this change actually brought the pan closer.
    const gapAbs = Math.abs(ev.gap)
    if (!ev.balanced && placedCount(this.placed) > 0 && this.prevGapAbs !== null && gapAbs < this.prevGapAbs) playCloser(gapAbs)
    this.prevGapAbs = placedCount(this.placed) > 0 ? gapAbs : null
    this.updateEquation()
    this.armStuckNudge()
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

    // Up to four blocks sit two to a row at a third more size; from five on,
    // three to a row at the old size — the numbers on a small sum stay readable.
    // Only where the ropes leave room for the taller stack (not a 320×568 phone,
    // where the bigger pieces and their balloons climbed over the gap message).
    const roomy = blocks.length <= 4 && geo.ropeLen >= u(90)
    const scale = roomy ? this.panScaleWide : this.panScale
    const perRow = roomy ? 2 : 3
    const slotW = geo.panWidth * (roomy ? 0.47 : 0.31)
    // Each row is as tall as its tallest block, and rows stack on each other:
    // a small weight on the second row sits ON the big one, not inside it.
    const rowH: number[] = []
    blocks.forEach((view, i) => {
      const row = Math.floor(i / perRow)
      rowH[row] = Math.max(rowH[row] ?? 0, view.bodySize * 0.8 * scale)
    })
    const rowBase: number[] = []
    rowH.reduce((acc, h, r) => {
      rowBase[r] = acc
      return acc + h * 1.04
    }, 0)
    let stackTop = 0
    blocks.forEach((view, i) => {
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, blocks.length - row * perRow)
      const col = i - row * perRow
      const x = anchor.x + (col - (inRow - 1) / 2) * slotW
      const bodyH = view.bodySize * 0.8 * scale
      const y = anchor.y - rowBase[row] - bodyH / 2 - u(2)
      stackTop = Math.max(stackTop, rowBase[row] + bodyH)
      targets.set(view.index, { x, y, scale })
    })

    // Balloons hover above whatever is stacked in the dish, strings down.
    const spread = [-0.3, 0.3, 0, -0.16, 0.16, -0.38, 0.38]
    balloons.forEach((view, i) => {
      const x = anchor.x + geo.panWidth * spread[i % spread.length]
      const y = anchor.y - stackTop - u(4) - (i % 3) * u(8)
      targets.set(view.index, { x, y, scale })
    })

    return targets
  }

  update(time: number, delta: number) {
    // The lock moment's hit-stop: the board holds still for a beat (winSequence).
    if (this.time.now < this.hitStopUntil) return
    this.scaleView.update(time, delta)
    this.steerWeights(1 - Math.exp(-12 * (delta / 1000)))
  }

  /** Every weight glides toward its home (tray slot or pan position). */
  private steerWeights(t: number) {
    const panTargets = this.panTargets()
    const now = this.time.now
    this.weights.forEach((view, i) => {
      if (view.dragging) return
      if (this.enterAt[i] !== undefined && now < this.enterAt[i]) return
      const target = panTargets.get(i)
      let tx: number
      let ty: number
      let ts: number
      if (target) {
        tx = target.x
        ty = target.y
        ts = target.scale
        // Come in over the dish and drop onto it, instead of rising through it
        // from the tray below: aim above the slot until lined up with it.
        if (Math.abs(view.x - tx) > u(30) && view.y > ty - u(40)) ty = target.y - u(40)
      } else {
        const home = this.tray.homes[i]
        tx = home.x
        ty = home.y + view.centerOffsetY(home.scale)
        ts = home.scale
      }
      view.x = Phaser.Math.Linear(view.x, tx, t)
      view.y = Phaser.Math.Linear(view.y, ty, t)
      view.setScale(Phaser.Math.Linear(view.scaleX, ts, t))
      view.setLabelFloor(view.scaleX)
      // Landed: once per placement, the first frame it is (nearly) in its slot.
      if (target && this.pendingLand.has(i) && Math.abs(view.x - target.x) < u(3) && Math.abs(view.y - target.y) < u(3)) {
        this.pendingLand.delete(i)
        this.onLanded(view)
      }
    })
  }

  /** A placed weight reached the pan: squash, beam kick, dust — and a pending win can land now. */
  private onLanded(view: WeightView) {
    view.land(Math.abs(view.value) / 60)
    this.scaleView.kick(view.value)
    landingPuff(this, view.x, view.y + (view.isBalloon ? -view.bodySize * view.scaleX * 0.4 : view.bodySize * view.scaleX * 0.4), view.isBalloon)
    if (this.pendingWinIndex === view.index) this.startWinSequence()
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
        // Under the win card (100): confetti must never sit over its text.
        .setDepth(99)
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
    if (reward) {
      claimHints(reward.base)
      // The HUD badge shows the stash before the reward until the hints fly to
      // it from the card (flyHintsHome) — and the real count once they land, so
      // it never shows the old number under "+3 hints added" for long.
      this.refreshHint(hintCountValue() - reward.base)
    }

    // A clear whose card offers a rewarded upgrade never also gets an
    // interstitial: two ad prompts on one win is the double tax players hate.
    const ctx: InterstitialContext = { rewardPrompt: reward !== null }
    // The Daily intro goes first, and alone: it is the one ask on its card, so
    // no interstitial (nor the consent question) follows it either — the clear
    // counter stays armed for the next clear. At most three cards ever carry it.
    const intro = !this.daily && !reward && dailyIntroDueNow(this.ref.global)
    if (intro) noteDailyIntro()
    const adFollows = !this.daily && !intro && interstitialWouldShow(this.ref.global, ctx)
    const reviewAsks = !this.daily && !intro && !adFollows && !reward && reviewWouldAsk(this.ref.global, stars)
    const remind = this.daily
      ? shouldOfferReminders('daily-clear')
      : !intro && !reward && !adFollows && !reviewAsks && shouldOfferReminders('level-clear', stars, this.ref.global)
    const nudge = !this.daily && !intro && !remind && !adFollows && noAdsNudgeNow()
    if (remind) noteReminderOffered()
    if (nudge) noteNoAdsNudge()
    // Each of those asks was made on the promise that no ad follows. Freeze that
    // answer: leaveAfterClear re-runs the gate at the Next/Map tap, by which time
    // the warm-up or the spacing floor may have run out and opened it.
    ctx.cardAsk = intro || remind || reviewAsks || nudge
    // The first streak's card says what tomorrow brings: the habit is the point.
    let tomorrow: string | null = null
    if (daily?.counted && daily.streak === 1) {
      const gift = giftTomorrow()
      tomorrow = gift ? `Tomorrow: a new puzzle + a ${gift.hints}-hint gift` : 'Tomorrow: a new puzzle'
    }

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
      intro,
      tomorrow,
      acted: false,
    }
    this.pushReminderContext()

    // The celebration runs in two beats. First the impact: the beam locks, the
    // camera kicks, confetti drops, the jingle fires and "Congratulations!"
    // pops over the board. Then the reward: the card slides up with the stars
    // and the fanfare. Splitting them is what makes a clear feel earned rather
    // than merely acknowledged — one lump of feedback reads as a notification.
    // The celebration starts when the winning weight LANDS, not when it was
    // let go: the lock is the moment the dish takes the weight.
    this.whenWinningWeightLands(() => this.celebrate(reviewAsks, stars))
  }

  /**
   * Run `fn` once the weight that completed the board has landed (see
   * onLanded), or at once when nothing is in flight (a win by taking a weight
   * off). A fallback fires it anyway after 600 ms, so a win can never stall.
   */
  private whenWinningWeightLands(fn: () => void) {
    const flying = this.lastPlaced !== null && this.placed[this.lastPlaced] && this.pendingLand.has(this.lastPlaced)
    if (!flying) {
      fn()
      return
    }
    this.pendingWinIndex = this.lastPlaced
    this.onWinLanded = fn
    this.time.delayedCall(600, () => this.startWinSequence())
  }

  /** The pending celebration, once (the landing, or the fallback timer). */
  private startWinSequence() {
    const fn = this.onWinLanded
    this.onWinLanded = null
    this.pendingWinIndex = null
    fn?.()
  }

  /**
   * The win, in beats from the moment the beam takes the last weight:
   *   0 ms   the lock — the board holds still for 70 ms (hit-stop), the beam
   *          flashes, the total pops, a heavy haptic and the lock chord;
   *   120    a green ring bursts from the pivot;
   *   350    confetti and "Congratulations!" (gone again by 850);
   *   380    the "six-seven" jingle, the Success haptic, the music ducks;
   *   900    the card, and the fanfare.
   * Under reduced motion: no hit-stop, flash, ring, shake or confetti, and the
   * card comes at 600. The card never has anything drawn over it.
   */
  private celebrate(reviewAsks: boolean, stars: number) {
    const rm = this.reducedMotion
    if (!rm) this.hitStopUntil = this.time.now + 70
    this.scaleView.flash()
    if (!rm) {
      this.tweens.killTweensOf(this.totalText)
      this.tweens.add({ targets: this.totalText, scale: { from: 1.35, to: 1 }, duration: 260, ease: 'Back.out' })
    }
    lockTap()
    playLock()
    this.time.delayedCall(120, () => ringBurst(this, this.geo.cx, this.geo.cy, this.geo.halfBeam * 1.1, GOOD))
    this.time.delayedCall(rm ? 0 : 350, () => {
      if (!rm) this.cameras.main.shake(160, 0.004)
      this.burstConfetti()
      this.showCongratulations()
    })
    this.time.delayedCall(rm ? 0 : 380, () => {
      // Pull the music bed down so the jingle and fanfare cut through instead
      // of fighting the pad underneath.
      duckMusic(0.2, 2.6)
      playWinJingle()
      winTap()
    })
    this.time.delayedCall(rm ? 600 : 900, () => {
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
        duration: 180,
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
      duration: 220,
      ease: 'Back.easeOut',
      // Hold it just long enough to be read, then clear the way: it is gone
      // before the card arrives (celebrate), never drawn over it.
      onComplete: () => this.time.delayedCall(100, fade),
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

    // A light dim: the balanced beam behind the card is the payoff, not a backdrop.
    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.28)
    dim.setInteractive() // swallow taps behind the card
    overlay.add(dim)
    // The card and everything on it ride one container, so it can rise in as one.
    const sheet = this.add.container(0, 0)
    overlay.add(sheet)

    const f = this.frame()
    const cx = this.wideMode ? this.tray.x + this.tray.width / 2 : w / 2
    // Portrait: exactly the tray's width, so its outline never peeks out as a
    // second frame around a card sitting over it.
    const cardW = this.wideMode ? Math.min(this.tray.width - u(40), u(372)) : Math.min(this.tray.width, u(400))

    // --- measure rows first, so the card is exactly as tall as what it holds.
    const summaryText = this.winSummary(win)
    const sub = this.add.text(cx, 0, summaryText, TEXT.ink(15, '700')).setOrigin(0.5, 0)
    sub.setColor(INK_SOFT).setAlign('center')
    if (sub.width > cardW - u(40)) sub.setScale((cardW - u(40)) / sub.width)
    const waysLabel = this.waysTotal > 1 && win.which !== null ? `Way ${win.which} of ${this.waysTotal}` : this.waysTotal === 1 ? 'Only way' : ''
    const firstLevels = !this.daily && this.ref.global <= 3
    const showMeta = this.daily || (!hintsUnlimited() && win.reward?.placement !== 'jar')
    const packLine = this.packGoalLine(win)
    const retryLink = !this.daily && !firstLevels && win.stars < 3
    const rows = {
      top: u(20),
      title: u(38),
      stars: u(64),
      sub: sub.displayHeight + u(6),
      pill: waysLabel ? u(30) : u(4),
      meta: showMeta ? u(46) + (this.daily && win.tomorrow ? u(16) : 0) : 0,
      pack: packLine ? u(24) : 0,
      reward: win.reward ? u(104) : 0,
      intro: win.intro ? u(104) : 0,
      extra: win.remind !== 'none' ? u(70) : win.nudge ? u(34) : 0,
      retry: retryLink ? u(34) : 0,
      nav: u(58) + u(20),
    }
    const cardH = Object.values(rows).reduce((a, b) => a + b, 0) + u(8)
    // A sheet from the bottom that leaves the level beam in view; where it cannot
    // (a short phone, a tall card) it falls back to the centre of the screen.
    const bottomTop = this.tray.y + this.tray.height - cardH
    const beamClear = this.geo.cy + this.geo.halfBeam * 0.1 + u(28)
    let top: number
    if (this.wideMode) top = Math.max(safe.top + u(8), (h - cardH) / 2)
    else if (bottomTop >= beamClear) top = bottomTop
    else {
      const avail = h - safe.top - safe.bottom
      top = safe.top + Math.max(cardH / 2 + u(8), Math.min(avail * 0.46, avail - cardH / 2 - u(8))) - cardH / 2
    }

    const card = this.add.graphics()
    drawCard(card, cx - cardW / 2, top, cardW, cardH, u(26))

    let y = top + rows.top
    const titleWords = this.daily ? 'DAILY 67!' : this.ref.global === 67 ? 'SIX-SEVEN!' : 'EXACTLY 67!'
    const title = this.add.text(cx, y + rows.title / 2, titleWords, TEXT.ink(28, '800')).setOrigin(0.5)
    y += rows.title

    // Three star slots; earned ones pop in with a rising pitch.
    const starR = u(24)
    const starViews: Phaser.GameObjects.Graphics[] = []
    for (let i = 0; i < 3; i++) {
      const sg = this.add.graphics()
      drawStar(sg, 0, 0, i === 1 ? u(30) : starR, i < win.stars)
      sg.setPosition(cx + (i - 1) * (starR * 2.7), y + rows.stars / 2)
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
    const kids: Phaser.GameObjects.GameObject[] = [card, title, ...starViews, sub]

    // "Only way" / "Way 1 of 2": a pill, not a dangling lowercase line.
    if (waysLabel) {
      const t = this.add.text(cx, y + u(13), waysLabel, TEXT.ink(12, '700')).setOrigin(0.5).setColor(INK_SOFT)
      const pw = t.width + u(20)
      const pill = this.add.graphics()
      pill.fillStyle(0xefe6d6, 1)
      pill.fillRoundedRect(cx - pw / 2, y + u(2), pw, u(22), u(11))
      kids.push(pill, t)
    }
    y += rows.pill

    if (rows.meta) {
      kids.push(...(this.daily ? this.streakRow(win, cx, y, cardW, anim) : this.jarRow(win, cx, y, cardW, anim)))
      y += rows.meta
    }
    if (packLine) {
      kids.push(this.add.text(cx, y + u(10), packLine, TEXT.ink(12, '700')).setOrigin(0.5).setColor(INK_SOFT))
      y += rows.pack
    }
    if (win.reward) {
      win.rewardAt = { x: cx - cardW / 2 + u(14) + u(30), y: y + u(24) }
      kids.push(...this.rewardRow(win.reward, cx, y, cardW))
      y += rows.reward
    }
    if (win.intro) {
      kids.push(
        ...this.dailyIntroRow(cx, y, cardW, () => {
          if (win.acted || win.reward?.busy) return
          win.acted = true
          // "Today" is read at the tap: a card left open past midnight opens the new day's puzzle.
          this.leaveAfterClear(() => this.scene.restart({ daily: true }))
        }),
      )
      y += rows.intro
    }
    if (win.remind !== 'none') {
      kids.push(...this.remindRow(win, cx, y, cardW))
      y += rows.extra
    } else if (win.nudge) {
      const link = this.add
        // The price named up front (StoreKit's, when it has loaded): no surprise on the next screen.
        .text(cx, y + rows.extra / 2, noAdsPrice() ? `Remove ads between levels · ${noAdsPrice()}` : 'Remove ads between levels', TEXT.ink(13, '700'))
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
    const btnH = u(58)
    const once = (fn: () => void) => () => {
      if (win.acted || win.reward?.busy) return
      win.acted = true
      fn()
    }
    const inner = cardW - u(32)
    let nextBtn: Phaser.GameObjects.Container
    if (this.daily) {
      const calW = inner * 0.42
      const doneW = inner - calW - u(10)
      const cal = makeButton(this, 'Calendar', calW, btnH, PAPER, '#2B2440', once(() => this.scene.start('Daily', {})))
      cal.setPosition(cx - cardW / 2 + u(16) + calW / 2, btnY)
      nextBtn = makeButton(this, 'Done', doneW, btnH, 0xf5b942, '#2B2440', once(() => this.scene.start('Menu')))
      nextBtn.setPosition(cx + cardW / 2 - u(16) - doneW / 2, btnY)
      kids.push(cal, nextBtn)
    } else {
      // One primary action, full width, naming where it goes.
      const hasNext = this.ref.global < TOTAL_LEVELS
      const next = hasNext ? levelByGlobal(this.ref.global + 1) : null
      const label = !next ? 'The End!' : next.packIndex !== this.ref.packIndex ? `Next pack: ${next.pack.name}` : `Next · Level ${this.ref.global + 1}`
      nextBtn = makeButton(this, label, inner, btnH, 0xf5b942, '#2B2440', once(() => {
        this.leaveAfterClear(() =>
          hasNext ? this.restartWithFade({ level: this.ref.global + 1 }) : this.scene.start('LevelMap', { scrollTo: this.ref.global }),
        )
      }))
      nextBtn.setPosition(cx, btnY)
      kids.push(nextBtn)
      if (retryLink) {
        // Retry only means something below three stars: say what it is for.
        const link = this.add
          .text(cx, btnY - btnH / 2 - u(4) - rows.retry / 2, `Retry for ★★★ (min ${this.minWeights})`, TEXT.ink(13, '700'))
          .setOrigin(0.5)
          .setColor(INK_SOFT)
          .setPadding({ x: u(16), y: u(8) })
          .setInteractive({ useHandCursor: true })
        onTap(link, once(() => this.restartWithFade({ level: this.ref.global })))
        kids.push(link)
      }
      // The first three cards: Next and nothing else.
      if (!firstLevels) {
        const map = makeIconButton(this, u(40), (g, sz) => drawGridIcon(g, sz), once(() => {
          this.leaveAfterClear(() => this.scene.start('LevelMap', { scrollTo: this.ref.global }))
        }))
        map.setPosition(cx - cardW / 2 + u(30), top + u(30))
        kids.push(map)
      }
    }
    // Share: a small corner button — sharing does not navigate, so it stays live
    // after the sheet is dismissed. The Daily shares too: the same board for
    // everyone is the one worth comparing.
    if (!firstLevels) {
      const share = makeIconButton(this, u(40), (g, sz) => drawShareIcon(g, sz), () => {
        void this.shareResult(win.used, win.stars, win.which)
      })
      share.setPosition(cx + cardW / 2 - u(30), top + u(30))
      kids.push(share)
    }
    sheet.add(kids)

    // One more level is the whole loop: once the card has settled, Next breathes.
    if (!this.reducedMotion) {
      this.tweenWith(
        nextBtn,
        this.tweens.add({
          targets: nextBtn,
          scale: { from: 1, to: 1.04 },
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
      sheet.y = u(40)
      this.tweenWith(overlay, this.tweens.add({ targets: overlay, alpha: 1, duration: 200 }))
      this.tweenWith(sheet, this.tweens.add({ targets: sheet, y: 0, duration: 260, ease: 'Back.out(1.2)' }))
    }
    // Hints paid at the win travel to the hint button: the reward is seen landing.
    if (animate && win.reward && !win.reward.flown) {
      win.reward.flown = true
      const r = win.reward
      this.time.delayedCall(anim ? 700 : 0, () => {
        if (this.win !== win || !r) return
        this.flyHintsHome(win.rewardAt, r.base)
      })
    } else if (!animate) {
      this.refreshHint()
    }
    void f
  }

  /**
   * Bulbs fly from `from` to the HUD hint button and its badge steps up as they
   * land, ending on the real stash. The hints are already paid; this only shows
   * where they went. Under reduced motion the badge just updates.
   */
  private flyHintsHome(from: { x: number; y: number } | undefined, n: number) {
    if (n <= 0 || hintsUnlimited()) {
      this.refreshHint()
      return
    }
    const end = hintCountValue()
    const start = end - n
    const btn = this.hudButtons.hint
    flyBulbs(this, from ?? { x: this.scale.width / 2, y: this.scale.height / 2 }, { x: btn.x, y: btn.y }, n, (i, last) => {
      if (!this.sys.isActive()) return
      const count = Math.min(n, 8)
      this.refreshHint(last ? undefined : start + Math.round(((i + 1) / count) * n))
      popTarget(this, btn)
    })
  }

  /**
   * "3 levels to the Prime Time bonus: +3 hints" — under the jar, while the
   * pack's one-time bonus is still to come and close (five levels or fewer).
   * Every reward is fixed and shown first; this one just says how near it is.
   */
  private packGoalLine(win: WinCard): string | null {
    if (this.daily || hintsUnlimited() || win.level?.pack) return null
    const index = this.ref.packIndex
    if (index < 0 || meta().packRewards.includes(index)) return null
    const info = packInfo(index)
    const left = info.levels - info.cleared
    if (left <= 0 || left > 5) return null
    return `${left} level${left === 1 ? '' : 's'} to the ${this.ref.pack.name} bonus: +${PACK_HINTS} hints`
  }

  /** The card's line under the stars: pieces used, against the minimum when it isn't it. */
  private winSummary(win: WinCard): string {
    const best = this.daily ? undefined : bestFor(progress(), this.ref.global)
    const pieces = `${win.used} piece${win.used === 1 ? '' : 's'}`
    if (win.used <= this.minWeights) return `${pieces} · perfect ✓`
    // Below 3★ the honest near-miss is the reason to replay: say the gap.
    return `${pieces} · minimum is ${this.minWeights}` + (best !== undefined && best < win.used ? ` · best ${best}` : '')
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
    const out: Phaser.GameObjects.GameObject[] = []
    // The first streak: one line over the flame on what tomorrow brings.
    if (win.tomorrow) {
      const cap = this.add.text(cx, y + u(8), win.tomorrow, TEXT.ink(11, '700')).setOrigin(0.5).setColor(INK_SOFT)
      if (cap.width > cardW - u(44)) cap.setScale((cardW - u(44)) / cap.width)
      out.push(cap)
      y += u(16)
    }
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
    out.push(flame, label)
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

  /**
   * The Daily intro (game/dailyIntro): a player who never solved a Daily is sent
   * to today's puzzle from a level's win card — the streak, the gift ladder and
   * the reminder offer all start there. Next stays the biggest button.
   */
  private dailyIntroRow(cx: number, y: number, cardW: number, play: () => void): Phaser.GameObjects.GameObject[] {
    const panelX = cx - cardW / 2 + u(14)
    const panelW = cardW - u(28)
    const panelH = u(94)
    const panel = this.add.graphics()
    panel.fillStyle(0xeef6ff, 1)
    panel.fillRoundedRect(panelX, y, panelW, panelH, u(18))
    panel.lineStyle(u(3), INK, 1)
    panel.strokeRoundedRect(panelX, y, panelW, panelH, u(18))
    const titleY = y + u(24)
    const icon = this.add.graphics()
    drawFlame(icon, panelX + u(30), titleY, u(28), false)
    const title = this.add.text(panelX + u(54), titleY - u(8), 'Daily Challenge', TEXT.ink(15, '800')).setOrigin(0, 0.5)
    const line = this.add
      .text(panelX + u(54), titleY + u(12), 'New every day · start a streak', TEXT.ink(12, '700'))
      .setOrigin(0, 0.5)
      .setColor(INK_SOFT)
    const maxText = panelW - u(64)
    for (const t of [title, line]) if (t.width > maxText) t.setScale(maxText / t.width)
    const btn = makeButton(this, "Play today's puzzle", panelW - u(24), u(40), 0xd0ebff, '#2B2440', play)
    btn.setPosition(cx, y + u(68))
    return [panel, icon, title, line, btn]
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
      if (this.sys.isActive()) this.refreshHint(hintCountValue() - (r.ad - r.base))
    }
    if (!this.sys.isActive()) return
    this.redrawWin()
    if (outcome === 'earned') this.flyHintsHome(this.win?.rewardAt, r.ad - r.base)
    // 'no-consent': the tap asked for ad consent and got no yes — the player
    // just chose, so nothing is said (a no also took the button away).
    if (outcome === 'unavailable' || outcome === 'not-earned') {
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
        daily: this.daily ? dailyLabel(this.dailyDate) : undefined,
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
      } else if (key === 'Escape') {
        if (this.daily) this.scene.start('Daily', {})
        else this.scene.start('LevelMap', { scrollTo: this.ref.global })
      }
    })
  }
}
