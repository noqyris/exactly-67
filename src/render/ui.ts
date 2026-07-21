import Phaser from 'phaser'
import { u } from './layout'
import { CREAM_CSS, FONT, GOOD, INK, OUTLINE, PAPER, STAR, STAR_EMPTY, UNDER } from './palette'

/**
 * Chunky rounded button: ink drop-shadow slab, candy fill, bold label. Pass an
 * optional `sublabel` for a smaller second line under the main label (e.g. a
 * value-prop under a price) — the main label shifts up and shrinks a touch.
 */
export function makeButton(
  scene: Phaser.Scene,
  label: string,
  width: number,
  height: number,
  fill: number,
  labelColor: string,
  onTap: () => void,
  sublabel?: string,
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0)
  const g = scene.add.graphics()
  const r = Math.min(u(18), height * 0.32)
  const drop = Math.max(u(3), Math.round(height * 0.08))

  const draw = (pressed: boolean) => {
    const dy = pressed ? drop : 0
    g.clear()
    if (!pressed) {
      g.fillStyle(INK, 1)
      g.fillRoundedRect(-width / 2, -height / 2 + drop, width, height, r)
    }
    g.fillStyle(fill, 1)
    g.fillRoundedRect(-width / 2, -height / 2 + dy, width, height, r)
    g.lineStyle(OUTLINE, INK, 1)
    g.strokeRoundedRect(-width / 2, -height / 2 + dy, width, height, r)
  }
  draw(false)

  const mainY = sublabel ? -height * 0.13 : 0
  const text = scene.add
    .text(0, mainY, label, {
      fontFamily: FONT,
      fontSize: `${Math.round(height * (sublabel ? 0.34 : 0.42))}px`,
      fontStyle: '700',
      color: labelColor,
    })
    .setOrigin(0.5)

  const kids: Phaser.GameObjects.GameObject[] = [g, text]
  let sub: Phaser.GameObjects.Text | undefined
  const subY = height * 0.23
  if (sublabel) {
    sub = scene.add
      .text(0, subY, sublabel, {
        fontFamily: FONT,
        fontSize: `${Math.round(height * 0.185)}px`,
        fontStyle: '600',
        color: labelColor,
      })
      .setOrigin(0.5)
      .setAlpha(0.72)
    kids.push(sub)
  }

  c.add(kids)
  c.setSize(width, height + drop)
  c.setInteractive({ useHandCursor: true })
  c.on('pointerdown', () => {
    draw(true)
    text.y = mainY + drop
    if (sub) sub.y = subY + drop
  })
  const release = () => {
    draw(false)
    text.y = mainY
    if (sub) sub.y = subY
  }
  c.on('pointerout', release)
  c.on('pointerup', () => {
    release()
    onTap()
  })
  return c
}

/** Small square icon button (back, sound, haptics). Redraws via `render`. */
export function makeIconButton(
  scene: Phaser.Scene,
  size: number,
  render: (g: Phaser.GameObjects.Graphics, size: number) => void,
  onTap: () => void,
): Phaser.GameObjects.Container & { refresh: () => void } {
  const c = scene.add.container(0, 0) as Phaser.GameObjects.Container & {
    refresh: () => void
  }
  const g = scene.add.graphics()
  const icon = scene.add.graphics()
  const r = size * 0.3

  g.fillStyle(INK, 1)
  g.fillRoundedRect(-size / 2, -size / 2 + u(3), size, size, r)
  g.fillStyle(PAPER, 1)
  g.fillRoundedRect(-size / 2, -size / 2, size, size, r)
  g.lineStyle(u(3), INK, 1)
  g.strokeRoundedRect(-size / 2, -size / 2, size, size, r)

  c.refresh = () => {
    icon.clear()
    render(icon, size)
  }
  c.refresh()

  c.add([g, icon])
  c.setSize(size, size)
  c.setInteractive({ useHandCursor: true })
  c.on('pointerup', onTap)
  return c
}

/** Five-pointed star path, filled + outlined. */
export function drawStar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
  filled: boolean,
) {
  const points: { x: number; y: number }[] = []
  const inner = radius * 0.48
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r })
  }
  g.fillStyle(filled ? STAR : STAR_EMPTY, 1)
  g.fillPoints(points, true)
  g.lineStyle(Math.max(u(2), radius * 0.14), INK, 1)
  g.strokePoints(points, true, true)
}

/** Speaker icon; a slash is drawn through it when muted. */
export function drawSoundIcon(g: Phaser.GameObjects.Graphics, size: number, on: boolean) {
  const s = size / 44
  g.fillStyle(INK, 1)
  g.fillRect(-9 * s, -5 * s, 6 * s, 10 * s)
  g.fillTriangle(-6 * s, 0, 3 * s, -10 * s, 3 * s, 10 * s)
  if (on) {
    g.lineStyle(2.6 * s, INK, 1)
    g.beginPath()
    g.arc(4 * s, 0, 7 * s, -Math.PI / 3.2, Math.PI / 3.2)
    g.strokePath()
  } else {
    g.lineStyle(3.4 * s, INK, 1)
    g.lineBetween(-11 * s, 11 * s, 11 * s, -11 * s)
  }
}

/** Buzzing-phone icon; slashed when haptics are off. */
export function drawHapticsIcon(g: Phaser.GameObjects.Graphics, size: number, on: boolean) {
  const s = size / 44
  g.lineStyle(2.8 * s, INK, 1)
  g.strokeRoundedRect(-5 * s, -9 * s, 10 * s, 18 * s, 2.5 * s)
  if (on) {
    g.lineStyle(2.4 * s, INK, 1)
    g.lineBetween(-9.5 * s, -5 * s, -9.5 * s, 5 * s)
    g.lineBetween(9.5 * s, -5 * s, 9.5 * s, 5 * s)
  } else {
    g.lineStyle(3.4 * s, INK, 1)
    g.lineBetween(-11 * s, 11 * s, 11 * s, -11 * s)
  }
}

export function drawBackIcon(g: Phaser.GameObjects.Graphics, size: number) {
  const s = size / 44
  g.lineStyle(4 * s, INK, 1)
  g.beginPath()
  g.moveTo(3 * s, -8 * s)
  g.lineTo(-6 * s, 0)
  g.lineTo(3 * s, 8 * s)
  g.strokePath()
}

/**
 * Lightbulb icon for the hint button, with a top-right corner badge that tells
 * the player, at a glance, what a tap does:
 *   - 'have'  → bulb lit + glow rays, green disc (the stash count is drawn as a
 *               separate Text child by the caller, since Graphics can't do text)
 *   - 'empty' → bulb dimmed, blue ▶ chip (watch a rewarded video to earn one)
 * Redundantly coded (bulb lit/dim + colour + glyph) so it reads without relying
 * on hue alone.
 */
export function drawHintIcon(
  g: Phaser.GameObjects.Graphics,
  size: number,
  state: 'have' | 'empty',
) {
  const s = size / 44
  const free = state === 'have'
  // Glass bulb — lit candy-yellow when a free hint is ready, muted grey once spent.
  g.fillStyle(free ? STAR : STAR_EMPTY, 1)
  g.fillCircle(0, -3 * s, 8.5 * s)
  g.lineStyle(2.8 * s, INK, 1)
  g.strokeCircle(0, -3 * s, 8.5 * s)
  // Screw base.
  g.fillStyle(INK, 1)
  g.fillRoundedRect(-4.5 * s, 4.2 * s, 9 * s, 6 * s, 1.6 * s)
  g.lineStyle(1.8 * s, INK, 1)
  g.lineBetween(-2.6 * s, 8.2 * s, 2.6 * s, 8.2 * s)
  if (free) {
    // Short glow rays around the bulb's top hemisphere.
    g.lineStyle(2 * s, STAR, 1)
    for (const a of [-1.1, -0.4, 0.4, 1.1]) {
      const dx = Math.sin(a)
      const dy = -Math.cos(a)
      g.lineBetween(dx * 10.5 * s, -3 * s + dy * 10.5 * s, dx * 13.5 * s, -3 * s + dy * 13.5 * s)
    }
  }

  const bx = 13 * s
  const by = -13 * s
  if (free) {
    // Green "available" disc; cream halo separates it from the yellow bulb.
    g.fillStyle(PAPER, 1)
    g.fillCircle(bx, by, 9.5 * s)
    g.fillStyle(GOOD, 1)
    g.fillCircle(bx, by, 8 * s)
    g.lineStyle(2 * s, INK, 1)
    g.strokeCircle(bx, by, 8 * s)
  } else {
    // Blue rewarded-video chip with a ▶ play triangle.
    const cw = 15 * s
    const ch = 11 * s
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(bx - cw / 2 - 1.5 * s, by - ch / 2 - 1.5 * s, cw + 3 * s, ch + 3 * s, 4 * s)
    g.fillStyle(UNDER, 1)
    g.fillRoundedRect(bx - cw / 2, by - ch / 2, cw, ch, 3.2 * s)
    g.lineStyle(2 * s, INK, 1)
    g.strokeRoundedRect(bx - cw / 2, by - ch / 2, cw, ch, 3.2 * s)
    g.fillStyle(PAPER, 1)
    g.fillTriangle(bx - 2.4 * s, by - 3.2 * s, bx - 2.4 * s, by + 3.2 * s, bx + 3.4 * s, by)
  }
}

/** Text styles take design-unit sizes and scale them to device pixels. */
export const TEXT = {
  ink: (size: number, weight = '700') => ({
    fontFamily: FONT,
    fontSize: `${Math.round(u(size))}px`,
    fontStyle: weight,
    color: '#2B2440',
  }),
  cream: (size: number, weight = '700') => ({
    fontFamily: FONT,
    fontSize: `${Math.round(u(size))}px`,
    fontStyle: weight,
    color: CREAM_CSS,
  }),
}
