import Phaser from 'phaser'
import { TOTAL_LEVELS } from '../game/levels'
import { isCleared, totalStars } from '../game/progress'
import { adsRemoved, adsSupported } from '../services/ads'
import { playPlace, setSoundEnabled, soundEnabled } from '../services/audio'
import { hapticsEnabled, placeTap, setHapticsEnabled } from '../services/haptics'
import { buyRemoveAds, removeAdsPrice, restorePurchases, setIapListener } from '../services/iap'
import { progress } from '../services/progressStore'
import { saveHapticsEnabled, saveSoundEnabled } from '../services/storage'
import { contentFrame, safeArea, u } from './layout'
import { BG, INK, OUTLINE, PAPER, weightColor } from './palette'
import { ScaleView } from './ScaleView'
import { drawHapticsIcon, drawSoundIcon, makeButton, makeIconButton, TEXT } from './ui'

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

    // Continue where the player left off.
    const p = progress()
    let next = 1
    while (next < TOTAL_LEVELS && isCleared(p, next)) next++
    const started = totalStars(p) > 0

    // Whether the "Remove Ads" block will be shown (device only, IAP product
    // loaded, not yet bought). It adds ~one button of height to the column.
    const showRemoveAds = () => adsSupported() && !adsRemoved() && removeAdsPrice() !== null
    const removeAdsVisible = showRemoveAds()

    // Button column, pinned just above the banner strip. `columnDrop` is the
    // distance from the Play centre down to the bottom of the toggle row.
    // With the Remove-ads button present the column is taller and lifted a touch
    // higher, so "Restore purchases" gets real breathing room between the button
    // and the toggles instead of being pinched against both.
    const columnDrop = removeAdsVisible ? u(261) : adsRemoved() ? u(193) : u(161)
    const playY = h - safe.bottom - u(16) - columnDrop

    // The live scale always sits between the subtitle and the buttons. Size it to
    // the gap so it never overlaps them (bug: under ads the Play button climbed
    // over the beam) — it keeps its proportions and just shrinks on cramped
    // screens instead of disappearing.
    const gapTop = by + blockH + u(28) + u(20)
    const gapBottom = playY - u(32) - u(14) // Play button top, minus a breath
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

    // A little live scale, gently weighing — the game's idle heartbeat.
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

    const play = makeButton(
      this,
      started ? `Play  ·  level ${next}` : 'Play',
      Math.min(f.ew * 0.6, u(260)),
      u(64),
      0xf5b942,
      '#2B2440',
      () => this.scene.start('Game', { level: next }),
    )
    play.setPosition(cx, playY)

    const levels = makeButton(this, 'Level map', Math.min(f.ew * 0.6, u(260)), u(52), PAPER, '#2B2440', () =>
      this.scene.start('LevelMap', {}),
    )
    levels.setPosition(cx, playY + u(74))

    let toggleRowY = playY + u(74) + u(64)

    if (adsSupported() && !adsRemoved()) {
      // Rebuild the menu when the button's visibility changes: the product
      // finishes loading (button appears) or the purchase lands (button clears).
      setIapListener(() => {
        if (showRemoveAds() !== removeAdsVisible) {
          setIapListener(null)
          this.scene.restart()
        }
      })
      this.events.once('shutdown', () => setIapListener(null))
    }

    if (removeAdsVisible) {
      // The IAP bundles unlimited free hints — put the value prop in the button.
      const removeAds = makeButton(
        this,
        `Remove ads · ${removeAdsPrice()}`,
        Math.min(f.ew * 0.6, u(260)),
        u(60),
        PAPER,
        '#2B2440',
        () => void buyRemoveAds(),
        'No ads + unlimited hints',
      )
      removeAds.setPosition(cx, playY + u(74) + u(72))
      const restore = this.add
        .text(cx, playY + u(74) + u(72) + u(50), 'Restore purchases', TEXT.ink(12, '600'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
        .setInteractive({ useHandCursor: true })
      restore.on('pointerup', () => void restorePurchases())
      toggleRowY = playY + u(74) + u(72) + u(50) + u(42)
    } else if (adsRemoved()) {
      // Owner: confirm the perk they unlocked. It's the only place they learn
      // hints are now unlimited (the purchase was framed around ads), so it stays
      // — but with real breathing room above and below so it reads as a calm
      // status line, not a label crammed onto the Level-map button.
      this.add
        .text(cx, playY + u(74) + u(50), 'No ads · unlimited hints', TEXT.ink(13, '700'))
        .setOrigin(0.5)
        .setColor(INK_SOFT)
      toggleRowY = playY + u(74) + u(50) + u(46)
    }

    // Sound + haptics toggles.
    const size = u(46)
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
    sound.setPosition(cx - size * 0.75, toggleRowY)
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
    haptics.setPosition(cx + size * 0.75, toggleRowY)

    // Portrait-locked on device, but dev browsers can resize: rebuild once.
    this.scale.once('resize', () => {
      this.time.delayedCall(60, () => this.scene.restart())
    })
  }

  update(time: number, delta: number) {
    this.scaleView?.update(time, delta)
  }
}
