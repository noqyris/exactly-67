import Phaser from 'phaser'
import { formatCountdown, monthDays, monthOf, msUntilNextDay, weekdayMon0 } from '../game/days'
import { FREEZE_HINT_COST, MAX_FREEZES, REPAIR_HINT_COST } from '../game/streak'
import {
  hintCountValue,
  hintsUnlimited,
  rewardedAvailable,
  rewardedBusy,
  rewardedLeftToday,
  rewardedOffered,
  watchRewarded,
} from '../services/ads'
import type { RewardedOutcome } from '../services/ads'
import { playReward, playStreak } from '../services/audio'
import { today } from '../services/metaStore'
import {
  buyFreeze,
  canBuyFreeze,
  dailySolvedOn,
  earnFreezeByAd,
  freezeAdOpen,
  lostStreak,
  monthInfo,
  repairOpen,
  repairStreak,
  streak,
  streakSafeToday,
} from '../services/progression'
import type { RepairResult } from '../services/progression'
import { contentFrame, prefersReducedMotion, safeArea, u } from './layout'
import { BG, GOOD, INK, OUTLINE, PAPER, STAR } from './palette'
import {
  drawBackIcon,
  drawCard,
  drawFlame,
  drawMedal,
  drawProgressBar,
  drawSnowflake,
  makeButton,
  makeIconButton,
  TEXT,
} from './ui'

const INK_SOFT = '#5D5470'
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** The smallest day cell worth a finger; below it the screen scrolls instead of shrinking. */
const MIN_CELL = 34

/**
 * The Daily Challenge's home: the streak, its safety nets (freezes, a repair
 * window), this month's calendar and trophy. Past days of the CURRENT month can
 * be replayed from here — they count toward the monthly trophy, not the streak
 * (Sudoku.com's model). See docs/RETENTION.md.
 *
 * Everything between the fixed header and the pinned "today" row scrolls when
 * it does not fit (a 320×568 phone with a banner and the repair card), rather
 * than squeezing the calendar into cells too small to hit.
 */
export class DailyScene extends Phaser.Scene {
  /**
   * A rewarded video started from this screen is in flight. Deliberately NOT
   * reset in create(): Phaser reuses the instance, so a rebuild (resize, leave
   * and come back) mid-video keeps it, and the video's own handler clears it.
   */
  private busy = false
  /** A message to show once the rebuilt screen is up (a freeze bought, a repair). */
  private pendingToast: string | null = null
  private content!: Phaser.GameObjects.Container
  private contentHeight = 0
  private scrollY = 0
  /** The pointer travelled far enough to be a scroll, so its release is no tap. */
  private moved = false
  /** The freeze offer, while open: it owns the input, so no scrolling under it. */
  private overlay: Phaser.GameObjects.Container | null = null

  constructor() {
    super('Daily')
  }

  init(data?: { toast?: string }) {
    this.pendingToast = data?.toast ?? null
  }

  create() {
    // Consume the toast once. Phaser keeps settings.data for any later start()
    // that passes none, so "+1 freeze" used to greet every visit after it.
    this.sys.settings.data = {}
    this.overlay = null
    this.moved = false
    this.scrollY = 0
    this.cameras.main.setBackgroundColor(BG)
    const w = this.scale.width
    const h = this.scale.height
    const f = contentFrame(w, h)
    const safe = safeArea()
    const top = Math.max(f.oy, safe.top) + u(12)
    const cx = f.cx
    const colW = Math.min(f.ew - u(40), u(380))
    const left = cx - colW / 2

    // --- fixed header -------------------------------------------------------------------
    const back = makeIconButton(this, u(46), (g, s) => drawBackIcon(g, s), () => this.scene.start('Menu'))
    back.setPosition(f.ox + Math.max(u(16), safe.left) + u(23), top + u(23)).setDepth(10)
    this.add.text(cx, top + u(10), 'Daily Challenge', TEXT.ink(24, '800')).setOrigin(0.5, 0).setDepth(10)
    // Opaque so the content slides under it, interactive so nothing scrolled
    // beneath it can be tapped through it (the level map's header, same reason).
    const headerH = top + u(56)
    this.add.rectangle(w / 2, headerH / 2, w, headerH, BG).setDepth(5).setInteractive()

    const s = streak()
    const todayKey = today()
    const doneToday = dailySolvedOn(todayKey)

    // --- today, pinned at the bottom ------------------------------------------------------
    const btnY = h - safe.bottom - u(46)
    // The one-line "Solved ✓" needs less of the screen than the play button.
    const barTop = btnY - (doneToday ? u(22) : u(40))
    // The calendar scrolls under this bar, never behind or beside the play
    // button. It runs to the screen's edge, so with a banner strip reserved it
    // is also the level map's footer: opaque and tap-swallowing over the strip,
    // so no scrolled day cell is drawn — or tapped — right next to the ad.
    this.add.rectangle(w / 2, (barTop + h) / 2, w, h - barTop, BG).setDepth(5).setInteractive()
    let countdown: Phaser.GameObjects.Text | null = null
    if (doneToday) {
      const solved = this.add
        .text(cx, btnY, `Solved ✓ · next puzzle in ${formatCountdown(msUntilNextDay(new Date()))}`, TEXT.ink(15, '800'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
        .setDepth(10)
      fitWidth(solved, colW)
      countdown = solved
    } else {
      // Not at the end of a scroll that began on it, nor while a video is loading.
      const play = makeButton(this, "Play today's puzzle", Math.min(colW, u(300)), u(58), 0xf5b942, '#2B2440', () => {
        if (!this.busy && !this.moved) this.scene.start('Game', { daily: true })
      })
      play.setPosition(cx, btnY).setDepth(10)
      if (!prefersReducedMotion()) {
        this.tweens.add({ targets: play, scale: { from: 1, to: 1.04 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
      }
    }

    // --- scrolling content (local y from the header's bottom edge) ------------------------
    const content = this.add.container(0, headerH)
    this.content = content
    const put = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      content.add(o)
      return o
    }

    // --- streak card ------------------------------------------------------------------
    let y = u(10)
    const cardY = y
    const card = put(this.add.graphics()) // drawn once its height is known
    const flame = put(this.add.graphics())
    drawFlame(flame, 0, 0, u(58), s.current > 0)
    flame.setPosition(left + u(44), y + u(52))
    if (s.current > 0 && !prefersReducedMotion()) {
      this.tweens.add({ targets: flame, scaleY: { from: 1, to: 1.08 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    }
    const textX = left + u(86)
    const best = put(
      this.add.text(left + colW - u(16), y + u(30), `best ${s.best}`, TEXT.ink(13, '800')).setOrigin(1, 0.5).setColor(INK_SOFT),
    )
    const title = put(
      this.add.text(textX, y + u(30), s.current === 1 ? '1-day streak' : `${s.current}-day streak`, TEXT.ink(22, '800')).setOrigin(0, 0.5),
    )
    // A long streak on a 320 pt column ran into "best N": shrink into the room left of it.
    fitWidth(title, best.x - best.width - u(10) - textX)
    const sub = put(
      this.add
        .text(textX, y + u(58), doneToday ? "Today's puzzle solved" : streakSafeToday() ? 'Your streak is safe today' : s.current > 0 ? 'Solve today to keep it' : 'Solve today to start one', TEXT.ink(13, '700'))
        .setOrigin(0, 0.5)
        .setColor(INK_SOFT),
    )
    fitWidth(sub, left + colW - u(16) - textX)

    // Freezes: shown as slots under the text, with the ways to fill an empty one.
    const fy = y + u(88)
    for (let i = 0; i < MAX_FREEZES; i++) {
      const g = put(this.add.graphics())
      drawSnowflake(g, left + u(98) + i * u(28), fy, u(22), i < s.freezes)
    }
    const count = put(
      this.add
        .text(textX + MAX_FREEZES * u(28) + u(4), fy, s.freezes === 1 ? '1 freeze' : `${s.freezes} freezes`, TEXT.ink(12, '800'))
        .setOrigin(0, 0.5),
    )
    let streakH = u(108)
    // Unlimited owners get one too — theirs is free (see showFreezeOffer).
    if (s.freezes < MAX_FREEZES) {
      const link = put(
        this.add
          .text(left + colW - u(16), fy, '+ Get a freeze', TEXT.ink(13, '800'))
          .setOrigin(1, 0.5)
          .setColor('#1C7ED6')
          .setPadding({ x: u(8), y: u(8) }),
      )
      // The padding is tap area, not ink: it may overlap, the glyphs may not.
      const clear = () => link.x - link.width + u(8) >= count.x + count.width + u(10)
      if (!clear()) link.setText('+ Get one')
      if (!clear()) {
        // Still no room beside "N freezes" (a 320 pt column): its own line.
        link.setText('+ Get a freeze').setOrigin(0, 0.5).setPosition(textX - u(8), fy + u(28))
        streakH += u(28)
      }
      this.tappable(link, () => this.showFreezeOffer())
    }
    drawCard(card, left, cardY, colW, streakH, u(22), 0xfff1c7)
    y += streakH + u(16)

    // --- a broken streak that can still be restored --------------------------------
    if (repairOpen()) {
      const rh = u(96)
      const g = put(this.add.graphics())
      drawCard(g, left, y, colW, rh, u(20), 0xffe3e3)
      const head = put(this.add.text(cx, y + u(22), `Your ${lostStreak()}-day streak broke`, TEXT.ink(16, '800')).setOrigin(0.5))
      fitWidth(head, colW - u(24))
      const inner = colW - u(28)
      const offerAd = rewardedAvailable('repair')
      const hintsOk = hintsUnlimited() || hintCountValue() >= REPAIR_HINT_COST
      const bw = offerAd && hintsOk ? (inner - u(10)) / 2 : inner * 0.7
      let bx = offerAd && hintsOk ? left + u(14) + bw / 2 : cx
      if (offerAd) {
        const b = put(this.adButton('Watch ad: restore', bw, u(42), (btn) => void this.repairWithAd(btn)))
        b.setPosition(bx, y + u(64))
        bx += bw + u(10)
      }
      if (hintsOk) {
        const b = put(
          makeButton(this, hintsUnlimited() ? 'Restore' : `Restore · ${REPAIR_HINT_COST} hints`, bw, u(42), PAPER, '#2B2440', () => {
            if (this.moved || !this.claimable()) return
            const restored = repairStreak('hints')
            if (restored) this.celebrateAndRebuild(restoredMessage(restored))
            // The window closed while the screen sat open (midnight): say so, redraw without it.
            else if (!repairOpen()) this.rebuild('This streak can no longer be restored')
          }),
        )
        b.setPosition(bx, y + u(64))
      }
      if (!offerAd && !hintsOk) {
        put(
          this.add
            .text(cx, y + u(64), `Restore it for ${REPAIR_HINT_COST} hints — get some in the Store`, TEXT.ink(12, '700'))
            .setOrigin(0.5)
            .setColor(INK_SOFT)
            .setWordWrapWidth(colW - u(28))
            .setAlign('center'),
        )
      }
      y += rh + u(16)
    }

    // --- month calendar -----------------------------------------------------------------
    const month = monthOf(todayKey)
    const info = monthInfo(month)
    const [yy, mm] = month.split('-').map(Number)
    const monthTitle = put(this.add.text(left + u(4), y + u(12), `${MONTH_NAMES[mm - 1]} ${yy}`, TEXT.ink(18, '800')).setOrigin(0, 0.5))
    // Trophy progress toward the next tier.
    const medal = put(this.add.graphics())
    drawMedal(medal, 0, 0, u(30), info.tier)
    medal.setPosition(left + colW - u(16), y + u(10))
    const nextText = info.next
      ? `${info.solved}/${info.next.at} for ${info.next.tier}`
      : `${info.solved}/${info.days} · gold!`
    const next = put(this.add.text(left + colW - u(36), y + u(12), nextText, TEXT.ink(12, '800')).setOrigin(1, 0.5).setColor(INK_SOFT))
    fitWidth(monthTitle, next.x - next.width - u(10) - monthTitle.x)
    const barG = put(this.add.graphics())
    drawProgressBar(barG, left, y + u(30), colW, u(12), info.next ? info.solved / info.next.at : 1, GOOD)
    y += u(56)

    const days = monthDays(month)
    const lead = weekdayMon0(days[0])
    const cols = 7
    const gap = u(6)
    const pad = u(12)
    const viewH = barTop - headerH
    const rowsN = Math.ceil((lead + days.length) / cols)
    const gridTop = y + u(18)
    // The whole month on screen when that still leaves a finger-sized cell;
    // below MIN_CELL the content scrolls instead (the width always wins).
    const fitCell = (viewH - gridTop - pad - gap * (rowsN - 1)) / rowsN
    const cell = Math.floor(Math.min((colW - gap * (cols - 1)) / cols, u(52), Math.max(u(MIN_CELL), fitCell)))
    const gridW = cell * cols + gap * (cols - 1)
    const gx = cx - gridW / 2
    ;['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => {
      put(this.add.text(gx + i * (cell + gap) + cell / 2, y, d, TEXT.ink(12, '800')).setOrigin(0.5).setColor(INK_SOFT))
    })
    days.forEach((key, i) => {
      const pos = lead + i
      const col = pos % cols
      const row = Math.floor(pos / cols)
      const x = gx + col * (cell + gap) + cell / 2
      const yc = gridTop + row * (cell + gap) + cell / 2
      this.dayCell(content, key, i + 1, x, yc, cell, key === todayKey, key > todayKey, dailySolvedOn(key))
    })
    this.contentHeight = gridTop + rowsN * cell + (rowsN - 1) * gap + pad
    this.bindScrolling(headerH, viewH)

    if (this.pendingToast) this.toast(this.pendingToast)
    this.pendingToast = null

    if (rewardedBusy() && !this.busy) {
      // A video started elsewhere is still in flight, so the ad buttons above
      // were drawn 'Loading…'. Nothing of ours will redraw them when it ends:
      // rebuild once it does (never under the open freeze offer).
      const poll = this.time.addEvent({
        delay: 400,
        loop: true,
        callback: () => {
          if (rewardedBusy() || this.overlay) return
          poll.remove()
          this.rebuild(null)
        },
      })
    }

    // Midnight with this screen open (in the foreground — main.ts handles a
    // resume): yesterday's "today", its tick and its countdown must not linger.
    // The countdown refreshes every 30 s; the rebuild waits out an open freeze
    // offer or a video in flight.
    const builtOn = today()
    const tick = () => {
      if (today() !== builtOn) {
        if (!this.overlay && !rewardedBusy()) this.rebuild(null)
        return
      }
      if (countdown?.active) {
        countdown.setText(`Solved ✓ · next puzzle in ${formatCountdown(msUntilNextDay(new Date()))}`)
        fitWidth(countdown, colW)
      }
    }
    this.time.addEvent({ delay: 30_000, loop: true, callback: tick })
    this.time.delayedCall(msUntilNextDay(new Date()) + 1500, tick)

    let pending: Phaser.Time.TimerEvent | null = null
    const onResize = () => {
      pending?.remove()
      pending = this.time.delayedCall(150, () => this.scene.restart({}))
    }
    this.scale.on('resize', onResize)
    this.events.once('shutdown', () => this.scale.off('resize', onResize))
  }

  /** Drag (or wheel) the content between the header and the pinned bottom bar. */
  private bindScrolling(headerH: number, viewH: number) {
    const minY = Math.min(0, viewH - this.contentHeight)
    if (minY === 0) return // it all fits
    const apply = () => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY, minY, 0)
      this.content.y = headerH + this.scrollY
    }
    let startY = 0
    let startScroll = 0
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      startY = pointer.y
      startScroll = this.scrollY
      this.moved = false
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || this.overlay) return
      const dy = pointer.y - startY
      if (Math.abs(dy) > u(8)) this.moved = true
      this.scrollY = startScroll + dy
      apply()
    })
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.overlay) return
      this.scrollY -= u(dy)
      apply()
    })
  }

  /**
   * Fire `onTap` on a press AND release on `o`, never at the end of a scroll —
   * makeButton's arming, for the links and day cells that ride the scroll.
   */
  private tappable(o: Phaser.GameObjects.GameObject, onTap: () => void) {
    o.setInteractive({ useHandCursor: true })
    let armed = false
    o.on('pointerdown', () => (armed = true))
    o.on('pointerout', () => (armed = false))
    o.on('pointerup', () => {
      if (!armed || this.moved) return
      armed = false
      onTap()
    })
  }

  /**
   * A "Watch ad: …" button. Drawn 'Loading…' and inert while any full-screen
   * ad is in flight — one started before this screen was rebuilt included,
   * which a fresh button would otherwise start a second time.
   */
  private adButton(label: string, width: number, height: number, onTap: (b: Phaser.GameObjects.Container) => void) {
    const b = makeButton(this, label, width, height, 0xf5b942, '#2B2440', () => {
      if (!this.moved) onTap(b)
    })
    if (this.busy || rewardedBusy()) showLoading(b)
    return b
  }

  /**
   * May hints be spent on a freeze or a repair right now? Not while a video is
   * in flight: its reward would then land on a slot or a streak already paid for.
   */
  private claimable(): boolean {
    if (!this.busy && !rewardedBusy()) return true
    this.toast('A video is already loading')
    return false
  }

  private dayCell(
    parent: Phaser.GameObjects.Container,
    key: string,
    n: number,
    x: number,
    y: number,
    size: number,
    isToday: boolean,
    future: boolean,
    solved: boolean,
  ) {
    const c = this.add.container(x, y)
    parent.add(c)
    const g = this.add.graphics()
    const r = size * 0.28
    const fill = solved ? 0x8ce99a : future ? 0xefe7d8 : isToday ? STAR : PAPER
    g.fillStyle(fill, 1)
    g.fillRoundedRect(-size / 2, -size / 2, size, size, r)
    g.lineStyle(isToday ? OUTLINE : u(2.5), INK, future ? 0.25 : 1)
    g.strokeRoundedRect(-size / 2, -size / 2, size, size, r)
    const label = this.add
      .text(0, solved ? -size * 0.12 : 0, String(n), TEXT.ink(Math.max(11, Math.min(16, size / u(3.2))), '800'))
      .setOrigin(0.5)
      .setAlpha(future ? 0.35 : 1)
    c.add([g, label])
    if (solved) {
      const tick = this.add.graphics()
      tick.lineStyle(u(2.5), INK, 1)
      tick.beginPath()
      tick.moveTo(-size * 0.14, size * 0.2)
      tick.lineTo(-size * 0.03, size * 0.3)
      tick.lineTo(size * 0.16, size * 0.1)
      tick.strokePath()
      c.add(tick)
    }
    if (!future) {
      // Any day of this month so far can be played: today counts toward the
      // streak, an earlier one toward the monthly trophy.
      c.setSize(size, size)
      this.tappable(c, () => {
        if (this.busy) return
        this.scene.start('Game', isToday ? { daily: true } : { daily: true, date: key })
      })
    }
  }

  private async repairWithAd(button: Phaser.GameObjects.Container) {
    if (this.busy || rewardedBusy()) return
    this.busy = true
    showLoading(button)
    let outcome: RewardedOutcome = 'unavailable'
    try {
      outcome = await watchRewarded('repair')
    } finally {
      this.busy = false
    }
    // Pay first: a video watched to the end is owed its repair wherever the
    // player is now.
    const restored = outcome === 'earned' ? repairStreak('ad') : null
    if (!this.sys.isActive()) return
    if (restored) this.celebrateAndRebuild(restoredMessage(restored))
    // Watched, but the window closed during the video (midnight passed).
    else if (outcome === 'earned') this.rebuild('This streak can no longer be restored')
    else this.rebuild(missedVideo(outcome))
  }

  private async freezeWithAd(button: Phaser.GameObjects.Container) {
    if (this.busy || rewardedBusy()) return
    this.busy = true
    showLoading(button)
    let outcome: RewardedOutcome = 'unavailable'
    try {
      outcome = await watchRewarded('freeze')
    } finally {
      this.busy = false
    }
    if (outcome === 'earned') earnFreezeByAd()
    if (!this.sys.isActive()) return
    if (outcome === 'earned') this.celebrateAndRebuild('+1 freeze')
    else this.rebuild(missedVideo(outcome))
  }

  /**
   * How to fill an empty freeze slot: a rewarded ad (once a day) or hints — or,
   * for Unlimited owners, free and never an ad. When neither is possible it
   * says why instead of opening an empty card.
   */
  private showFreezeOffer() {
    if (this.overlay) return
    const w = this.scale.width
    const h = this.scale.height
    const safe = safeArea()
    const overlay = this.add.container(0, 0).setDepth(200)
    this.overlay = overlay
    const dim = this.add.rectangle(w / 2, h / 2, w, h, INK, 0.45).setInteractive()
    const cardW = Math.min(w - u(48), u(330))
    const cx = w / 2
    // Laid out from the card's top edge, then placed once its height is known.
    const panel = this.add.container(0, 0)
    const g = this.add.graphics()
    const icon = this.add.graphics()
    drawSnowflake(icon, cx, u(44), u(50), true)
    const title = this.add.text(cx, u(90), 'Streak freeze', TEXT.ink(21, '800')).setOrigin(0.5)
    const body = this.add
      .text(cx, u(108), 'Covers a day you miss, so your streak lives on.', TEXT.ink(13, '600'))
      .setOrigin(0.5, 0)
      .setColor(INK_SOFT)
      .setWordWrapWidth(cardW - u(40))
      .setAlign('center')
    panel.add([g, icon, title, body])
    overlay.add([dim, panel])
    const btnW = cardW - u(48)
    let y = body.y + body.height + u(14)
    const row = (b: Phaser.GameObjects.Container) => {
      b.setPosition(cx, y + u(22))
      panel.add(b)
      y += u(52)
    }

    const unlimited = hintsUnlimited()
    // Unlimited is "no ads, forever": their freeze is the free button below.
    const adOk = !unlimited && freezeAdOpen() && rewardedAvailable('freeze')
    const buyOk = canBuyFreeze()
    if (adOk) row(this.adButton('Watch ad: +1 freeze', btnW, u(44), (b) => void this.freezeWithAd(b)))
    if (buyOk) {
      row(
        makeButton(this, unlimited ? 'Add a freeze' : `Use ${FREEZE_HINT_COST} hints`, btnW, u(44), unlimited ? 0xf5b942 : PAPER, '#2B2440', () => {
          if (!this.claimable()) return
          if (buyFreeze()) this.celebrateAndRebuild('+1 freeze')
        }),
      )
    }
    if (!adOk && !buyOk) {
      const lines = [`Freezes cost ${FREEZE_HINT_COST} hints — you have ${hintCountValue()}.`]
      // Today's freeze video (or all of today's videos) already watched. Not
      // said without consent: there is no video tomorrow either.
      if (rewardedOffered() && (!freezeAdOpen() || rewardedLeftToday('freeze') <= 0)) lines.push('Next free video tomorrow.')
      const note = this.add
        .text(cx, y + u(4), lines.join('\n'), TEXT.ink(14, '700'))
        .setOrigin(0.5, 0)
        .setColor(INK_SOFT)
        .setWordWrapWidth(cardW - u(40))
        .setAlign('center')
      panel.add(note)
      y += note.height + u(14)
    }
    const done = this.add
      .text(cx, y + u(20), 'Not now', TEXT.ink(14, '800'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setPadding({ x: u(16), y: u(8) })
    this.tappable(done, () => {
      overlay.destroy()
      this.overlay = null
    })
    panel.add(done)
    // Sized from its rows, so "Not now" sits inside the card however many there are.
    const cardH = y + u(50)
    drawCard(g, cx - cardW / 2, 0, cardW, cardH, u(24))
    panel.y = Math.max(safe.top + u(12), Math.min(h * 0.44, h - safe.bottom - cardH / 2 - u(16)) - cardH / 2)
  }

  private celebrateAndRebuild(message: string) {
    playReward()
    playStreak()
    this.rebuild(message)
  }

  /** Redraw from fresh state, with an optional toast (always a data object: see create()). */
  private rebuild(message: string | null) {
    this.scene.restart(message ? { toast: message } : {})
  }

  private toast(message: string) {
    const safe = safeArea()
    const t = this.add
      .text(this.scale.width / 2, Math.max(safe.top + u(96), this.scale.height * 0.55), message, TEXT.cream(14, '800'))
      .setOrigin(0.5)
      .setDepth(300)
      .setWordWrapWidth(this.scale.width - u(72))
      .setAlign('center')
    const pad = u(12)
    const bg = this.add.graphics().setDepth(299)
    bg.fillStyle(INK, 0.92)
    bg.fillRoundedRect(t.x - t.width / 2 - pad, t.y - t.height / 2 - pad * 0.6, t.width + pad * 2, t.height + pad * 1.2, u(14))
    this.tweens.add({ targets: [t, bg], alpha: 0, delay: 1800, duration: 400, onComplete: () => (t.destroy(), bg.destroy()) })
  }
}

/** Shrink `t` to `room` px wide when it is wider (a 320 pt column, a long streak). */
function fitWidth(t: Phaser.GameObjects.Text, room: number): void {
  if (room > 0 && t.width > room) t.setScale(room / t.width)
}

/** Put a makeButton() in its video-on-the-way state: 'Loading…', dimmed, inert. */
function showLoading(b: Phaser.GameObjects.Container): void {
  const label = b.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text)
  label?.setScale(1).setText('Loading…')
  b.setAlpha(0.6).disableInteractive()
}

/** What a video that paid nothing was — the same true split as GameScene's win card. */
function missedVideo(outcome: RewardedOutcome): string | null {
  if (outcome === 'not-earned') return "The ad didn't finish"
  // Consent withdrawn meanwhile: the rebuilt screen drops the button, and
  // "try again soon" would be false.
  return rewardedOffered() ? 'No video right now — try again soon' : null
}

/** "Streak restored!", naming any milestone gift the repair crossed (already paid). */
function restoredMessage(r: RepairResult): string {
  const gifts: string[] = []
  if (r.bonusHints > 0) gifts.push(`+${r.bonusHints} hint${r.bonusHints === 1 ? '' : 's'}`)
  if (r.bonusFreezes > 0) gifts.push(`+${r.bonusFreezes} freeze${r.bonusFreezes === 1 ? '' : 's'}`)
  if (gifts.length === 0) return 'Streak restored!'
  // A repair can jump over several milestones at once (48 + 2 crosses 49's
  // freeze and 50's hints), so name the reward, not one day it came from.
  return `Streak restored! ${gifts.join(', ')} milestone bonus`
}
