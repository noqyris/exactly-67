import Phaser from 'phaser'
import { TOTAL_LEVELS } from '../game/levels'
import { isCleared, totalStars } from '../game/progress'
import { adsSupported, hintsUnlimited, openPrivacyOptions } from '../services/ads'
import { playPlace, setSoundEnabled, soundEnabled } from '../services/audio'
import { hapticsEnabled, placeTap, setHapticsEnabled } from '../services/haptics'
import { iapSupported, setIapListener } from '../services/iap'
import { musicEnabled, setMusicEnabled } from '../services/music'
import { progress } from '../services/progressStore'
import { saveHapticsEnabled, saveMusicEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, safeArea, u } from './layout'
import { BG, INK, OUTLINE, PAPER, weightColor } from './palette'
import { ScaleView } from './ScaleView'
import {
  drawHapticsIcon,
  drawMusicIcon,
  drawSoundIcon,
  makeButton,
  makeIconButton,
  TEXT,
} from './ui'

const INK_SOFT = '#5D5470'

export class MenuScene extends Phaser.Scene {
  private scaleView?: ScaleView

  constructor() {
    super('Menu')
  }

  create() {
    this.cameras.main.setBackgroundColor(BG)
    const h = this.scale.height
    const f = contentFrame(this.scale.width, h)
    const cx = f.cx
    const safe = safeArea()
    const topAnchor = Math.max(f.oy, safe.top)

    // Title: "EXACTLY" above a big chunky 67 block.
    const titleY = topAnchor + f.eh * 0.09
    this.add.text(cx, titleY, 'EXACTLY', TEXT.ink(34, '800')).setOrigin(0.5)

    const blockW = Math.min(f.ew * 0.42, u(190))
    const blockH = blockW * 0.72
    const bg = this.add.graphics()
    const { fill, dark } = weightColor(67)
    const bx = cx - blockW / 2
    // Leave room above the block for its handle so it clears the title.
    const by = titleY + u(24) + blockW * 0.22
    bg.lineStyle(OUTLINE + u(2), INK, 1)
    bg.beginPath()
    bg.arc(cx, by, blockW * 0.2, Math.PI, 0)
    bg.strokePath()
    bg.fillStyle(INK, 1)
    bg.fillRoundedRect(bx, by + u(7), blockW, blockH, blockW * 0.16)
    bg.fillStyle(fill, 1)
    bg.fillRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.lineStyle(OUTLINE + u(1), INK, 1)
    bg.strokeRoundedRect(bx, by, blockW, blockH, blockW * 0.16)
    bg.fillStyle(dark, 1)
    bg.fillRoundedRect(bx + u(6), by + blockH - blockW * 0.14, blockW - u(12), blockW * 0.09, blockW * 0.05)
    bg.fillStyle(0xffffff, 0.35)
    bg.fillRoundedRect(bx + blockW * 0.08, by + blockW * 0.06, blockW * 0.4, blockW * 0.09, blockW * 0.05)
    this.add
      .text(cx, by + blockH / 2, '67', {
        fontFamily: '"Baloo 2", sans-serif',
        fontSize: `${Math.round(blockH * 0.56)}px`,
        fontStyle: '800',
        color: '#FFF8EA',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, by + blockH + u(28), 'Balance the scale. Land on exactly 67.', TEXT.ink(16, '600'))
      .setOrigin(0.5)
      .setColor(INK_SOFT)

    // Privacy choices: re-opens the ad-consent decision, so a player who
    // declined can say yes and one who accepted can withdraw (GDPR wants
    // withdrawing to be as easy as consenting). Only for players the ad SDK can
    // ever run for — Unlimited owners never start it, so there is nothing to
    // choose. A quiet text link in the top corner of the frame, deliberately far
    // from the bottom banner: a control next to an ad is a mis-tap waiting to be
    // counted as a click, and at 320x568 the button column already fills the
    // space between the tagline and the banner strip. Small glyphs, generous
    // padding, so the touch target is still ~44pt.
    if (adsSupported() && !hintsUnlimited()) {
      const padX = u(10)
      const padY = u(12)
      const privacy = this.add
        .text(
          f.ox + f.ew - Math.max(u(16), safe.right) + padX,
          topAnchor + u(8) - padY,
          'Privacy choices',
          TEXT.ink(12, '700'),
        )
        .setOrigin(1, 0)
        .setColor(INK_SOFT)
        .setPadding({ x: padX, y: padY })
        .setInteractive({ useHandCursor: true })
      privacy.on('pointerdown', () => privacy.setAlpha(0.55))
      privacy.on('pointerout', () => privacy.setAlpha(1))
      privacy.on('pointerup', () => {
        privacy.setAlpha(1)
        void openPrivacyOptions()
      })
    }

    // Continue where the player left off.
    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const started = totalStars(p) > 0

    // Whether the "Store" button is shown. Everything purchasable now lives on
    // the Store screen (hint packs + the unlimited/no-ads unlock + Restore), so
    // the menu carries one button instead of a button plus a restore link.
    // Only a bundle owner has nothing left to buy — someone who bought the
    // cheap ads-only unlock still buys hints by the pack, so they keep the Store.
    const showStore = () => iapSupported() && !hintsUnlimited()
    const storeVisible = showStore()

    // Button column, pinned just above the banner strip. `columnDrop` is the
    // distance from the Play centre down to the bottom of the toggle row.
    const baseDrop = storeVisible ? u(281) : hintsUnlimited() ? u(253) : u(221)
    const columnBottom = h - safe.bottom - u(16)
    const playH = u(64)

    // On a short screen with the banner reserved, a fixed drop pushes the column
    // straight through the header: the Play button ends up over the tagline and
    // clips the 67 block (reproduced at 320x568 + banner). Compress the column
    // to whatever room is actually left under the header instead — every offset
    // and button height scales by `kc` together, so the spacing stays even.
    const headerBottom = by + blockH + u(28) + u(10)
    const maxDrop = columnBottom - (headerBottom + u(10) + playH / 2)
    const kc = Phaser.Math.Clamp(maxDrop / baseDrop, 0.66, 1)
    const columnDrop = baseDrop * kc
    const playY = columnBottom - columnDrop
    // Row offsets below Play, all scaled together.
    const row = (n: number) => u(n) * kc
    const btnH = u(52) * kc

    // The live scale always sits between the subtitle and the buttons. Size it to
    // the gap so it never overlaps them (bug: under ads the Play button climbed
    // over the beam) — it keeps its proportions and just shrinks on cramped
    // screens instead of disappearing.
    const gapTop = by + blockH + u(28) + u(20)
    const gapBottom = playY - playH * kc / 2 - u(14) // Play button top, minus a breath
    const gapH = gapBottom - gapTop

    const niceHalf = Math.min(f.ew * 0.26, u(150))
    const niceRope = Math.min(f.eh * 0.075, u(72))
    const nicePanW = Math.min(f.ew * 0.2, u(110))
    const nicePanH = nicePanW * 0.22
    const upReach = u(16) // beam/hub reach above the pivot
    // Shrink factor: keep both the hanging pans and the fulcrum inside the gap.
    const kPan = (gapH - upReach - u(4)) / (niceRope + nicePanH)
    const kFul = (gapH - upReach - u(16)) / (niceHalf * 0.52)
    const k = Math.max(0.35, Math.min(1, kPan, kFul))

    const halfBeam = niceHalf * k
    const ropeLen = niceRope * k
    const panWidth = nicePanW * k
    const panHeight = nicePanH * k
    const scaleDrop = Math.max(halfBeam * 0.52 + u(16), ropeLen + panHeight + u(4))
    const scaleH = upReach + scaleDrop
    const topPad = Math.min(Math.max(gapH - scaleH, 0) / 2, u(90))
    // Center in the gap, but hard-clamp so the scale's lowest point can never
    // cross into the Play button below — even on the smallest screens where the
    // fit floor leaves it larger than the gap.
    const cy = Math.min(gapTop + upReach + topPad, gapBottom - scaleDrop)

    // A little live scale, gently weighing — the game's idle heartbeat. Only
    // when the gap can actually hold it: with the ad banner reserved the button
    // column climbs and the gap collapses, and the size floor would otherwise
    // ride the beam up over the subtitle. In that crammed case we skip it — the
    // big 67 block above already carries the visual — rather than overlap text.
    if (gapH >= scaleH) {
      this.scaleView = new ScaleView(this, {
        cx,
        cy,
        halfBeam,
        ropeLen,
        panWidth,
        panHeight,
      })
      this.scaleView.setTargetAngle(0)
      this.scaleView.settleImmediately()
    }

    const play = makeButton(
      this,
      started ? `Play  ·  level ${next}` : 'Play',
      Math.min(f.ew * 0.6, u(260)),
      playH * kc,
      0xf5b942,
      '#2B2440',
      () => this.scene.start('Game', { level: next }),
    )
    play.setPosition(cx, playY)

    // A fresh puzzle every day — the "appointment mechanic" that brings players back.
    const daily = makeButton(this, 'Daily Challenge', Math.min(f.ew * 0.6, u(260)), btnH, PAPER, '#2B2440', () =>
      this.scene.start('Game', { daily: true }),
    )
    daily.setPosition(cx, playY + row(74))

    const levels = makeButton(this, 'Level map', Math.min(f.ew * 0.6, u(260)), btnH, PAPER, '#2B2440', () =>
      this.scene.start('LevelMap', {}),
    )
    levels.setPosition(cx, playY + row(134))

    let toggleRowY = playY + row(198)

    if (!hintsUnlimited()) {
      // Rebuild when ownership changes (a purchase lands) or the products
      // finish loading, since either flips what the column should contain.
      setIapListener(() => {
        if (showStore() !== storeVisible) {
          setIapListener(null)
          this.scene.restart()
        }
      })
      this.events.once('shutdown', () => setIapListener(null))
    }

    if (storeVisible) {
      const store = makeButton(this, 'Store', Math.min(f.ew * 0.6, u(260)), btnH, PAPER, '#2B2440', () =>
        this.scene.start('Store'),
      )
      store.setPosition(cx, playY + row(194))
      toggleRowY = playY + row(258)
    } else if (hintsUnlimited()) {
      // Owner: confirm the perk they unlocked. It's the only place they learn
      // hints are now unlimited (the purchase was framed around ads), so it stays
      // — but with real breathing room above and below so it reads as a calm
      // status line, not a label crammed onto the Level-map button.
      this.add
        .text(cx, playY + row(184), 'No ads · unlimited hints', TEXT.ink(13, '700'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
      toggleRowY = playY + row(230)
    }

    // Sound + music + haptics toggles. Music is its own switch, not a slice of
    // the sound one: plenty of players want the taps and none of the bed.
    const size = u(46) * kc
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
    sound.setPosition(cx - size * 1.5, toggleRowY)
    const music = makeIconButton(
      this,
      size,
      (g, s) => drawMusicIcon(g, s, musicEnabled()),
      () => {
        // This tap is itself the user gesture iOS wants before audio may start,
        // so switching it on here is enough to hear it immediately.
        setMusicEnabled(!musicEnabled())
        void saveMusicEnabled(musicEnabled())
        music.refresh()
      },
    )
    music.setPosition(cx, toggleRowY)
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
    haptics.setPosition(cx + size * 1.5, toggleRowY)

    // Portrait-locked on device, but dev browsers can resize: rebuild once.
    this.scale.once('resize', () => {
      this.time.delayedCall(60, () => this.scene.restart())
    })
  }

  update(time: number, delta: number) {
    this.scaleView?.update(time, delta)
  }
}
