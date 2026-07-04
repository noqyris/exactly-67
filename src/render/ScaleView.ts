import Phaser from 'phaser'
import { prefersReducedMotion, u } from './layout'
import {
  BEAM,
  BEAM_DARK,
  FONT,
  INK,
  OUTLINE,
  PAN,
  PAN_DARK,
  TARGET_BLOCK,
} from './palette'
import { TEXT } from './ui'

export interface ScaleGeometry {
  /** Beam pivot, in scene coords. */
  cx: number
  cy: number
  /** Pivot → beam end distance. */
  halfBeam: number
  /** Beam end → pan dish top. */
  ropeLen: number
  panWidth: number
  panHeight: number
}

/**
 * The balance scale: fulcrum, rotating beam and two hanging pans that stay
 * upright. The beam runs a small angular spring toward the deterministic
 * target angle, with a gentle idle sway (the "weighing" gesture) — so the
 * feel is physical but the truth is always the math.
 */
export class ScaleView {
  private readonly scene: Phaser.Scene
  private geo: ScaleGeometry
  private readonly reducedMotion = prefersReducedMotion()

  private readonly fulcrumG: Phaser.GameObjects.Graphics
  private readonly stringsG: Phaser.GameObjects.Graphics
  private readonly beam: Phaser.GameObjects.Container
  readonly leftPan: Phaser.GameObjects.Container
  readonly rightPan: Phaser.GameObjects.Container

  /** Current beam angle in degrees; positive = right side down. */
  private angle = 0
  private velocity = 0
  private targetAngle = 0
  private won = false

  constructor(scene: Phaser.Scene, geo: ScaleGeometry) {
    this.scene = scene
    this.geo = geo

    this.fulcrumG = scene.add.graphics()
    this.stringsG = scene.add.graphics()
    this.beam = scene.add.container(geo.cx, geo.cy)
    this.leftPan = scene.add.container(0, 0)
    this.rightPan = scene.add.container(0, 0)

    this.buildBeam()
    this.buildPan(this.leftPan)
    this.buildPan(this.rightPan)
    this.buildTargetBlock()
    this.drawFulcrum()
    this.positionPans()
  }

  layout(geo: ScaleGeometry) {
    this.geo = geo
    this.beam.setPosition(geo.cx, geo.cy)
    this.beam.removeAll(true)
    this.leftPan.removeAll(true)
    this.rightPan.removeAll(true)
    this.buildBeam()
    this.buildPan(this.leftPan)
    this.buildPan(this.rightPan)
    this.buildTargetBlock()
    this.drawFulcrum()
    this.positionPans()
  }

  setTargetAngle(deg: number) {
    this.targetAngle = deg
  }

  /** Snap the beam to its target (used on scene start / reset). */
  settleImmediately() {
    this.angle = this.targetAngle
    this.velocity = 0
    this.positionPans()
  }

  /** Winning locks the beam level: sway off, firmer damping. */
  setWon(won: boolean) {
    this.won = won
    if (won) this.targetAngle = 0
  }

  /** World point of the right pan dish center-top (drop target / layout). */
  rightPanAnchor(): { x: number; y: number } {
    return { x: this.rightPan.x, y: this.rightPan.y }
  }

  currentAngle(): number {
    return this.angle
  }

  update(timeMs: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05)

    // Idle sway: the pans "weigh" gently until the win locks things level.
    const sway =
      this.won || this.reducedMotion ? 0 : Math.sin(timeMs * 0.0016) * 0.9

    // Under-damped spring for a physical settle with a couple of wobbles;
    // reduced motion gets a crisp over-damped glide instead.
    const K = this.reducedMotion ? 140 : 90
    const C = this.reducedMotion ? 24 : this.won ? 10 : 6.5
    const goal = this.targetAngle + sway
    this.velocity += (K * (goal - this.angle) - C * this.velocity) * dt
    this.angle += this.velocity * dt

    this.beam.setAngle(this.angle)
    this.positionPans()
  }

  private endPoints() {
    const rad = Phaser.Math.DegToRad(this.angle)
    const dx = Math.cos(rad) * this.geo.halfBeam
    const dy = Math.sin(rad) * this.geo.halfBeam
    return {
      left: { x: this.geo.cx - dx, y: this.geo.cy - dy },
      right: { x: this.geo.cx + dx, y: this.geo.cy + dy },
    }
  }

  private positionPans() {
    const { left, right } = this.endPoints()
    const { ropeLen, panWidth } = this.geo
    this.leftPan.setPosition(left.x, left.y + ropeLen)
    this.rightPan.setPosition(right.x, right.y + ropeLen)

    // Strings: a V from each beam-end hook down to the dish rim.
    const g = this.stringsG
    g.clear()
    g.lineStyle(u(3), INK, 1)
    for (const [end, pan] of [
      [left, this.leftPan],
      [right, this.rightPan],
    ] as const) {
      g.lineBetween(end.x, end.y, pan.x - panWidth * 0.42, pan.y + u(2))
      g.lineBetween(end.x, end.y, pan.x + panWidth * 0.42, pan.y + u(2))
      // Hook dot at the beam end.
      g.fillStyle(INK, 1)
      g.fillCircle(end.x, end.y, u(5))
    }
  }

  private buildBeam() {
    const g = this.scene.add.graphics()
    const L = this.geo.halfBeam
    const h = Math.max(u(16), L * 0.09)
    const r = h * 0.45

    g.fillStyle(INK, 1)
    g.fillRoundedRect(-L - h * 0.4, -h / 2 + u(4), (L + h * 0.4) * 2, h, r)
    g.fillStyle(BEAM, 1)
    g.fillRoundedRect(-L - h * 0.4, -h / 2, (L + h * 0.4) * 2, h, r)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(-L - h * 0.4, -h / 2, (L + h * 0.4) * 2, h, r)
    // Shade band along the bottom edge.
    g.fillStyle(BEAM_DARK, 1)
    g.fillRoundedRect(-L - h * 0.4 + u(3), h / 2 - h * 0.28, (L + h * 0.4) * 2 - u(6), h * 0.2, h * 0.1)

    // Center hub over the pivot.
    g.fillStyle(BEAM_DARK, 1)
    g.fillCircle(0, 0, h * 0.85)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeCircle(0, 0, h * 0.85)
    g.fillStyle(INK, 1)
    g.fillCircle(0, 0, h * 0.3)

    this.beam.add(g)
  }

  private buildPan(pan: Phaser.GameObjects.Container) {
    const { panWidth: w, panHeight: h } = this.geo
    const g = this.scene.add.graphics()
    const r = h * 0.45

    // Dish: a shallow tray with an ink drop shadow.
    g.fillStyle(INK, 1)
    g.fillRoundedRect(-w / 2, u(4), w, h, { tl: r * 0.4, tr: r * 0.4, bl: r, br: r })
    g.fillStyle(PAN, 1)
    g.fillRoundedRect(-w / 2, 0, w, h, { tl: r * 0.4, tr: r * 0.4, bl: r, br: r })
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(-w / 2, 0, w, h, { tl: r * 0.4, tr: r * 0.4, bl: r, br: r })
    g.fillStyle(PAN_DARK, 1)
    g.fillRoundedRect(-w / 2 + u(4), h * 0.55, w - u(8), h * 0.28, r * 0.5)

    pan.add(g)
  }

  /** The fixed "67" slab sitting on the left pan. */
  private buildTargetBlock() {
    const { panWidth } = this.geo
    const w = panWidth * 0.62
    const h = w * 0.72
    const g = this.scene.add.graphics()
    g.fillStyle(TARGET_BLOCK, 1)
    g.fillRoundedRect(-w / 2, -h, w, h, w * 0.16)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(-w / 2, -h, w, h, w * 0.16)
    g.fillStyle(0xffffff, 0.14)
    g.fillRoundedRect(-w / 2 + w * 0.08, -h + w * 0.07, w * 0.4, w * 0.09, w * 0.045)

    const label = this.scene.add
      .text(0, -h / 2, '67', {
        fontFamily: FONT,
        fontSize: `${Math.round(h * 0.52)}px`,
        fontStyle: '800',
        color: '#FFF8EA',
      })
      .setOrigin(0.5)

    this.leftPan.add([g, label])
  }

  private drawFulcrum() {
    const { cx, cy } = this.geo
    const g = this.fulcrumG
    const h = this.geo.halfBeam * 0.52
    const baseW = h * 0.9
    g.clear()

    // Column: a rounded triangle from the pivot down to a base plate.
    g.fillStyle(INK, 1)
    g.fillRoundedRect(cx - baseW / 2, cy + h - u(6), baseW, Math.max(u(16), h * 0.14), u(8))
    g.fillStyle(BEAM_DARK, 1)
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(cx - baseW * 0.28, cy + h)
    g.lineTo(cx + baseW * 0.28, cy + h)
    g.closePath()
    g.fillPath()
    g.lineStyle(OUTLINE, INK, 1)
    g.strokePath()
  }

  /** Tiny helper for the menu screen: a static label under the fulcrum. */
  addCaption(text: string) {
    const { cx, cy } = this.geo
    this.scene.add
      .text(cx, cy + this.geo.halfBeam * 0.52 + u(34), text, TEXT.ink(15, '600'))
      .setOrigin(0.5)
  }
}
