import Phaser from 'phaser'
import { playReward } from '../services/audio'
import { prefersReducedMotion, u } from './layout'
import { INK, STAR } from './palette'
import { drawBulb } from './ui'

/**
 * Small effects shared by the scenes: the dust a weight kicks up on the pan, the
 * ring when the beam locks at 67, rewards that fly to the counter they fill, and
 * a close glyph for sheets. All drawn in code (no image assets); every one of
 * them stands still under reduced motion.
 */

const DUST_KEY = 'e67-dust'
const SPARK_KEY = 'e67-spark'

function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(DUST_KEY)) {
    const d = Math.round(u(6))
    const g = scene.add.graphics()
    g.fillStyle(0xe7ddcb, 1)
    g.fillCircle(d / 2, d / 2, d / 2)
    g.generateTexture(DUST_KEY, d, d)
    g.destroy()
  }
  if (!scene.textures.exists(SPARK_KEY)) {
    const d = Math.round(u(7))
    const g = scene.add.graphics()
    g.fillStyle(STAR, 1)
    g.fillCircle(d / 2, d / 2, d / 2)
    g.generateTexture(SPARK_KEY, d, d)
    g.destroy()
  }
}

/**
 * A puff where a weight lands: six dust motes out along the dish for a block, three
 * sparkles drifting up for a balloon.
 */
export function landingPuff(scene: Phaser.Scene, x: number, y: number, balloon: boolean, depth = 11): void {
  if (prefersReducedMotion()) return
  ensureTextures(scene)
  const emitter = scene.add
    .particles(x, y, balloon ? SPARK_KEY : DUST_KEY, {
      lifespan: balloon ? 420 : 260,
      speed: balloon ? { min: u(20), max: u(50) } : { min: u(40), max: u(90) },
      angle: balloon ? { min: 240, max: 300 } : { min: 190, max: 350 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.9, end: 0 },
      emitting: false,
    })
    .setDepth(depth)
  emitter.explode(balloon ? 3 : 6)
  scene.time.delayedCall(600, () => emitter.destroy())
}

/** A ring bursting out from the pivot as the beam locks: radius 0.2 → 1.1 × `reach`. */
export function ringBurst(scene: Phaser.Scene, x: number, y: number, reach: number, color: number, depth = 12): void {
  if (prefersReducedMotion()) return
  const g = scene.add.graphics().setDepth(depth).setPosition(x, y)
  const draw = (r: number, a: number) => {
    g.clear()
    g.lineStyle(u(4), color, a)
    g.strokeCircle(0, 0, r)
  }
  scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: 420,
    ease: 'Cubic.out',
    onUpdate: (t) => {
      const v = t.getValue() ?? 1
      draw(reach * (0.2 + 0.9 * v), 1 - v)
    },
    onComplete: () => g.destroy(),
  })
}

/**
 * Rewards that travel: up to eight bulbs fly from `from` to `to` along an arc and
 * `onArrive(i)` runs as each one lands (step the counter, pop the pill). The
 * reward is already paid when this starts — it only shows where it went. Under
 * reduced motion nothing flies and every arrival runs at once.
 */
export function flyBulbs(
  scene: Phaser.Scene,
  from: { x: number; y: number },
  to: { x: number; y: number },
  n: number,
  onArrive: (i: number, last: boolean) => void,
  depth = 140,
): void {
  const count = Math.max(1, Math.min(n, 8))
  if (prefersReducedMotion()) {
    for (let i = 0; i < count; i++) onArrive(i, i === count - 1)
    return
  }
  const control = new Phaser.Math.Vector2((from.x + to.x) / 2, Math.min(from.y, to.y) - u(120))
  const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(from.x, from.y), control, new Phaser.Math.Vector2(to.x, to.y))
  const p = new Phaser.Math.Vector2()
  for (let i = 0; i < count; i++) {
    const g = scene.add.graphics().setDepth(depth)
    drawBulb(g, 0, 0, u(22))
    g.setPosition(from.x, from.y).setScale(0.6)
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      delay: i * 60,
      duration: 520,
      ease: 'Cubic.in',
      onUpdate: (t) => {
        const v = t.getValue() ?? 1
        curve.getPoint(v, p)
        g.setPosition(p.x, p.y).setScale(0.6 + 0.5 * Math.sin(v * Math.PI))
      },
      onComplete: () => {
        g.destroy()
        playReward()
        onArrive(i, i === count - 1)
      },
    })
  }
}

/** A pill or button popping as something lands in it: 1.15 → 1 in 120 ms. */
export function popTarget(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject): void {
  if (prefersReducedMotion()) return
  scene.tweens.killTweensOf(target)
  scene.tweens.add({ targets: target, scale: { from: 1.15, to: 1 }, duration: 120, ease: 'Quad.out' })
}

/** An ✕ glyph centred in a `size` box, for a sheet's close button. */
export function drawCloseIcon(g: Phaser.GameObjects.Graphics, size: number): void {
  const a = size * 0.18
  g.lineStyle(Math.max(u(3), size * 0.08), INK, 1)
  g.lineBetween(-a, -a, a, a)
  g.lineBetween(-a, a, a, -a)
}

/** A 2×2 grid of rounded squares — the level map — centred in a `size` box. */
export function drawGridIcon(g: Phaser.GameObjects.Graphics, size: number): void {
  const cell = size * 0.17
  const gap = size * 0.06
  g.fillStyle(INK, 1)
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      const x = dx < 0 ? -gap / 2 - cell : gap / 2
      const y = dy < 0 ? -gap / 2 - cell : gap / 2
      g.fillRoundedRect(x, y, cell, cell, cell * 0.25)
    }
  }
}
