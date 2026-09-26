import Phaser from 'phaser'
import { WELCOME_HINTS } from '../game/economy'
import {
  adsRemoved,
  grantHint,
  hintCountValue,
  hintsUnlimited,
  rewardedAvailable,
  rewardedBusy,
  rewardedLeftToday,
  watchRewarded,
} from '../services/ads'
import { playReward } from '../services/audio'
import {
  buyHintPack,
  buyNoAds,
  buyRemoveAds,
  buyWelcomePack,
  hintPackPrice,
  HINT_PACKS,
  iapSupported,
  noAdsPrice,
  perHintPrice,
  removeAdsPrice,
  restorePurchases,
  setHintPurchaseListener,
  setIapListener,
  welcomePrice,
} from '../services/iap'
import { contentFrame, safeArea, u } from './layout'
import { BEAM, BG, INK, OUTLINE, PAPER } from './palette'
import { drawBackIcon, drawBulb, drawGift, makeIconButton, onTap, TEXT } from './ui'

const INK_SOFT = '#5D5470'

/**
 * The shop. One screen, one honest ladder: the one-time Welcome pack (while it
 * is on offer) or the permanent unlock as the hero, a free hint for a rewarded
 * ad, the hint packs as tiles with their true per-hint price, then No ads.
 *
 * The price architecture is deliberate — the unlock costs MORE than every pack
 * ($4.99 vs $0.99/$1.99/$2.99) precisely so it doesn't dominate them. When the
 * unlock was $0.99 it was strictly better than every pack on both price and
 * quantity, which made the packs traps: anyone buying one overpaid for less.
 * Keep that ordering intact if prices ever change.
 *
 * Deliberately absent, and not to be added later: countdown timers, "only 3
 * left", fake "Most Popular" badges (we have no sales data, so it would simply
 * be untrue), and crossed-out reference prices we never actually charged. The
 * badges here state facts that hold by construction from the price ladder.
 *
 * Owners of the unlock are never shown a pack — their hints are already
 * unlimited (see GameScene.doHint), so selling them one would be selling
 * nothing.
 */
export class StoreScene extends Phaser.Scene {
  private toastText?: Phaser.GameObjects.Text
  /** Scene to hand control back to, when opened as an overlay (see close()). */
  private returnTo?: string
  /** Guards the async StoreKit round trip so one tap can't order twice. */
  private buying = false

  constructor() {
    super('Store')
  }

  init(data?: { returnTo?: string }) {
    this.returnTo = data?.returnTo
    this.buying = false
  }

  create() {
    this.cameras.main.setBackgroundColor(BG)
    const f = contentFrame(this.scale.width, this.scale.height)
    const safe = safeArea()
    const top = Math.max(f.oy, safe.top) + u(12)

    const back = makeIconButton(this, u(46), (g, s) => drawBackIcon(g, s), () => this.close())
    back.setPosition(f.ox + Math.max(u(16), safe.left) + u(23), top + u(23)).setDepth(10)

    this.add.text(f.cx, top + u(10), 'Store', TEXT.ink(26, '800')).setOrigin(0.5, 0).setDepth(10)

    // Two independent entitlements now: ads-off ($0.99 or $4.99) and unlimited
    // hints ($4.99 only). Only someone with BOTH has nothing left to buy.
    const owner = hintsUnlimited()
    const n = hintCountValue()
    const balance = owner
      ? 'Unlimited hints · no ads'
      : adsRemoved()
        ? `No ads · you have ${n} hint${n === 1 ? '' : 's'}`
        : `You have ${n} hint${n === 1 ? '' : 's'}`
    // Balance line: what the player has right now, stated plainly.
    this.add
      .text(f.cx, top + u(52), balance, TEXT.ink(14, '600'))
      .setOrigin(0.5, 0)
      .setColor(INK_SOFT)

    // Rebuild only when the offers themselves change (ownership flips, or a
    // product's price arrives). An unconditional restart here would also fire on
    // a no-op restore and tear down the toast that reports its result.
    const before = this.offerSignature()
    setIapListener(() => {
      if (this.offerSignature() !== before) this.rebuild()
    })
    setHintPurchaseListener((count) => {
      this.showToast(`${count} hints added!`)
      this.time.delayedCall(900, () => this.rebuild())
    })
    this.events.once('shutdown', () => {
      setIapListener(null)
      setHintPurchaseListener(null)
    })

    const bodyTop = top + u(86)
    const bottom = this.scale.height - safe.bottom - u(16)
    if (owner) this.buildOwnerState(f, bodyTop, bottom)
    else this.buildOffers(f, bodyTop, bottom)

    this.scale.once('resize', () => {
      this.time.delayedCall(60, () => this.rebuild())
    })
  }

  /** What the screen is currently offering — cheap to compare, no allocation churn. */
  private offerSignature(): string {
    return [
      hintsUnlimited() ? 'unlimited' : adsRemoved() ? 'noads' : 'open',
      removeAdsPrice() ?? '-',
      noAdsPrice() ?? '-',
      welcomePrice() ?? '-',
      ...HINT_PACKS.map((p) => hintPackPrice(p.id) ?? '-'),
    ].join('|')
  }

  /** Restart preserving the return route (always a data object: see close()). */
  private rebuild() {
    this.scene.restart(this.returnTo ? { returnTo: this.returnTo } : {})
  }

  /**
   * When the Store was launched over a live scene (the out-of-hints moment mid
   * level), hand control back to it instead of starting the Menu — the player
   * paid to finish THAT board, so tearing it down would discard what they just
   * bought hints for.
   *
   * Only a scene actually paused under us is resumed. Phaser hands a start()
   * with no data the scene's PREVIOUS data, so a stale returnTo once "resumed"
   * a Game that was not running: a blank screen with no way out. Anything else
   * goes to the Menu, which is always a way out.
   */
  private close() {
    const target = this.returnTo
    if (target && this.scene.isPaused(target)) {
      this.scene.stop()
      this.scene.resume(target)
      return
    }
    this.scene.start('Menu')
  }

  /** Serialize StoreKit round trips: a second tap while a sheet is up is ignored. */
  private purchase(run: () => Promise<void>) {
    if (this.buying) return
    this.buying = true
    void run().finally(() => {
      this.buying = false
    })
  }

  /** Nothing left to sell — say so instead of dangling worthless packs. */
  private buildOwnerState(f: ReturnType<typeof contentFrame>, bodyTop: number, bottom: number) {
    const cardW = Math.min(f.ew - u(48), u(340))
    const cardH = u(150)
    const cy = Math.min(bodyTop + cardH / 2 + u(20), (bodyTop + bottom) / 2)
    const g = this.add.graphics()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(f.cx - cardW / 2, cy - cardH / 2 + u(6), cardW, cardH, u(22))
    g.fillStyle(BEAM, 1)
    g.fillRoundedRect(f.cx - cardW / 2, cy - cardH / 2, cardW, cardH, u(22))
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(f.cx - cardW / 2, cy - cardH / 2, cardW, cardH, u(22))
    this.add.text(f.cx, cy - u(30), "You're all set", TEXT.ink(21, '800')).setOrigin(0.5)
    this.add
      .text(f.cx, cy + u(6), 'No ads, and hints never run out.\nThank you for supporting the game.', TEXT.ink(13, '600'))
      .setOrigin(0.5)
      .setAlign('center')
      .setColor('#4A4160')
  }

  /**
   * The ladder, top to bottom: a hero card (the one-time Welcome pack while it
   * is on offer, else the Unlimited unlock), a free hint for an ad, the hint
   * packs as three tiles, then No ads — and Unlimited again if the Welcome pack
   * took the hero slot. While the Welcome pack shows it REPLACES the 10-hint
   * tile, so nobody is offered more-for-less right beside it.
   */
  private buildOffers(f: ReturnType<typeof contentFrame>, bodyTop: number, bottom: number) {
    const cardW = Math.min(f.ew - u(40), u(360))
    const welcome = welcomePrice()
    const packs = HINT_PACKS.filter((p) => !(welcome && p.hints === 10))
      .map((p) => ({ ...p, price: hintPackPrice(p.id) }))
      .filter((p): p is { id: string; hints: number; price: string } => p.price != null)
    // Someone who already bought ad removal must never be offered it again —
    // neither the cheap one (they own it) nor the bundle (they'd pay a second
    // time for the half they already have). They buy hints by the pack.
    const adsOff = adsRemoved()
    const unlockPrice = adsOff ? null : removeAdsPrice()
    const noAdsOnlyPrice = adsOff ? null : noAdsPrice()
    const freeLeft = rewardedAvailable('store') ? rewardedLeftToday('store') : 0

    if (packs.length === 0 && unlockPrice == null && noAdsOnlyPrice == null && !welcome) {
      this.add
        .text(
          f.cx,
          bodyTop + u(40),
          iapSupported()
            ? 'The store is unavailable right now.\nCheck your connection and try again.'
            : 'Purchases are only available in the app.',
          TEXT.ink(14, '600'),
        )
        .setOrigin(0.5, 0)
        .setAlign('center')
        .setColor(INK_SOFT)
      if (freeLeft > 0) this.freeHintCard(f.cx, bodyTop + u(150), cardW, u(64), freeLeft)
      this.addFooter(f, bottom, false)
      return
    }

    // Row weights: hero 1.15, free 0.8, pack tiles 1.45, plain cards 1.
    type Row = { kind: 'hero-welcome' | 'hero-unlock' | 'free' | 'packs' | 'noads' | 'unlock'; weight: number }
    const rows: Row[] = []
    if (welcome) rows.push({ kind: 'hero-welcome', weight: 1.15 })
    else if (unlockPrice != null) rows.push({ kind: 'hero-unlock', weight: 1.15 })
    if (freeLeft > 0) rows.push({ kind: 'free', weight: 0.8 })
    if (packs.length > 0) rows.push({ kind: 'packs', weight: 1.45 })
    if (noAdsOnlyPrice != null) rows.push({ kind: 'noads', weight: 1 })
    if (welcome && unlockPrice != null) rows.push({ kind: 'unlock', weight: 1 })

    const footerH = u(76)
    const avail = bottom - bodyTop - footerH
    const totalWeight = rows.reduce((a, r) => a + r.weight, 0)
    // Fit the whole ladder without scrolling: shrink on short screens rather
    // than push the last offer below the fold (a 320×568 SE with the banner).
    const unit = Phaser.Math.Clamp((avail - u(10) * (rows.length - 1)) / Math.max(totalWeight, 1), u(46), u(74))
    const used = unit * totalWeight
    const gap = rows.length > 1 ? Phaser.Math.Clamp((avail - used) / (rows.length - 1), u(4), u(12)) : u(12)
    // Anchored near the top on a tall phone (the eye starts there), centred only
    // within a small band so short screens still use every point.
    let y = bodyTop + Math.min(u(18), Math.max(0, (avail - used - gap * (rows.length - 1)) / 2))

    for (const row of rows) {
      const h = unit * row.weight
      const cy = y + h / 2
      switch (row.kind) {
        case 'hero-welcome':
          this.offerCard({
            cx: f.cx, y: cy, w: cardW, h,
            label: 'Welcome pack',
            sublabel: [`${WELCOME_HINTS} hints · welcome offer`, `${WELCOME_HINTS} hints`],
            price: welcome as string,
            hero: true,
            onTap: () => this.purchase(() => buyWelcomePack()),
          })
          break
        case 'hero-unlock':
        case 'unlock':
          this.offerCard({
            cx: f.cx, y: cy, w: cardW, h,
            label: 'Unlimited hints',
            sublabel: 'and no ads, forever',
            price: unlockPrice as string,
            hero: row.kind === 'hero-unlock',
            onTap: () => this.purchase(() => buyRemoveAds()),
          })
          break
        case 'free':
          this.freeHintCard(f.cx, cy, cardW, h, freeLeft)
          break
        case 'packs':
          this.packTiles(f.cx, cy, cardW, h, packs)
          break
        case 'noads':
          // Ad removal on its own. It removes the banner and the between-level
          // ads, but the rewarded hint video still plays (ads.ts: only Unlimited
          // skips the ad SDK), so the card says so — longest wording that fits.
          this.offerCard({
            cx: f.cx, y: cy, w: cardW, h,
            label: 'No ads',
            sublabel: ['hints not included · hint videos stay', 'without hints · hint videos stay', 'hint videos stay'],
            price: noAdsOnlyPrice as string,
            hero: false,
            onTap: () => this.purchase(() => buyNoAds()),
          })
          break
      }
      y += h + gap
    }

    this.addFooter(f, bottom, true)
  }

  /** "Free hint · watch an ad": the Store's own rewarded tile, with a TRUE count left. */
  private freeHintCard(cx: number, cy: number, w: number, h: number, left: number) {
    const c = this.add.container(cx, cy)
    const g = this.add.graphics()
    g.fillStyle(0xe7f5ff, 1)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(u(18), h * 0.34))
    g.lineStyle(u(3), INK, 1)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(u(18), h * 0.34))
    const icon = this.add.graphics()
    drawGift(icon, -w / 2 + u(28), 0, Math.min(u(34), h * 0.62))
    const label = this.add.text(-w / 2 + u(54), -h * 0.14, 'Watch ad: +1 hint', TEXT.ink(15, '800')).setOrigin(0, 0.5)
    const sub = this.add
      .text(-w / 2 + u(54), h * 0.2, `${left} left today`, TEXT.ink(11, '700'))
      .setOrigin(0, 0.5)
      .setColor(INK_SOFT)
    const chevron = this.add.text(w / 2 - u(20), 0, '▶', TEXT.ink(16, '800')).setOrigin(0.5)
    c.add([g, icon, label, sub, chevron])
    c.setSize(w, h)
    c.setInteractive({ useHandCursor: true })
    let armed = false
    c.on('pointerdown', () => (armed = true))
    c.on('pointerout', () => (armed = false))
    c.on('pointerup', () => {
      // rewardedBusy(): a video is still up from a screen this one was rebuilt
      // over (a resize or a purchase restarts the scene and resets `buying`).
      if (!armed || this.buying || rewardedBusy()) return
      armed = false
      this.buying = true
      c.setAlpha(0.6)
      void watchRewarded('store').then((outcome) => {
        this.buying = false
        if (outcome === 'earned') grantHint()
        if (!this.sys.isActive()) return
        if (outcome === 'earned') {
          playReward()
          this.showToast('+1 hint!')
          this.time.delayedCall(700, () => this.rebuild())
        } else {
          c.setAlpha(1)
          // A video the player closed early was there: "no video" would contradict it.
          this.showToast(outcome === 'not-earned' ? "The ad didn't finish — no hint this time" : 'No video right now — try again soon')
        }
      })
    })
  }

  /** The hint packs as a row of tiles: count, price, and a TRUE per-hint price. */
  private packTiles(cx: number, cy: number, w: number, h: number, packs: { id: string; hints: number; price: string }[]) {
    const gap = u(10)
    const tw = (w - gap * (packs.length - 1)) / packs.length
    // "Best value" goes on the lowest per-hint price, computed from StoreKit —
    // never assumed from the ladder, so it stays true after any reprice.
    const per = packs.map((p) => perHintPrice(p.id, p.hints))
    let best = -1
    per.forEach((v, i) => {
      if (v && (best < 0 || v.value < (per[best]?.value ?? Infinity))) best = i
    })
    if (packs.length < 2) best = -1
    packs.forEach((p, i) => {
      const x = cx - w / 2 + tw / 2 + i * (tw + gap)
      const c = this.add.container(x, cy)
      const g = this.add.graphics()
      const r = Math.min(u(18), tw * 0.2)
      const fill = i === best ? 0xfff1c7 : PAPER
      const draw = (pressed: boolean) => {
        const dy = pressed ? u(4) : 0
        g.clear()
        if (!pressed) {
          g.fillStyle(INK, 1)
          g.fillRoundedRect(-tw / 2, -h / 2 + u(4), tw, h, r)
        }
        g.fillStyle(fill, 1)
        g.fillRoundedRect(-tw / 2, -h / 2 + dy, tw, h, r)
        g.lineStyle(OUTLINE, INK, 1)
        g.strokeRoundedRect(-tw / 2, -h / 2 + dy, tw, h, r)
      }
      draw(false)
      const bulb = this.add.graphics()
      drawBulb(bulb, 0, 0, Math.min(u(22), h * 0.2))
      bulb.setPosition(-tw * 0.2, -h * 0.28)
      const count = this.add.text(tw * 0.02, -h * 0.28, String(p.hints), TEXT.ink(20, '800')).setOrigin(0, 0.5)
      const price = this.add.text(0, h * 0.06, p.price, TEXT.ink(15, '800')).setOrigin(0.5)
      const unit = per[i]
      const perText = this.add
        .text(0, h * 0.3, i === best ? 'Best value' : unit ? `${unit.label}/hint` : 'hints', TEXT.ink(10, '800'))
        .setOrigin(0.5)
        .setColor(i === best ? '#2B8A3E' : INK_SOFT)
      if (perText.width > tw - u(8)) perText.setScale((tw - u(8)) / perText.width)
      const kids = [g, bulb, count, price, perText]
      c.add(kids)
      c.setSize(tw, h)
      c.setInteractive({ useHandCursor: true })
      let armed = false
      const move = (pressed: boolean) => {
        draw(pressed)
        const dy = pressed ? u(4) : 0
        bulb.y = -h * 0.28 + dy
        count.y = -h * 0.28 + dy
        price.y = h * 0.06 + dy
        perText.y = h * 0.3 + dy
      }
      // Arm on press, commit only on the SAME tile (a slide onto the next tile
      // must never open a purchase sheet for a pack nobody pressed).
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
        this.purchase(() => buyHintPack(p.id))
      })
    })
  }

  /** One offer row: quantity on the left, price chip on the right, whole row taps. */
  private offerCard(o: {
    cx: number
    y: number
    w: number
    h: number
    label: string
    /** One line, or candidates longest first: the first that clears the price chip wins. */
    sublabel?: string | string[]
    price: string
    badge?: string
    hero: boolean
    onTap: () => void
  }) {
    const c = this.add.container(o.cx, o.y)
    const g = this.add.graphics()
    const r = Math.min(u(20), o.h * 0.34)
    const fill = o.hero ? BEAM : PAPER
    const draw = (pressed: boolean) => {
      const dy = pressed ? u(4) : 0
      g.clear()
      if (!pressed) {
        g.fillStyle(INK, 1)
        g.fillRoundedRect(-o.w / 2, -o.h / 2 + u(4), o.w, o.h, r)
      }
      g.fillStyle(fill, 1)
      g.fillRoundedRect(-o.w / 2, -o.h / 2 + dy, o.w, o.h, r)
      g.lineStyle(o.hero ? OUTLINE + u(1) : OUTLINE, INK, 1)
      g.strokeRoundedRect(-o.w / 2, -o.h / 2 + dy, o.w, o.h, r)
    }
    draw(false)
    c.add(g)

    const padX = u(18)
    const labelY = o.sublabel ? -o.h * 0.14 : o.badge ? -o.h * 0.13 : 0
    const label = this.add
      .text(-o.w / 2 + padX, labelY, o.label, TEXT.ink(o.hero ? 18 : 17, '800'))
      .setOrigin(0, 0.5)
    c.add(label)

    // Price chip geometry first: the sublabel has to fit to its left.
    const chipW = Math.max(u(74), o.price.length * u(9))
    const chipH = Math.min(u(38), o.h * 0.52)
    const chipX = o.w / 2 - padX - chipW / 2

    const sub = o.sublabel ?? o.badge
    let subText: Phaser.GameObjects.Text | undefined
    if (sub) {
      const options = typeof sub === 'string' ? [sub] : sub
      subText = this.add
        .text(-o.w / 2 + padX, o.h * 0.19, options[0], TEXT.ink(11, '600'))
        .setOrigin(0, 0.5)
        .setColor(o.hero ? '#4A4160' : INK_SOFT)
      // Measured, not guessed from character counts: Baloo's widths vary, and a
      // localized price widens the chip. If nothing fits, the shortest stays.
      const room = chipX - chipW / 2 - u(8) - (-o.w / 2 + padX)
      for (const text of options) {
        subText.setText(text)
        if (subText.width <= room) break
      }
      c.add(subText)
    }

    // Price chip — cream on the hero so it stays legible against the candy fill.
    const chip = this.add.graphics()
    chip.fillStyle(o.hero ? PAPER : BEAM, 1)
    chip.fillRoundedRect(chipX - chipW / 2, -chipH / 2, chipW, chipH, chipH * 0.4)
    chip.lineStyle(u(2.5), INK, 1)
    chip.strokeRoundedRect(chipX - chipW / 2, -chipH / 2, chipW, chipH, chipH * 0.4)
    const priceText = this.add.text(chipX, 0, o.price, TEXT.ink(14, '800')).setOrigin(0.5)
    c.add([chip, priceText])

    c.setSize(o.w, o.h)
    c.setInteractive({ useHandCursor: true })
    const move = (pressed: boolean) => {
      draw(pressed)
      const dy = pressed ? u(4) : 0
      label.y = labelY + dy
      if (subText) subText.y = o.h * 0.19 + dy
      chip.y = dy
      priceText.y = dy
    }

    // Arm on press, commit only if the SAME row was pressed. Phaser re-hit-tests
    // at the release point, so a bare pointerup handler fires on whatever the
    // finger happens to be over when it lifts — slide off "10 hints" onto the
    // row below and you'd get a purchase sheet for a tier you never pressed.
    // Harmless elsewhere (a stray navigation); here it costs money.
    let armed = false
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
      o.onTap()
    })
    return c
  }

  /**
   * "Hints never expire" is a promise the code keeps (the balance is a plain
   * persisted counter with no decay) and Apple requires it to hold. Restore is
   * required by App Store review for the non-consumable.
   */
  private addFooter(f: ReturnType<typeof contentFrame>, bottom: number, showNeverExpire: boolean) {
    if (showNeverExpire) {
      this.add
        .text(f.cx, bottom - u(50), 'Hints never expire.', TEXT.ink(11, '600'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
    }
    const restore = this.add
      .text(f.cx, bottom - u(22), 'Restore purchases', TEXT.ink(13, '700'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)
      .setPadding({ x: u(16), y: u(10) })
      .setInteractive({ useHandCursor: true })
    onTap(restore, () => {
      if (this.buying) return
      this.buying = true
      this.showToast('Checking your purchases…')
      void restorePurchases()
        .then(() => {
          // A genuine restore flips ownership, and the iap listener rebuilds
          // into the owned state; otherwise say so plainly rather than leaving
          // the player staring at an unchanged screen wondering if it worked.
          if (!adsRemoved()) this.showToast('No previous purchase found')
        })
        .finally(() => {
          this.buying = false
        })
    })
  }

  private showToast(message: string) {
    this.toastText?.destroy()
    const y = this.scale.height - safeArea().bottom - u(96)
    const t = this.add.text(this.scale.width / 2, y, message, TEXT.cream(13, '700')).setOrigin(0.5).setDepth(200)
    const pad = u(12)
    const bg = this.add.graphics().setDepth(199)
    bg.fillStyle(INK, 0.92)
    bg.fillRoundedRect(t.x - t.width / 2 - pad, t.y - t.height / 2 - pad * 0.6, t.width + pad * 2, t.height + pad * 1.2, u(12))
    this.toastText = t
    this.time.delayedCall(1600, () => {
      t.destroy()
      bg.destroy()
      if (this.toastText === t) this.toastText = undefined
    })
  }
}
