import Phaser from 'phaser'
import { u } from './layout'
import {
  BALLOON,
  BALLOON_DARK,
  FONT,
  INK,
  LOCKED_TINT,
  OUTLINE,
  weightColor,
  labelColorFor,
} from './palette'

/**
 * One draggable weight, drawn entirely with Graphics.
 * Down-weights (value > 0) are chunky handled blocks; lift-weights
 * (value < 0) are balloons whose string ends at the container origin, so
 * placing the origin on the pan rim makes the balloon float above it.
 */
export class WeightView extends Phaser.GameObjects.Container {
  readonly value: number
  readonly index: number
  readonly isBalloon: boolean
  /** Visual body size (block width / balloon diameter) before scaling. */
  readonly bodySize: number
  readonly locked: boolean

  /** Where the view is being steered to each frame (tray home or pan slot). */
  target = { x: 0, y: 0, scale: 1 }
  dragging = false

  constructor(scene: Phaser.Scene, index: number, value: number, locked: boolean) {
    super(scene, 0, 0)
    this.index = index
    this.value = value
    this.isBalloon = value < 0
    this.locked = locked
    this.bodySize = WeightView.sizeFor(value)

    const g = scene.add.graphics()
    if (this.isBalloon) this.drawBalloon(g)
    else this.drawBlock(g)
    this.add(g)

    const label = Math.abs(value) >= 100 ? String(value) : this.isBalloon ? `−${-value}` : `${value}`
    const fontPx = Math.round(this.bodySize * (label.length >= 3 ? 0.3 : 0.38))
    const fill = this.isBalloon ? BALLOON : weightColor(value).fill
    const text = scene.add
      .text(0, this.labelY(), label, {
        fontFamily: FONT,
        fontSize: `${fontPx}px`,
        fontStyle: '800',
        color: labelColorFor(fill),
      })
      .setOrigin(0.5)
    this.add(text)

    if (locked) this.drawLockBadge()

    const s = this.bodySize
    this.setSize(Math.max(u(56), s * 1.15), Math.max(u(56), s * 1.15))
    scene.add.existing(this)
  }

  /** Bigger numbers read as heavier, within touchable bounds. */
  static sizeFor(value: number): number {
    const v = Math.abs(value)
    return u(Phaser.Math.Clamp(30 + 6.2 * Math.sqrt(v), 44, 84))
  }

  /** Vertical center of the visible body (balloons float above the origin). */
  private bodyCenterY(): number {
    return this.isBalloon ? -this.bodySize * 0.72 : 0
  }

  private labelY(): number {
    return this.isBalloon ? this.bodyCenterY() : this.bodySize * 0.06
  }

  /** Rect (local coords) of the visible body, for hit/drop math. */
  bodyRect(): Phaser.Geom.Rectangle {
    const s = this.bodySize
    if (this.isBalloon) {
      return new Phaser.Geom.Rectangle(-s / 2, this.bodyCenterY() - s / 2, s, s * 1.4)
    }
    return new Phaser.Geom.Rectangle(-s / 2, -s * 0.55, s, s * 1.05)
  }

  private drawBlock(g: Phaser.GameObjects.Graphics) {
    const s = this.bodySize
    const w = s
    const h = s * 0.8
    const r = s * 0.2
    const { fill, dark } = weightColor(this.value)
    const tint = this.locked ? LOCKED_TINT : fill
    const tintDark = this.locked ? 0x7d7691 : dark

    // Handle loop above the body.
    g.lineStyle(OUTLINE + s * 0.06, INK, 1)
    g.beginPath()
    g.arc(0, -h / 2, s * 0.22, Math.PI, 0, false)
    g.strokePath()

    // Ink drop shadow slab, then the candy body.
    g.fillStyle(INK, 1)
    g.fillRoundedRect(-w / 2, -h / 2 + s * 0.055, w, h, r)
    g.fillStyle(tint, 1)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r)

    // Bottom shade band + glossy top highlight.
    g.fillStyle(tintDark, 1)
    g.fillRoundedRect(-w / 2 + OUTLINE * 0.7, h / 2 - s * 0.16, w - OUTLINE * 1.4, s * 0.1, {
      tl: 0,
      tr: 0,
      bl: r * 0.7,
      br: r * 0.7,
    })
    g.fillStyle(0xffffff, 0.35)
    g.fillRoundedRect(-w / 2 + s * 0.09, -h / 2 + s * 0.07, w * 0.42, s * 0.1, s * 0.05)
  }

  private drawBalloon(g: Phaser.GameObjects.Graphics) {
    const s = this.bodySize
    const r = s / 2
    const cy = this.bodyCenterY()
    const fill = this.locked ? LOCKED_TINT : BALLOON
    const dark = this.locked ? 0x7d7691 : BALLOON_DARK

    // String from the knot (origin) up to the balloon, with a little curve.
    g.lineStyle(Math.max(u(2.5), s * 0.045), INK, 1)
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(s * 0.06, cy + r * 0.92)
    g.strokePath()

    // Balloon body: slightly tall ellipse, ink outline, shine.
    g.fillStyle(INK, 1)
    g.fillEllipse(0, cy + s * 0.05, s, s * 1.08)
    g.fillStyle(fill, 1)
    g.fillEllipse(0, cy, s, s * 1.08)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeEllipse(0, cy, s, s * 1.08)
    g.fillStyle(dark, 1)
    g.fillEllipse(0, cy + r * 0.62, s * 0.5, s * 0.22)
    g.fillStyle(0xffffff, 0.45)
    g.fillEllipse(-r * 0.35, cy - r * 0.4, s * 0.26, s * 0.2)

    // Knot triangle under the balloon.
    g.fillStyle(fill, 1)
    g.fillTriangle(0, cy + r * 0.86, -s * 0.1, cy + r * 1.12, s * 0.12, cy + r * 1.12)
    g.lineStyle(OUTLINE * 0.6, INK, 1)
    g.strokeTriangle(0, cy + r * 0.86, -s * 0.1, cy + r * 1.12, s * 0.12, cy + r * 1.12)
  }

  private drawLockBadge() {
    const s = this.bodySize
    const g = this.scene.add.graphics()
    const bx = s * 0.38
    const by = this.isBalloon ? this.bodyCenterY() - s * 0.42 : -s * 0.42
    g.fillStyle(INK, 1)
    g.fillCircle(bx, by, s * 0.19)
    // Padlock: shackle + body, drawn in cream.
    g.lineStyle(Math.max(u(2), s * 0.035), 0xfff8ea, 1)
    g.beginPath()
    g.arc(bx, by - s * 0.045, s * 0.055, Math.PI, 0)
    g.strokePath()
    g.fillStyle(0xfff8ea, 1)
    g.fillRoundedRect(bx - s * 0.07, by - s * 0.045, s * 0.14, s * 0.11, s * 0.025)
    this.add(g)
  }

  /**
   * Generous touch box covering the whole drawn weight — the block body (or
   * balloon body plus its string down to the origin), padded out to a
   * comfortable minimum.
   *
   * Phaser hit-tests a Container by adding its displayOrigin to the local
   * pointer point before the Contains check, so the hit rectangle must be
   * authored in that displayOrigin-relative frame (NOT origin-centered) or
   * only one quadrant of the weight registers a drag.
   */
  makeInteractive() {
    const body = this.bodyRect()
    // Pad so the whole square touch area is at least a finger wide.
    const padX = Math.max(u(4), (u(60) - body.width) / 2)
    const padY = Math.max(u(4), (u(60) - body.height) / 2)
    const rect = new Phaser.Geom.Rectangle(
      this.displayOriginX + body.x - padX,
      this.displayOriginY + body.y - padY,
      body.width + padX * 2,
      body.height + padY * 2,
    )
    this.setInteractive({
      hitArea: rect,
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
      draggable: true,
    })
  }

  /**
   * Offset so the visible body (not the origin) sits centered on a point —
   * used for tray slots. `scale` is the scale the view will be shown at.
   */
  centerOffsetY(scale: number): number {
    return -Phaser.Geom.Rectangle.GetCenter(this.bodyRect()).y * scale
  }

  /** A quick "no" wiggle for refused actions. */
  wiggle() {
    this.scene.tweens.add({
      targets: this,
      angle: { from: -6, to: 6 },
      duration: 60,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.setAngle(0),
    })
  }
}
