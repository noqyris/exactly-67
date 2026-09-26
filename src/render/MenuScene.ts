import Phaser from 'phaser'
import { formatCountdown, msUntilNextDay } from '../game/days'
import { GIFT_AD_BONUS, GIFT_LADDER, JAR_CAPACITY } from '../game/economy'
import { levelByGlobal, TOTAL_LEVELS } from '../game/levels'
import { isCleared, totalStars } from '../game/progress'
import {
  adsSettled,
  adsSupported,
  hintCountValue,
  hintsUnlimited,
  openPrivacyOptions,
  rewardedAvailable,
  rewardedBusy,
  watchRewarded,
} from '../services/ads'
import { playPlace, playReward, setSoundEnabled, soundEnabled } from '../services/audio'
import { hapticsEnabled, placeTap, setHapticsEnabled } from '../services/haptics'
import { iapSupported, setIapListener, welcomePrice } from '../services/iap'
import { musicEnabled, setMusicEnabled } from '../services/music'
import { disableReminders, enableReminders, reminderPermission, remindersEnabled } from '../services/notifications'
import { progress } from '../services/progressStore'
import {
  claimGift,
  dailyDoneToday,
  giftDue,
  giftInfo,
  isFirstRun,
  jarStars,
  lostStreak,
  packInfo,
  repairOpen,
  streak,
  streakSafeToday,
  syncReminders,
  takeStreakNotice,
  welcomeOffered,
} from '../services/progression'
import { signalOnboardingDone, splashFinished, takePendingRoute } from '../services/session'
import { saveHapticsEnabled, saveMusicEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, prefersReducedMotion, safeArea, u } from './layout'
import { BG, INK, INK_CSS, OUTLINE, PAPER } from './palette'
import { ScaleView } from './ScaleView'
import {
  drawBellIcon,
  drawBulb,
  drawCard,
  drawFlame,
  drawGearIcon,
  drawGift,
  drawHapticsIcon,
  drawJar,
  drawLogo,
  drawMusicIcon,
  drawProgressBar,
  drawSoundIcon,
  logoExtent,
  makeButton,
  makeChip,
  makeIconButton,
  onTap,
  TEXT,
} from './ui'

const INK_SOFT = '#5D5470'

/** What the reminder toggle says when iOS has notifications switched off. */
const NOTIFY_DENIED = 'Allow notifications in Settings → Exactly 67'

/** How often the open menu re-reads the clock: the countdown, the day's rollover. */
const CLOCK_TICK_MS = 30_000

/** The first run skips the menu once, straight into Level 1 (see isFirstRun). */
let skippedForFirstRun = false

export class MenuScene extends Phaser.Scene {
  private scaleView?: ScaleView
  private hintChip?: ReturnType<typeof makeChip>
  private modal: Phaser.GameObjects.Container | null = null
  /** Bottom of the top bar (and the Privacy link under it): modal cards never climb over it. */
  private headerBottom = 0
  /** Re-sets "next in 5h 20m" on a solved daily card; null otherwise. */
  private refreshCountdown: (() => void) | null = null
  /** A rebuild is waiting for the open card / the video in flight to end. */
  private restartPending = false
  private restartQueued = false

  constructor() {
    super('Menu')
  }

  create() {
    // A brand-new player meets the game, not a menu: Level 1 teaches itself.
    if (isFirstRun() && !skippedForFirstRun) {
      skippedForFirstRun = true
      this.scene.start('Game', { level: 1 })
      return
    }
    skippedForFirstRun = true
    this.scaleView = undefined
    // A tapped reminder that arrived while a level was open lands here. A daily
    // one that came in while the player was on today's board is spent once they
    // have solved it: acting on it now would reopen a board they just finished.
    // A 'menu' route (a tapped gift reminder) is already where it wants to be.
    const route = takePendingRoute()
    if (route === 'map' || (route === 'daily' && !dailyDoneToday())) {
      if (route === 'daily') this.scene.start('Game', { daily: true })
      else this.scene.start('LevelMap', {})
      return
    }
    // Reaching the menu counts as "past onboarding": the ad layer may start.
    signalOnboardingDone()
    this.modal = null
    this.refreshCountdown = null
    this.restartPending = false
    this.restartQueued = false

    this.cameras.main.setBackgroundColor(BG)
    const h = this.scale.height
    const f = contentFrame(this.scale.width, h)
    const cx = f.cx
    const safe = safeArea()
    const topAnchor = Math.max(f.oy, safe.top)

    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const started = totalStars(p) > 0
    const s = streak()
    const doneToday = dailyDoneToday()
    // The planner's facts, tomorrow's gift rung included (progression owns them).
    syncReminders()

    // --- top bar: streak · jar · hints · settings ------------------------------
    const barY = topAnchor + u(34)
    const chipH = u(38)
    const left = f.ox + Math.max(u(16), safe.left)
    const right = f.ox + f.ew - Math.max(u(16), safe.right)
    const flameChip = makeChip(this, chipH, (g, x, y, sz) => drawFlame(g, x, y, sz, doneToday && s.current > 0), String(s.current), () =>
      this.scene.start('Daily', {}),
    )
    flameChip.setPosition(left + flameChip.chipWidth / 2, barY)
    const cursor = left + flameChip.chipWidth + u(8)
    const gear = makeIconButton(this, u(42), (g, sz) => drawGearIcon(g, sz), () => this.showSettings())
    gear.setPosition(right - u(21), barY)
    this.hintChip = makeChip(this, chipH, (g, x, y, sz) => drawBulb(g, x, y, sz), hintsUnlimited() ? '∞' : String(hintCountValue()), () => {
      if (iapSupported() && !hintsUnlimited()) this.scene.start('Store', {})
    })
    const hintLeft = right - u(42) - u(8) - this.hintChip.chipWidth
    this.hintChip.setPosition(hintLeft + this.hintChip.chipWidth / 2, barY)
    if (!hintsUnlimited()) {
      // The jar sits between the streak and the hints; on a narrow phone it
      // drops its "/20" rather than run into the hint chip.
      const jarDraw = (g: Phaser.GameObjects.Graphics, x: number, y: number, sz: number) => drawJar(g, x, y, sz, jarStars() / JAR_CAPACITY)
      const jar = makeChip(this, chipH, jarDraw, `${jarStars()}/${JAR_CAPACITY}`, () => this.showJarInfo())
      if (cursor + jar.chipWidth + u(8) > hintLeft) jar.setLabel(String(jarStars()))
      if (cursor + jar.chipWidth + u(8) > hintLeft) jar.setVisible(false).disableInteractive()
      jar.setPosition(cursor + jar.chipWidth / 2, barY)
    }

    // --- privacy choices ------------------------------------------------------------
    // Re-opens the ad-consent decision, so a player who declined can say yes and
    // one who accepted can withdraw (GDPR: as easy as consenting). It lives in
    // Settings too, but the consent modal, the in-app copy and the privacy policy
    // all say "Privacy choices on the main menu" — so it stays here, where that
    // wording points. Only for players the ad SDK can ever run for (Unlimited
    // owners never start it). A quiet link under the gear, far from the bottom
    // banner: a control next to an ad is a mis-tap waiting to be counted as a
    // click. Small glyphs, generous padding, so the target is still ~44pt; its
    // top edge sits below the gear's, so a gear tap can never land on it.
    let titleY = barY + chipH / 2 + f.eh * 0.07
    this.headerBottom = barY + chipH / 2
    if (adsSupported() && !hintsUnlimited()) {
      const padX = u(10)
      const padY = u(16)
      const privacy = this.add
        .text(right + padX, barY + u(22), 'Privacy choices', TEXT.ink(12, '700'))
        .setOrigin(1, 0)
        .setColor(INK_SOFT)
        .setPadding({ x: padX, y: padY })
        .setInteractive({ useHandCursor: true })
      // Armed taps only: it sits just under the gear and the hint chip, and a
      // press there that slides down must not open the consent sheet.
      onTap(privacy, () => void openPrivacyOptions(), true)
      // On a short phone the title would crowd the link (they overlap across at
      // 320 pt): drop it just enough that the capitals clear the link's line.
      const linkLineBottom = privacy.y + privacy.height - padY
      titleY = Math.max(titleY, linkLineBottom + u(20))
      this.headerBottom = linkLineBottom
    }

    // The column below is pinned above the banner strip; the title sizes itself
    // around the column's full height. Base heights, compressed together on a
    // short screen so nothing overlaps.
    const columnBottom = h - safe.bottom - u(14)
    const base = { play: 64, packLine: 30, daily: 64, row: 52, gap: 12 }
    const baseTotal = base.play + base.packLine + base.gap + base.daily + base.gap + base.row

    // --- title: the wordmark over the app icon's artwork ---------------------------
    // The candy "67" on its level beam is the home-screen icon's own art, so the
    // menu opens on the picture the player just tapped.
    const word = this.add.text(cx, titleY, 'EXACTLY', TEXT.ink(32, '800')).setOrigin(0.5)
    const artTop = titleY + u(11) + u(10) // Baloo 2's capitals stand ~22 pt tall at 32 pt
    // On a tall screen the logo keeps to about a third of the height and the idle
    // scale gets the rest. Where that scale would not fit under it anyway (u(104)
    // is its minimum gap, 96, with its spacing), the logo grows into the space
    // instead of leaving a hole, down to a full-size column; on a 320 pt phone it
    // keeps a readable size and the column compresses a little. The width cap
    // keeps it a mark, not a poster, on a tablet.
    const perSize = logoExtent(1).bottom - logoExtent(1).top
    const third = (h - safe.bottom - artTop) * 0.334
    const fit = columnBottom - u(baseTotal) - u(44) - artTop // the tagline and its gaps take u(44)
    const art = fit - third > u(104) ? third : Math.max(third, fit)
    const sizeFor = (perSize: number) => Math.min(f.ew * 0.86, u(300), art / perSize)
    // The numerals sit just under the capitals; the sparkles rise beside the
    // wordmark, unless one would touch it: then its tip clears the capitals too.
    const band = word.width / 2 + u(8)
    let logoSize = sizeFor(perSize)
    let logo = logoExtent(logoSize, band)
    const tight = (logo.bottom - logo.top) / logoSize
    if (tight < perSize) {
      // Sparkles beside the wordmark take no height, so the logo grows into it
      // (and a bigger logo only moves them further out: they stay clear).
      logoSize = sizeFor(tight)
      logo = logoExtent(logoSize, band)
    }
    const logoY = artTop - logo.top
    const logoArt = drawLogo(this, cx, logoY, logoSize)
    let tagY = logoY + logo.bottom + u(22)
    const tagline = this.add
      .text(cx, tagY, 'Balance the scale. Land on exactly 67.', TEXT.ink(15, '600'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)

    // --- the column, pinned above the banner strip ------------------------------
    const colW = Math.min(f.ew - u(48), u(300))
    const showStore = iapSupported() && !hintsUnlimited()
    const room = columnBottom - (tagY + u(22))
    const kc = Phaser.Math.Clamp(room / u(baseTotal), 0.72, 1)
    const k = (n: number) => u(n) * kc
    const rowY = columnBottom - k(base.row) / 2
    const dailyY = rowY - k(base.row) / 2 - k(base.gap) - k(base.daily) / 2
    const packY = dailyY - k(base.daily) / 2 - k(base.gap) - k(base.packLine) / 2
    const playY = packY - k(base.packLine) / 2 - k(base.play) / 2

    // The idle scale between the tagline and the column — only when it fits.
    let gapTop = tagY + u(20)
    const gapBottom = playY - k(base.play) / 2 - u(10)
    let gapH = gapBottom - gapTop
    if (gapH <= u(96) && gapH > u(12)) {
      // No room for the scale, but a band too big to leave empty (≈80 pt on the
      // most common iPhones, where the logo hits its size cap): centre the whole
      // title block instead, splitting that band above and below it.
      const dy = gapH / 2
      word.y += dy
      logoArt.y += dy
      tagline.y += dy
      tagY += dy
      gapTop += dy
      gapH -= dy
    }
    if (gapH > u(96)) {
      const kk = Math.min(1, gapH / u(170))
      const halfBeam = Math.min(f.ew * 0.24, u(140)) * kk
      const ropeLen = Math.min(f.eh * 0.07, u(64)) * kk
      const panWidth = Math.min(f.ew * 0.19, u(104)) * kk
      this.scaleView = new ScaleView(this, {
        cx,
        cy: gapTop + (gapH - ropeLen - panWidth * 0.22) / 2 + u(8),
        halfBeam,
        ropeLen,
        panWidth,
        panHeight: panWidth * 0.22,
      })
      this.scaleView.setTargetAngle(0)
      this.scaleView.settleImmediately()
    }

    const play = makeButton(
      this,
      started ? `Continue  ·  Level ${next}` : 'Play',
      colW,
      k(base.play),
      0xf5b942,
      '#2B2440',
      () => this.scene.start('Game', { level: next }),
    )
    play.setPosition(cx, playY)
    this.breathe(play)

    // Pack progress under Play: where "Level N" sits in the bigger picture.
    const ref = levelByGlobal(next)
    if (ref) {
      const info = packInfo(ref.packIndex)
      const g = this.add.graphics()
      const barW = colW * 0.46
      const label = this.add
        .text(cx - colW / 2 + u(4), packY, ref.pack.name, TEXT.ink(13, '800'))
        .setOrigin(0, 0.5)
      const count = this.add.text(cx + colW / 2 - u(4), packY, `${info.cleared}/${info.levels}`, TEXT.ink(13, '800')).setOrigin(1, 0.5)
      const barRight = count.x - count.width - u(8)
      const barLeft = Math.max(label.x + label.width + u(10), barRight - barW)
      drawProgressBar(g, barLeft, packY - u(6), Math.max(u(30), barRight - barLeft), u(12), info.cleared / info.levels, 0x69db7c)
    }

    // The Daily Challenge card: the streak's home on the menu.
    this.dailyCard(cx, dailyY, colW, k(base.daily), s.current, doneToday)

    // Levels · Store
    const halfW = (colW - u(12)) / 2
    const levels = makeButton(this, 'Levels', showStore ? halfW : colW, k(base.row), PAPER, '#2B2440', () =>
      this.scene.start('LevelMap', {}),
    )
    levels.setPosition(showStore ? cx - colW / 2 + halfW / 2 : cx, rowY)
    if (showStore) {
      // The one-time Welcome pack rides on the Store button — passive, never a pop-up.
      const welcomeNow = () => (welcomeOffered() ? welcomePrice() : null)
      let welcome = welcomeNow()
      let store: Phaser.GameObjects.Container | null = null
      const placeStore = () => {
        store?.destroy()
        store = makeButton(this, 'Store', halfW, k(base.row), PAPER, '#2B2440', () => this.scene.start('Store', {}), welcome ? 'Welcome pack!' : undefined)
        store.setPosition(cx + colW / 2 - halfW / 2, rowY)
      }
      placeStore()
      // StoreKit's prices land a moment after every cold launch. Only an
      // ownership change reshapes the menu (the Store button goes, hints turn ∞)
      // and earns a rebuild; the Welcome price arriving — or leaving, with a
      // purchase — only redraws the Store button, so it cannot wipe a notice, an
      // open card or a gift video in flight.
      setIapListener(() => {
        if (!iapSupported() || hintsUnlimited()) {
          this.requestRestart()
          return
        }
        const now = welcomeNow()
        if (now !== welcome) {
          welcome = now
          placeStore()
        }
      })
      this.events.once('shutdown', () => setIapListener(null))
    }

    // One-shot notices from reconciling the streak at launch — taken only once
    // the studio sting is gone: on a cold start the menu is built under it, and
    // a toast there fades before anyone can read it. Untaken, a notice waits for
    // the next menu instead of being lost.
    void splashFinished().then(() => {
      if (!this.sys.isActive()) return
      const notice = takeStreakNotice()
      if (notice?.kind === 'frozen') {
        this.toast(notice.days === 1 ? 'A freeze saved your streak yesterday' : `Freezes saved your streak (${notice.days} days)`)
      } else if (notice?.kind === 'broken' && repairOpen()) {
        this.toast(`Your ${lostStreak()}-day streak can still be restored`)
      }
    })

    // The daily gift, once per day — after the ad layer has settled, so a
    // consent modal still on screen doesn't decide whether the ad button shows.
    if (giftDue()) {
      void Promise.race([adsSettled(), new Promise((r) => setTimeout(r, 6000))]).then(() => {
        if (this.sys.isActive() && giftDue() && !this.modal) this.showGift()
      })
    }

    // Rebuild on resize (a fold, a Split View change) — debounced, so a burst
    // of resize events during the fold animation costs one rebuild.
    let pending: Phaser.Time.TimerEvent | null = null
    const onResize = () => {
      pending?.remove()
      pending = this.time.delayedCall(150, () => this.scene.restart())
    }
    this.scale.on('resize', onResize)
    this.events.once('shutdown', () => this.scale.off('resize', onResize))

    // The menu is a picture of today — the flame, the daily card, the streak. A
    // menu left open across midnight rebuilds itself just after the day turns
    // (a little late, so the new day's key is certain), and a solved card's
    // "next in …" keeps counting down meanwhile. The scene clock stops while the
    // app sleeps, so the wall clock decides; the tick also re-checks on return
    // to the foreground. Timers die with the scene (Phaser clears its clock).
    const dayEnds = Date.now() + msUntilNextDay(new Date())
    const tick = () => {
      if (Date.now() >= dayEnds || this.restartPending) this.requestRestart()
      else this.refreshCountdown?.()
    }
    this.time.delayedCall(dayEnds - Date.now() + 1500, tick)
    this.time.addEvent({ delay: CLOCK_TICK_MS, loop: true, callback: tick })
    this.game.events.on(Phaser.Core.Events.VISIBLE, tick)
    this.events.once('shutdown', () => this.game.events.off(Phaser.Core.Events.VISIBLE, tick))
  }

  /**
   * Rebuild the menu, but never over an open card or a video in flight: a
   * rebuild would wipe the card (a gift half-claimed, the settings mid-toggle).
   * A blocked rebuild runs when the card closes, or on the next clock tick.
   */
  private requestRestart() {
    if (this.restartQueued) return
    if (this.modal || rewardedBusy()) {
      this.restartPending = true
      return
    }
    this.restartPending = false
    this.restartQueued = true
    this.scene.restart()
  }

  update(time: number, delta: number) {
    this.scaleView?.update(time, delta)
  }

  /** A slow breath on the primary button — the eye's first stop. */
  private breathe(target: Phaser.GameObjects.Container) {
    if (prefersReducedMotion()) return
    this.tweens.add({ targets: target, scale: { from: 1, to: 1.035 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  private dailyCard(cx: number, cy: number, w: number, h: number, current: number, done: boolean) {
    const c = this.add.container(cx, cy)
    const g = this.add.graphics()
    const fill = done ? PAPER : 0xfff1c7
    const draw = (pressed: boolean) => {
      g.clear()
      const dy = pressed ? u(4) : 0
      if (!pressed) {
        g.fillStyle(INK, 1)
        g.fillRoundedRect(-w / 2, -h / 2 + u(4), w, h, u(18))
      }
      g.fillStyle(fill, 1)
      g.fillRoundedRect(-w / 2, -h / 2 + dy, w, h, u(18))
      g.lineStyle(OUTLINE, INK, 1)
      g.strokeRoundedRect(-w / 2, -h / 2 + dy, w, h, u(18))
    }
    draw(false)
    const flame = this.add.graphics()
    drawFlame(flame, -w / 2 + h * 0.5, 0, h * 0.62, done && current > 0)
    const title = this.add.text(-w / 2 + h * 0.95, -h * 0.17, 'Daily Challenge', TEXT.ink(17, '800')).setOrigin(0, 0.5)
    const status = done
      ? `Solved ✓ · next in ${formatCountdown(msUntilNextDay(new Date()))}`
      : repairOpen()
        ? `Restore your ${lostStreak()}-day streak`
        : current > 0
          ? streakSafeToday()
            ? `Your ${current}-day streak is safe today`
            : `Keep your ${current}-day streak going`
          : 'A new puzzle every day'
    const sub = this.add.text(-w / 2 + h * 0.95, h * 0.2, status, TEXT.ink(12, '700')).setOrigin(0, 0.5).setColor(INK_SOFT)
    const room = w / 2 - u(40) - sub.x
    const fit = () => sub.setScale(sub.width > room ? room / sub.width : 1)
    fit()
    if (done) {
      this.refreshCountdown = () => {
        sub.setText(`Solved ✓ · next in ${formatCountdown(msUntilNextDay(new Date()))}`)
        fit()
      }
    }
    const chevron = this.add.text(w / 2 - u(18), 0, '›', TEXT.ink(28, '800')).setOrigin(0.5)
    c.add([g, flame, title, sub, chevron])
    c.setSize(w, h)
    c.setInteractive({ useHandCursor: true })
    let armed = false
    const move = (pressed: boolean) => {
      draw(pressed)
      const dy = pressed ? u(4) : 0
      flame.y = dy
      title.y = -h * 0.17 + dy
      sub.y = h * 0.2 + dy
      chevron.y = dy
    }
    c.on('pointerdown', () => {
      armed = true
      move(true)
    })
    c.on('pointerout', () => {
      armed = false
      move(false)
    })
    c.on('pointerup', () => {
      move(false)
      if (!armed) return
      armed = false
      // Unsolved → straight into today's board; solved or restorable → the calendar.
      if (done || repairOpen()) this.scene.start('Daily', {})
      else this.scene.start('Game', { daily: true })
    })
    if (!done) this.breathe(c)
  }

  // --- modals ---------------------------------------------------------------------

  private modalCardWidth(): number {
    return Math.min(this.scale.width - u(48), u(340))
  }

  /** A dimmed modal with a card; returns the container and the card's top/centre. */
  private openModal(cardH: number): { overlay: Phaser.GameObjects.Container; top: number; cardW: number; close: () => void } {
    const w = this.scale.width
    const h = this.scale.height
    const overlay = this.add.container(0, 0).setDepth(200)
    this.modal = overlay
    overlay.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.modal === overlay) this.modal = null
      // A rebuild held back while this card was open runs now (not while the
      // scene itself is shutting down — that destroys the card too).
      if (this.restartPending && this.sys.isActive()) this.requestRestart()
    })
    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45).setInteractive()
    const cardW = this.modalCardWidth()
    const safe = safeArea()
    const cy = Math.min(h * 0.45, h - safe.bottom - cardH / 2 - u(16))
    // Never over the top bar and the Privacy link (a tall card on a 320×568
    // phone climbed over the link, leaving "…ices" beside its corner) — unless
    // the screen is too short for both, when staying on screen wins.
    const top = Math.max(cy - cardH / 2, Math.min(this.headerBottom + u(8), h - safe.bottom - cardH - u(8)))
    const card = this.add.graphics()
    drawCard(card, w / 2 - cardW / 2, top, cardW, cardH, u(24))
    overlay.add([dim, card])
    if (!prefersReducedMotion()) {
      overlay.setAlpha(0)
      this.tweens.add({ targets: overlay, alpha: 1, duration: 160 })
    }
    return { overlay, top, cardW, close: () => overlay.destroy() }
  }

  /**
   * The daily gift: the five-day ladder (1, 2, 4, 6, 8 hints for days in a row),
   * taken free, or with a video's flat +2 on top. Never a toll.
   */
  private showGift() {
    const cx = this.scale.width / 2
    const gift = giftInfo()
    const hintsText = (n: number) => `${n} hint${n === 1 ? '' : 's'}`
    const { overlay, top, cardW, close } = this.openModal(u(320))
    const icon = this.add.graphics()
    drawGift(icon, cx, top + u(44), u(52))
    const title = this.add.text(cx, top + u(92), `Daily gift · Day ${gift.day}`, TEXT.ink(22, '800')).setOrigin(0.5)
    overlay.add([icon, title])

    // The ladder in full, so the climb is the reason to come back: the days
    // already taken this round ticked, today's in gold, the rest still to come.
    const inner = cardW - u(32)
    const days = GIFT_LADDER.length
    const gap = u(8)
    const slotW = Math.min(u(52), (inner - gap * (days - 1)) / days)
    const slotH = Math.min(u(62), slotW * 1.22)
    const rowW = slotW * days + gap * (days - 1)
    const slotY = top + u(138) + slotH / 2
    GIFT_LADDER.forEach((hints, i) => {
      const day = i + 1
      const state = day < gift.day ? 'claimed' : day === gift.day ? 'today' : 'future'
      const slot = this.giftSlot(cx - rowW / 2 + slotW / 2 + i * (slotW + gap), slotY, slotW, slotH, day, hints, state)
      overlay.add(slot)
    })
    // True once either button takes today's rung — and one of them must: the
    // card has no other way out.
    const nextLine =
      gift.next.day === 1
        ? 'Top of the ladder! Tomorrow it starts over.'
        : `Come back tomorrow for ${hintsText(gift.next.hints)}`
    const next = this.add
      .text(cx, slotY + slotH / 2 + u(24), nextLine, TEXT.ink(13, '700'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
    if (next.width > inner) next.setScale(inner / next.width)
    overlay.add(next)

    let busy = false
    const btnY = top + u(270)
    const btnH = u(50)
    // The amount is read again at the tap, not when the card opened: a card left
    // open across midnight would otherwise pay yesterday's rung after the ladder
    // has already reset (a day-4 card tapped at 00:01 paying 6 on a day-1 claim).
    const claim = (withAd: boolean) => {
      const n = giftInfo().hints + (withAd ? GIFT_AD_BONUS : 0)
      if (!claimGift(n)) {
        // Already claimed from another card: pay nothing, say nothing.
        close()
        return
      }
      playReward()
      // The video may have outlived this menu (backgrounded, a reminder tapped):
      // the hints are paid either way, but a torn-down scene's objects are gone.
      if (!this.sys.isActive()) return
      if (this.hintChip?.active) this.hintChip.setLabel(String(hintCountValue()))
      close()
      this.toast(`+${hintsText(n)}`)
    }
    const offerAd = rewardedAvailable('gift')
    if (!offerAd) {
      const b = makeButton(this, `Collect ${hintsText(gift.hints)}`, cardW * 0.6, btnH, 0xf5b942, '#2B2440', () =>
        claim(false),
      )
      b.setPosition(cx, btnY)
      overlay.add(b)
      return
    }
    const takeW = inner * 0.36
    const adW = inner - takeW - u(10)
    const take = makeButton(this, `Take ${gift.hints}`, takeW, btnH, PAPER, '#2B2440', () => {
      if (!busy) claim(false)
    })
    take.setPosition(cx - cardW / 2 + u(16) + takeW / 2, btnY)
    const ad = makeButton(this, `Watch ad: +${GIFT_AD_BONUS} more`, adW, btnH, 0xf5b942, '#2B2440', () => {
      // A video already loading or on screen elsewhere would make this one
      // 'unavailable' and grey the button for nothing: ignore the tap.
      if (busy || rewardedBusy()) return
      busy = true
      ad.setAlpha(0.6)
      take.setAlpha(0.5)
      void watchRewarded('gift').then((outcome) => {
        busy = false
        // Pay the upgrade only for a video watched to the end; otherwise the
        // free rung is still there to take.
        if (outcome === 'earned') {
          claim(true)
          return
        }
        if (!this.sys.isActive() || !ad.active) return
        take.setAlpha(1)
        if (outcome === 'unavailable') {
          // Nothing to show today (no fill, the cap spent): don't invite a retry.
          ad.setAlpha(0.35).disableInteractive()
          this.toast('No video right now — take the free one')
        } else {
          // A video did play and was closed early: say so, and let them try again.
          ad.setAlpha(1)
          this.toast("The ad didn't finish — take the free one")
        }
      })
    })
    ad.setPosition(cx + cardW / 2 - u(16) - adW / 2, btnY)
    overlay.add([take, ad])
  }

  /**
   * One rung of the gift ladder, in the calendar's language (DailyScene):
   * green and ticked when taken, gold with the heavy outline for today, pale for
   * the days to come. The hint count sits over a bulb, the hint unit everywhere.
   */
  private giftSlot(
    x: number,
    y: number,
    w: number,
    h: number,
    day: number,
    hints: number,
    state: 'claimed' | 'today' | 'future',
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y)
    const future = state === 'future'
    const g = this.add.graphics()
    const r = w * 0.26
    if (state === 'today') {
      g.fillStyle(INK, 1)
      g.fillRoundedRect(-w / 2, -h / 2 + u(4), w, h, r)
    }
    g.fillStyle(state === 'claimed' ? 0x8ce99a : state === 'today' ? 0xffd43b : 0xefe7d8, 1)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r)
    g.lineStyle(state === 'today' ? OUTLINE : u(2.5), INK, future ? 0.25 : 1)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r)
    const label = this.add
      .text(0, -h / 2 - u(11), `Day ${day}`, TEXT.ink(11, '800'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setAlpha(future ? 0.6 : 1)
    const count = this.add
      .text(0, -h * 0.16, String(hints), TEXT.ink(Math.min(22, w / u(2.2)), '800'))
      .setOrigin(0.5)
      .setAlpha(future ? 0.4 : 1)
    const mark = this.add.graphics()
    const markY = h * 0.24
    if (state === 'claimed') {
      mark.lineStyle(u(3), INK, 1)
      mark.beginPath()
      mark.moveTo(-w * 0.16, markY)
      mark.lineTo(-w * 0.04, markY + w * 0.12)
      mark.lineTo(w * 0.18, markY - w * 0.1)
      mark.strokePath()
    } else {
      drawBulb(mark, 0, markY, Math.min(u(20), w * 0.42))
      mark.setAlpha(future ? 0.35 : 1)
    }
    c.add([g, label, count, mark])
    if (state === 'today' && !prefersReducedMotion()) {
      // Removed with the slot: an endless tween on a destroyed card kept ticking
      // until the scene shut down, one more for every time the card opened.
      const pulse = this.tweens.add({ targets: c, scale: { from: 1, to: 1.07 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
      c.once(Phaser.GameObjects.Events.DESTROY, () => pulse.remove())
    }
    return c
  }

  private showJarInfo() {
    const cx = this.scale.width / 2
    const { overlay, top, cardW, close } = this.openModal(u(236))
    const icon = this.add.graphics()
    drawJar(icon, cx, top + u(50), u(56), jarStars() / JAR_CAPACITY)
    const title = this.add.text(cx, top + u(100), `Star Jar ${jarStars()}/${JAR_CAPACITY}`, TEXT.ink(20, '800')).setOrigin(0.5)
    const body = this.add
      .text(cx, top + u(132), 'Every new star you earn drops in.\nA full jar pays out hints.', TEXT.ink(13, '600'))
      .setOrigin(0.5, 0)
      .setAlign('center')
      .setColor(INK_SOFT)
    const ok = makeButton(this, 'Got it', cardW * 0.4, u(46), 0xf5b942, '#2B2440', close)
    ok.setPosition(cx, top + u(200))
    overlay.add([icon, title, body, ok])
  }

  /** Sound, music, haptics, daily reminders, and the ad-privacy decision. */
  private showSettings() {
    const cx = this.scale.width / 2
    const showPrivacy = adsSupported() && !hintsUnlimited()
    const cardW = this.modalCardWidth()
    const rowW = cardW - u(48)
    // The card is laid out top-down with a running cursor (offsets from its top
    // edge) and sized from where the cursor ends — a fixed height put Done over
    // the privacy link. The parts whose height depends on the text are built
    // first, so they can be measured.
    const note = this.add.text(cx, 0, NOTIFY_DENIED, TEXT.ink(11, '600')).setOrigin(0.5, 0).setColor(INK_SOFT)
    note.setWordWrapWidth(rowW).setAlign('center')
    // The note appears under the reminder row only when iOS says no; its line
    // (two, on a narrow phone) is reserved either way, so it never lands on the
    // privacy link below.
    const noteH = note.height
    note.setText('')
    // Re-opens the ad-consent decision: withdrawing must be as easy as
    // consenting (GDPR). Here, far from the bottom banner, a mis-tap can never
    // land on an ad. (The menu carries the same link; see create().)
    const privacy = showPrivacy
      ? this.add
          .text(cx, 0, 'Privacy choices', TEXT.ink(14, '800'))
          .setOrigin(0.5, 0)
          .setColor(INK_CSS)
          .setPadding({ x: u(16), y: u(12) })
          .setInteractive({ useHandCursor: true })
      : null
    if (privacy) onTap(privacy, () => void openPrivacyOptions(), true)

    const ROWS = 4
    const rowPitch = u(52)
    let cursor = u(50) // below the title; each row is centred in its pitch
    const rowsAt = cursor
    cursor += ROWS * rowPitch
    const noteAt = cursor
    cursor += noteH + u(6)
    const privacyAt = cursor
    if (privacy) cursor += privacy.height + u(4)
    const doneAt = cursor + u(8) + u(24) // Done's centre: a gap, then half its height
    cursor = doneAt + u(40) // its lower half, its drop, the card's padding

    const { overlay, top, close } = this.openModal(cursor)
    overlay.add(this.add.text(cx, top + u(32), 'Settings', TEXT.ink(22, '800')).setOrigin(0.5))
    const rowX = cx - cardW / 2 + u(24)
    let y = top + rowsAt + rowPitch / 2
    const row = (
      label: string,
      icon: (g: Phaser.GameObjects.Graphics, size: number, on: boolean) => void,
      get: () => boolean,
      set: (on: boolean) => void | Promise<void>,
    ) => {
      const yy = y
      const g = this.add.graphics()
      const text = this.add.text(rowX + u(44), yy, label, TEXT.ink(16, '700')).setOrigin(0, 0.5)
      const sw = this.add.graphics()
      const hit = this.add.zone(rowX + rowW / 2, yy, rowW, u(48)).setInteractive({ useHandCursor: true })
      const paint = () => {
        g.clear()
        g.setPosition(rowX + u(16), yy)
        icon(g, u(34), get())
        sw.clear()
        const on = get()
        const sx = rowX + rowW - u(52)
        sw.fillStyle(on ? 0x69db7c : 0xe7ddcb, 1)
        sw.fillRoundedRect(sx, yy - u(14), u(52), u(28), u(14))
        sw.lineStyle(u(3), INK, 1)
        sw.strokeRoundedRect(sx, yy - u(14), u(52), u(28), u(14))
        sw.fillStyle(PAPER, 1)
        sw.fillCircle(on ? sx + u(38) : sx + u(14), yy, u(10))
        sw.strokeCircle(on ? sx + u(38) : sx + u(14), yy, u(10))
      }
      paint()
      // Armed: a finger that went down elsewhere on the card and lifts here must
      // not flip a switch — the reminder one brings up the iOS permission prompt.
      onTap(hit, () => {
        void Promise.resolve(set(!get())).then(() => {
          if (hit.active) paint()
        })
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
    // Daily reminder: the in-app opt-out Apple asks for (4.5.4), and a second
    // way in for anyone who skipped the offer on the win card.
    let remindersOn = remindersEnabled()
    // The answers below arrive asynchronously: the card may be gone by then.
    const say = (text: string) => {
      if (note.active) note.setText(text)
    }
    row('Daily reminder', drawBellIcon, () => remindersOn, async (on) => {
      if (on) {
        remindersOn = await enableReminders()
        if (!remindersOn && (await reminderPermission()) === 'denied') say(NOTIFY_DENIED)
      } else {
        await disableReminders()
        remindersOn = false
      }
    })
    note.setY(top + noteAt)
    overlay.add(note)
    // Reflect the OS answer too: toggled on here but denied in iOS Settings.
    void reminderPermission().then((perm) => {
      if (perm !== 'granted' && remindersOn) say(NOTIFY_DENIED)
    })
    if (privacy) {
      privacy.setY(top + privacyAt)
      overlay.add(privacy)
    }
    const done = makeButton(this, 'Done', cardW * 0.4, u(48), 0xf5b942, '#2B2440', close)
    done.setPosition(cx, top + doneAt)
    overlay.add(done)
  }

  private toast(message: string) {
    const safe = safeArea()
    const t = this.add
      .text(this.scale.width / 2, Math.max(safe.top + u(92), this.scale.height * 0.5), message, TEXT.cream(14, '800'))
      .setOrigin(0.5)
      .setDepth(300)
    const pad = u(12)
    const bg = this.add.graphics().setDepth(299)
    bg.fillStyle(INK, 0.92)
    bg.fillRoundedRect(t.x - t.width / 2 - pad, t.y - t.height / 2 - pad * 0.6, t.width + pad * 2, t.height + pad * 1.2, u(14))
    const fade = { targets: [t, bg], alpha: 0, delay: 2200, duration: 400, onComplete: () => (t.destroy(), bg.destroy()) }
    this.tweens.add(fade)
  }
}
