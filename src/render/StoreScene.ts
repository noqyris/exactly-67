import Phaser from 'phaser'
import { adsRemoved, hintCountValue, hintsUnlimited } from '../services/ads'
import {
  buyHintPack,
  buyNoAds,
  buyRemoveAds,
  hintPackPrice,
  HINT_PACKS,
  iapSupported,
  noAdsPrice,
  removeAdsPrice,
  restorePurchases,
  setHintPurchaseListener,
  setIapListener,
} from '../services/iap'
import { contentFrame, safeArea, u } from './layout'
import { BEAM, BG, INK, OUTLINE, PAPER } from './palette'
import { drawBackIcon, makeIconButton, TEXT } from './ui'

const INK_SOFT = '#5D5470'

/**
 * The shop. One screen, one honest ladder: three consumable hint packs, then
 * the permanent unlock as the top tier.
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
      ...HINT_PACKS.map((p) => hintPackPrice(p.id) ?? '-'),
    ].join('|')
  }

  /** Restart preserving the return route, which plain `restart()` would drop. */
  private rebuild() {
    this.scene.restart(this.returnTo ? { returnTo: this.returnTo } : undefined)
  }

  /**
   * When the Store was launched over a live scene (the out-of-hints moment mid
   * level), hand control back to it instead of starting the Menu — the player
   * paid to finish THAT board, so tearing it down would discard what they just
   * bought hints for.
   */
  private close() {
    if (this.returnTo) {
      const target = this.returnTo
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

  private buildOffers(f: ReturnType<typeof contentFrame>, bodyTop: number, bottom: number) {
    const cardW = Math.min(f.ew - u(48), u(340))
    const packs = HINT_PACKS.map((p) => ({ ...p, price: hintPackPrice(p.id) })).filter(
      (p): p is { id: string; hints: number; price: string } => p.price != null,
    )
    // Someone who already bought ad removal must never be offered it again —
    // neither the cheap one (they own it) nor the bundle (they'd pay a second
    // time for the half they already have). They buy hints by the pack.
    const adsOff = adsRemoved()
    const unlockPrice = adsOff ? null : removeAdsPrice()
    const noAdsOnlyPrice = adsOff ? null : noAdsPrice()

    if (packs.length === 0 && unlockPrice == null && noAdsOnlyPrice == null) {
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
      this.addFooter(f, bottom, false)
      return
    }

    // Cheapest first, unlock last: the ladder climbs, so the most expensive tier
    // is also the best one — no high anchor up top, nothing dominated below.
    // "No ads" sits between the packs and the bundle: it buys a different thing
    // (quiet, not hints), so it competes with neither on their own terms.
    const rows = packs.length + (noAdsOnlyPrice != null ? 1 : 0) + (unlockPrice != null ? 1 : 0)
    const footerH = u(76)
    const avail = bottom - bodyTop - footerH
    const plainRows = packs.length + (noAdsOnlyPrice != null ? 1 : 0)
    // Fit the whole ladder without scrolling: shrink cards on short screens
    // rather than push the last (best) offer below the fold. The hero card is
    // 12% taller, so it counts as 1.12 rows or the ladder overshoots.
    const cardH = Phaser.Math.Clamp(
      (avail - u(12) * (rows - 1)) / Math.max(plainRows + (unlockPrice != null ? 1.12 : 0), 1),
      u(58),
      u(84),
    )
    const heroH = Math.min(cardH * 1.12, u(96))
    const cardsH = cardH * plainRows + (unlockPrice != null ? heroH : 0)
    // A 320×568 iPhone SE with the banner strip reserved can't fit even
    // minimum-height cards with full gaps: the hero card ran into "Hints never
    // expire." Tighten the gaps before letting the ladder overlap the footer.
    const gap = rows > 1 ? Phaser.Math.Clamp((avail - cardsH) / (rows - 1), u(4), u(12)) : u(12)
    const totalH = cardsH + gap * (rows - 1)
    let y = bodyTop + Math.max(0, (avail - totalH) / 2)

    const biggest = packs.reduce((a, b) => (b.hints > a.hints ? b : a), packs[0])
    for (const p of packs) {
      // True by construction from the price ladder (0.99/1.99/2.99 for 10/30/100),
      // and scoped to packs so it never contradicts the unlimited tier above it.
      const badge = packs.length > 1 && p.id === biggest.id ? 'Best pack value' : undefined
      this.offerCard({
        cx: f.cx,
        y: y + cardH / 2,
        w: cardW,
        h: cardH,
        label: `${p.hints} hints`,
        price: p.price,
        badge,
        hero: false,
        onTap: () => this.purchase(() => buyHintPack(p.id)),
      })
      y += cardH + gap
    }

    if (noAdsOnlyPrice != null) {
      // Ad removal on its own. No badge: it isn't "better value" than a hint
      // pack, it's a different purchase, and claiming otherwise would be spin.
      // It removes the banner and the between-level ads, but the rewarded hint
      // video still plays (ads.ts: only Unlimited skips the ad SDK), so the card
      // says so. Otherwise a $0.99 buyer who taps "Watch ad: +1 hint" gets a
      // full-screen ad they believe they paid to remove. Longest wording first;
      // a 320 pt phone only has room for a shorter one beside the price chip.
      this.offerCard({
        cx: f.cx,
        y: y + cardH / 2,
        w: cardW,
        h: cardH,
        label: 'No ads',
        sublabel: ['hints not included · hint videos stay', 'without hints · hint videos stay', 'hint videos stay'],
        price: noAdsOnlyPrice,
        hero: false,
        onTap: () => this.purchase(() => buyNoAds()),
      })
      y += cardH + gap
    }

    if (unlockPrice != null) {
      this.offerCard({
        cx: f.cx,
        y: y + heroH / 2,
        w: cardW,
        h: heroH,
        label: 'Unlimited hints',
        sublabel: 'and no ads, forever',
        price: unlockPrice,
        hero: true,
        onTap: () => this.purchase(() => buyRemoveAds()),
      })
    }

    this.addFooter(f, bottom, true)
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
      .setInteractive({ useHandCursor: true })
    restore.on('pointerup', () => {
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
