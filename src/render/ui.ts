import Phaser from 'phaser'
import { prefersReducedMotion, u } from './layout'
import { CREAM_CSS, FONT, GOOD, INK, INK_CSS, OUTLINE, PAPER, STAR, STAR_EMPTY, UNDER } from './palette'

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

  // A label wider than its button shrinks to fit (a 320 pt phone, a long
  // localized string) instead of spilling over the outline.
  const room = width - Math.max(u(12), height * 0.3)
  if (text.width > room) text.setScale(room / text.width)

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

  // Arm on press, fire on release. Phaser re-hit-tests at the release position,
  // so a bare `pointerup` handler also fires for a finger that went down
  // somewhere else entirely — on the splash overlay, or on a modal that closed
  // under the thumb — and merely happened to lift here. Requiring the matching
  // press keeps such a stray release inert.
  let armed = false
  c.on('pointerdown', () => {
    armed = true
    draw(true)
    text.y = mainY + drop
    if (sub) sub.y = subY + drop
  })
  const release = () => {
    draw(false)
    text.y = mainY
    if (sub) sub.y = subY
  }
  c.on('pointerout', () => {
    armed = false
    release()
  })
  c.on('pointerup', () => {
    release()
    if (!armed) return
    armed = false
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
  // Same press-arming as makeButton: a release that didn't start here is ignored.
  let armed = false
  c.on('pointerdown', () => (armed = true))
  c.on('pointerout', () => (armed = false))
  c.on('pointerup', () => {
    if (!armed) return
    armed = false
    onTap()
  })
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

/** Eighth-note icon for the music toggle; slashed when the bed is off. */
export function drawMusicIcon(g: Phaser.GameObjects.Graphics, size: number, on: boolean) {
  const s = size / 44
  // Stem + flag.
  g.lineStyle(2.8 * s, INK, 1)
  g.lineBetween(5 * s, -12 * s, 5 * s, 6 * s)
  g.beginPath()
  g.moveTo(5 * s, -12 * s)
  g.lineTo(12 * s, -8.5 * s)
  g.lineTo(12 * s, -3 * s)
  g.lineTo(5 * s, -6.5 * s)
  g.strokePath()
  // Note head.
  g.fillStyle(INK, 1)
  g.fillEllipse(0, 7 * s, 11 * s, 8 * s)
  if (!on) {
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
  state: 'have' | 'empty' | 'spent',
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
  } else if (state === 'empty') {
    // Blue rewarded-video chip with a ▶ play triangle. Not drawn for 'spent':
    // no hint video can be offered (ads declined), so the bulb stays plain.
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

// --- meta-game art -----------------------------------------------------------------
// Same chunky language as the rest: candy fills, one thick ink outline. Every
// helper draws into a Graphics the caller owns, centred on (cx, cy).

export const MEDAL_FILL: Record<'bronze' | 'silver' | 'gold', number> = {
  bronze: 0xe0955a,
  silver: 0xd4dbe6,
  gold: 0xffd43b,
}
export const FLAME = 0xff8c42
export const FLAME_CORE = 0xffd43b
export const ICE = 0x74c0fc

/** A modal/card slab: ink drop shadow, fill, outline. */
export function drawCard(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill = PAPER,
  outline = OUTLINE + u(1),
) {
  g.fillStyle(INK, 1)
  g.fillRoundedRect(x, y + u(6), w, h, r)
  g.fillStyle(fill, 1)
  g.fillRoundedRect(x, y, w, h, r)
  g.lineStyle(outline, INK, 1)
  g.strokeRoundedRect(x, y, w, h, r)
}

/** A pill progress bar, `frac` 0–1 filled with `fill`. */
export function drawProgressBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  fill = STAR,
) {
  const r = h / 2
  g.fillStyle(0xe7ddcb, 1)
  g.fillRoundedRect(x, y, w, h, r)
  const f = Phaser.Math.Clamp(frac, 0, 1)
  if (f > 0) {
    const fw = Math.max(h, w * f)
    g.fillStyle(fill, 1)
    g.fillRoundedRect(x, y, fw, h, r)
    g.fillStyle(0xffffff, 0.35)
    g.fillRoundedRect(x + h * 0.3, y + h * 0.18, Math.max(0, fw - h * 0.6), h * 0.22, h * 0.11)
  }
  g.lineStyle(Math.max(u(2.5), h * 0.14), INK, 1)
  g.strokeRoundedRect(x, y, w, h, r)
}

function curvePoints(
  from: [number, number],
  c1: [number, number],
  c2: [number, number],
  to: [number, number],
  n = 12,
): Phaser.Math.Vector2[] {
  const v = (p: [number, number]) => new Phaser.Math.Vector2(p[0], p[1])
  return new Phaser.Curves.CubicBezier(v(from), v(c1), v(c2), v(to)).getPoints(n)
}

function flamePoints(cx: number, cy: number, s: number): Phaser.Math.Vector2[] {
  // A candle-style flame: round belly, a tip that leans right, and a small
  // second tongue on the left — the tongue is what stops it reading as a drop.
  const P = (x: number, y: number): [number, number] => [cx + x * s, cy + y * s]
  const segs: [[number, number], [number, number], [number, number], [number, number]][] = [
    [P(0.06, -0.52), P(0.14, -0.34), P(0.44, -0.2), P(0.38, 0.06)],
    [P(0.38, 0.06), P(0.36, 0.34), P(0.2, 0.5), P(0, 0.5)],
    [P(0, 0.5), P(-0.22, 0.5), P(-0.4, 0.32), P(-0.38, 0.08)],
    [P(-0.38, 0.08), P(-0.38, -0.1), P(-0.34, -0.22), P(-0.26, -0.32)],
    [P(-0.26, -0.32), P(-0.2, -0.2), P(-0.15, -0.14), P(-0.1, -0.1)],
    [P(-0.1, -0.1), P(-0.06, -0.28), P(0.02, -0.4), P(0.06, -0.52)],
  ]
  const out: Phaser.Math.Vector2[] = []
  segs.forEach(([a, b, c, d], i) => {
    const pts = curvePoints(a, b, c, d, 10)
    out.push(...(i === 0 ? pts : pts.slice(1)))
  })
  return out
}

/** The streak flame. Unlit (grey) when today's puzzle is not solved yet. */
export function drawFlame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, lit = true) {
  const outer = flamePoints(cx, cy, size)
  g.fillStyle(lit ? FLAME : STAR_EMPTY, 1)
  g.fillPoints(outer, true)
  const inner = flamePoints(cx + size * 0.02, cy + size * 0.18, size * 0.5)
  g.fillStyle(lit ? FLAME_CORE : 0xeee6d6, 1)
  g.fillPoints(inner, true)
  g.lineStyle(Math.max(u(2), size * 0.1), INK, 1)
  g.strokePoints(outer, true, true)
}

/** A streak freeze: a six-armed ice crystal on a pale disc. */
export function drawSnowflake(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, have = true) {
  const r = size / 2
  g.fillStyle(have ? 0xd0ebff : 0xeee6d6, 1)
  g.fillCircle(cx, cy, r)
  g.lineStyle(Math.max(u(2), size * 0.08), INK, 1)
  g.strokeCircle(cx, cy, r)
  g.lineStyle(Math.max(u(2), size * 0.09), have ? 0x1c7ed6 : STAR_EMPTY, 1)
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2
    const dx = Math.cos(a) * r * 0.62
    const dy = Math.sin(a) * r * 0.62
    g.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy)
    for (const sgn of [1, -1]) {
      const bx = cx + sgn * dx * 0.55
      const by = cy + sgn * dy * 0.55
      const b1 = a + Math.PI / 4
      const b2 = a - Math.PI / 4
      const k = r * 0.2 * sgn
      g.lineBetween(bx, by, bx + Math.cos(b1) * k, by + Math.sin(b1) * k)
      g.lineBetween(bx, by, bx + Math.cos(b2) * k, by + Math.sin(b2) * k)
    }
  }
}

/** Settings gear for an icon button (same 44-unit convention as the others). */
export function drawGearIcon(g: Phaser.GameObjects.Graphics, size: number) {
  const s = size / 44
  const teeth = 8
  const pts: Phaser.Math.Vector2[] = []
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2
    const r = i % 4 < 2 ? 12.5 * s : 9.5 * s
    pts.push(new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  g.fillStyle(INK, 1)
  g.fillPoints(pts, true)
  g.fillStyle(PAPER, 1)
  g.fillCircle(0, 0, 4.4 * s)
}

/** A bell, for the daily-reminder switch; slashed when off. */
export function drawBellIcon(g: Phaser.GameObjects.Graphics, size: number, on: boolean) {
  const s = size / 44
  g.fillStyle(INK, 1)
  g.beginPath()
  g.arc(0, -2 * s, 8 * s, Math.PI, 0)
  g.lineTo(10 * s, 7 * s)
  g.lineTo(-10 * s, 7 * s)
  g.closePath()
  g.fillPath()
  g.fillCircle(0, 10 * s, 2.6 * s)
  g.fillRect(-1.3 * s, -13 * s, 2.6 * s, 3.6 * s)
  if (!on) {
    g.lineStyle(3.4 * s, PAPER, 1)
    g.lineBetween(-11 * s, 13 * s, 11 * s, -11 * s)
    g.lineStyle(2.2 * s, INK, 1)
    g.lineBetween(-11 * s, 13 * s, 11 * s, -11 * s)
  }
}

/** The Star Jar: a glass jar whose star level rises with `frac`. */
export function drawJar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, frac: number) {
  const w = size * 0.72
  const h = size * 0.8
  const x = cx - w / 2
  const y = cy - h / 2 + size * 0.08
  const r = w * 0.24
  g.fillStyle(0xfdf8ee, 1)
  g.fillRoundedRect(x, y, w, h, r)
  const f = Phaser.Math.Clamp(frac, 0, 1)
  if (f > 0) {
    const fh = Math.max(r * 0.9, h * f)
    g.fillStyle(STAR, 1)
    g.fillRoundedRect(x, y + h - fh, w, fh, { tl: f > 0.9 ? r : 2, tr: f > 0.9 ? r : 2, bl: r, br: r })
  }
  g.lineStyle(Math.max(u(2), size * 0.08), INK, 1)
  g.strokeRoundedRect(x, y, w, h, r)
  // Lid.
  g.fillStyle(0xd99a26, 1)
  g.fillRoundedRect(cx - w * 0.36, y - size * 0.16, w * 0.72, size * 0.16, size * 0.05)
  g.strokeRoundedRect(cx - w * 0.36, y - size * 0.16, w * 0.72, size * 0.16, size * 0.05)
  drawStarShape(g, cx, y + h * 0.56, size * 0.17, 0xffffff, 0.75)
}

function drawStarShape(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, fill: number, alpha = 1) {
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.48
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r })
  }
  g.fillStyle(fill, alpha)
  g.fillPoints(points, true)
}

/** A wrapped gift box. */
export function drawGift(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number) {
  const w = size * 0.8
  const h = size * 0.58
  const x = cx - w / 2
  const y = cy - h / 2 + size * 0.12
  const lw = Math.max(u(2), size * 0.07)
  g.fillStyle(0xff6b9d, 1)
  g.fillRoundedRect(x, y, w, h, size * 0.08)
  g.fillStyle(0xff8fb4, 1)
  g.fillRoundedRect(x - size * 0.05, y - size * 0.16, w + size * 0.1, size * 0.2, size * 0.06)
  g.fillStyle(STAR, 1)
  g.fillRect(cx - size * 0.08, y - size * 0.16, size * 0.16, h + size * 0.16)
  g.lineStyle(lw, INK, 1)
  g.strokeRoundedRect(x, y, w, h, size * 0.08)
  g.strokeRoundedRect(x - size * 0.05, y - size * 0.16, w + size * 0.1, size * 0.2, size * 0.06)
  // Bow.
  g.fillStyle(STAR, 1)
  g.fillEllipse(cx - size * 0.15, y - size * 0.25, size * 0.28, size * 0.18)
  g.fillEllipse(cx + size * 0.15, y - size * 0.25, size * 0.28, size * 0.18)
  g.strokeEllipse(cx - size * 0.15, y - size * 0.25, size * 0.28, size * 0.18)
  g.strokeEllipse(cx + size * 0.15, y - size * 0.25, size * 0.28, size * 0.18)
}

/** A medal on a ribbon (pack medals, monthly trophies). Empty ring when `tier` is null. */
export function drawMedal(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  tier: 'bronze' | 'silver' | 'gold' | null,
) {
  const r = size * 0.34
  const lw = Math.max(u(2), size * 0.08)
  if (tier) {
    g.fillStyle(0x4dabf7, 1)
    g.fillTriangle(cx - r * 0.9, cy - size * 0.5, cx - r * 0.1, cy - size * 0.5, cx - r * 0.2, cy)
    g.fillStyle(0xff6b6b, 1)
    g.fillTriangle(cx + r * 0.9, cy - size * 0.5, cx + r * 0.1, cy - size * 0.5, cx + r * 0.2, cy)
    g.lineStyle(lw, INK, 1)
    g.strokeTriangle(cx - r * 0.9, cy - size * 0.5, cx - r * 0.1, cy - size * 0.5, cx - r * 0.2, cy)
    g.strokeTriangle(cx + r * 0.9, cy - size * 0.5, cx + r * 0.1, cy - size * 0.5, cx + r * 0.2, cy)
  }
  const mcy = cy + size * 0.12
  g.fillStyle(tier ? MEDAL_FILL[tier] : 0xeee6d6, 1)
  g.fillCircle(cx, mcy, r)
  g.lineStyle(lw, INK, tier ? 1 : 0.35)
  g.strokeCircle(cx, mcy, r)
  if (tier) drawStarShape(g, cx, mcy, r * 0.55, 0xffffff, 0.8)
}

/** A small lit bulb (the hint unit) for chips and reward rows. */
export function drawBulb(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number) {
  const s = size / 24
  g.fillStyle(STAR, 1)
  g.fillCircle(cx, cy - 2 * s, 7.5 * s)
  g.lineStyle(Math.max(u(1.6), 2.2 * s), INK, 1)
  g.strokeCircle(cx, cy - 2 * s, 7.5 * s)
  g.fillStyle(INK, 1)
  g.fillRoundedRect(cx - 4 * s, cy + 4.6 * s, 8 * s, 5 * s, 1.4 * s)
}

/**
 * A rounded "chip": icon on the left, a count on the right, whole chip taps.
 * `setLabel` updates the count in place (a reward landing, a purchase).
 */
export function makeChip(
  scene: Phaser.Scene,
  h: number,
  drawIcon: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number) => void,
  label: string,
  onTap?: () => void,
): Phaser.GameObjects.Container & { setLabel: (s: string) => void; chipWidth: number } {
  const c = scene.add.container(0, 0) as Phaser.GameObjects.Container & {
    setLabel: (s: string) => void
    chipWidth: number
  }
  const g = scene.add.graphics()
  const icon = scene.add.graphics()
  const text = scene.add
    .text(0, 0, label, { fontFamily: FONT, fontSize: `${Math.round(h * 0.5)}px`, fontStyle: '800', color: '#2B2440' })
    .setOrigin(0, 0.5)
  const layout = () => {
    const iconSize = h * 0.7
    const w = h * 0.3 + iconSize + h * 0.18 + text.width + h * 0.38
    c.chipWidth = w
    g.clear()
    g.fillStyle(INK, 1)
    g.fillRoundedRect(-w / 2, -h / 2 + u(3), w, h, h / 2)
    g.fillStyle(PAPER, 1)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2)
    g.lineStyle(u(3), INK, 1)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2)
    icon.clear()
    drawIcon(icon, -w / 2 + h * 0.3 + iconSize / 2, 0, iconSize)
    text.setX(-w / 2 + h * 0.3 + iconSize + h * 0.18)
    c.setSize(w, h)
  }
  c.setLabel = (s: string) => {
    text.setText(s)
    layout()
  }
  c.add([g, icon, text])
  layout()
  if (onTap) {
    c.setInteractive({ useHandCursor: true })
    let armed = false
    c.on('pointerdown', () => (armed = true))
    c.on('pointerout', () => (armed = false))
    c.on('pointerup', () => {
      if (!armed) return
      armed = false
      onTap()
    })
  }
  return c
}

/**
 * Tap handling for anything that is not a makeButton (text links, toggle rows):
 * armed on press, disarmed when the finger slides off, fired only on a release
 * over the same object. Phaser re-hit-tests a release, so a bare `pointerup`
 * fires for a finger that went down on a neighbouring button and slid here —
 * on a privacy link or a reminder switch that opens a system sheet or the iOS
 * permission prompt nobody asked for. `feedback` dims the object while pressed.
 */
export function onTap(obj: Phaser.GameObjects.GameObject, fn: () => void, feedback = false): void {
  let armed = false
  const setAlpha = (a: number) => {
    if (feedback && 'setAlpha' in obj) (obj as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(a)
  }
  obj.on('pointerdown', () => {
    armed = true
    setAlpha(0.55)
  })
  obj.on('pointerout', () => {
    armed = false
    setAlpha(1)
  })
  obj.on('pointerup', () => {
    setAlpha(1)
    if (!armed) return
    armed = false
    fn()
  })
}

// --- the logo ------------------------------------------------------------------------
// The app icon's focal artwork for the start screen: the candy "67" standing on a
// level beam, without the icon's raspberry square and rays. Every number is in the
// icon's own 1024 × 1024 space (y down) and comes from tools/make-icon.mjs (its `G`
// table and `VARIANTS.light`): change the icon, change it here too.
//
// It is painted with the Canvas 2D API into one texture instead of being built from
// Graphics and Text: the icon clips its gloss and shines to each digit, blurs its
// drop shadows and fills with gradients, and Graphics can do none of that (a
// GeometryMask can clip, but it ignores the transform of a Container it sits in).
// The numerals are Baloo 2 ExtraBold's own outlines, the same path data the icon
// draws, so the rim, the extrusion and the clip share one exact silhouette, just
// as on the icon, and nothing waits for the web font.

/** "6" (outer contour, then the counter) and "7" at 720 px, as the icon places them. */
const LOGO_SIX =
  'M483.48 265.52Q483.48 280.64 476.64 294.68Q469.8 308.72 460.44 315.92Q441 307.28 419.76 302.6Q398.52 297.92 380.52 297.92Q338.04 297.92 314.28 320.6Q290.52 343.28 282.6 385.76Q297 375.68 320.76 367.4Q344.52 359.12 369.72 359.12Q435.96 359.12 475.2 397.64Q514.44 436.16 514.44 506.72Q514.44 547.76 495 583.04Q475.56 618.32 437.76 639.92Q399.96 661.52 343.08 661.52Q286.92 661.52 245.88 635.96Q204.84 610.4 182.88 561.44Q160.92 512.48 160.92 442.64Q160.92 382.88 175.68 337.52Q190.44 292.16 217.8 261.92Q245.16 231.68 282.24 216.56Q319.32 201.44 364.68 201.44Q402.84 201.44 429.48 208.64Q456.12 215.84 469.8 229.88Q483.48 243.92 483.48 265.52Z'
const LOGO_SIX_HOLE =
  'M343.8 564.32Q367.56 564.32 379.44 548.48Q391.32 532.64 391.32 507.44Q391.32 482.24 378.72 467.48Q366.12 452.72 342.36 452.72Q328.68 452.72 313.2 458.48Q297.72 464.24 288.36 474.32L288.36 492.32Q288.36 530.48 304.56 547.4Q320.76 564.32 343.8 564.32Z'
const LOGO_SEVEN =
  'M580.84 212.24L831.4 212.24Q843.64 220.16 853.36 234.2Q863.08 248.24 863.08 269.12Q863.08 280.64 860.92 292.52Q858.76 304.4 853.72 315.92L703.96 655.04Q693.88 655.76 685.24 655.76L667.96 655.76Q635.56 655.76 615.4 643.16Q595.24 630.56 595.24 601.04Q595.24 585.92 602.8 568.28Q610.36 550.64 621.88 526.16L727 310.88L550.6 310.88Q546.28 302.96 541.96 290Q537.64 277.04 537.64 262.64Q537.64 235.28 549.88 223.76Q562.12 212.24 580.84 212.24Z'

interface LogoShadow {
  dy: number
  sigma: number
  alpha: number
}

const LOGO = {
  top: 201.44, // the faces' top edge (the 6 is the taller digit)
  baseline: 650,
  depth: 32, // the extrusion, straight down
  step: 3, // the silhouette is re-drawn every `step` px down to `depth`
  rim: 22, // ink outside the silhouette: a stroke of twice this
  seam: 10, // ink stroke under the face, 5 px of it showing against the walls
  face: [[0, '#FFF4B0'], [0.45, '#FFE04D'], [1, '#FFC21F']] as const,
  side: [[0, '#F59331'], [1, '#D46A14']] as const,
  gloss: { cy: 158.24, rx: 316.8, ry: 259.2, alpha: 0.55 },
  digits: [
    // The 6's shine is kept short and dim so the 7's bar is the single hottest spot.
    { d: LOGO_SIX + LOGO_SIX_HOLE, hole: LOGO_SIX_HOLE, glossX: 337.68, shine: { cx: 236, cy: 318, w: 40, h: 96, deg: 28, alpha: 0.6 } },
    { d: LOGO_SEVEN, hole: null, glossX: 700.36, shine: { cx: 635.2, cy: 251.8, w: 144, h: 40, deg: 0, alpha: 0.9 } },
  ],
  beam: { x: 112, y: 676, w: 800, h: 88, stroke: 22, fill: [[0, '#96F2D7'], [0.55, '#63E6BE'], [1, '#20C997']] as const },
  beamHi: { x: 146, y: 689, w: 732, h: 14, fill: '#E6FCF5', alpha: 0.85 },
  stand: { apex: [512, 720], base: [420, 604, 872], join: 14 },
  foot: { x: 377, y: 862, w: 270, h: 40 },
  // On cream the icon's white glints would vanish: the game's own star yellow, inked.
  sparkles: [
    [132, 172, 40],
    [196, 112, 19],
    [902, 560, 26],
  ] as const,
  sparkleEdge: 6,
  // The icon's raspberry-dark shadow reads as a stain on cream; a warm brown reads as shade.
  shadowRgb: '122, 106, 76',
  drop: { dy: 16, sigma: 12, alpha: 0.45 } as LogoShadow,
  low: { dy: 10, sigma: 9, alpha: 0.405 } as LogoShadow,
  /** The painted area without the sparkles, blurred shadows included. */
  crop: { l: 70, t: 155, r: 954, b: 944 },
  /**
   * For layout: [left, right, top] of each part that can be the highest thing in
   * a band (the rims around both digits, the sparkles with their ink edge), and
   * the whole box down to the stand's foot.
   */
  tops: [
    [138.92, 536.44, 179.44],
    [515.64, 885.08, 190.24],
    [89, 175, 129],
    [174, 218, 90],
    [873, 931, 531],
  ] as const,
  box: { l: 89, r: 931, b: 902 },
}

/** Absolute M/L/Q/Z path data (all the logo uses) onto a 2D context. */
function tracePath(ctx: CanvasRenderingContext2D, d: string) {
  const t = d.match(/[MLQZ]|-?\d*\.?\d+/g) ?? []
  let i = 0
  const n = () => Number(t[i++])
  while (i < t.length) {
    const cmd = t[i++]
    if (cmd === 'M') ctx.moveTo(n(), n())
    else if (cmd === 'L') ctx.lineTo(n(), n())
    else if (cmd === 'Q') ctx.quadraticCurveTo(n(), n(), n(), n())
    else if (cmd === 'Z') ctx.closePath()
  }
}

/** A rounded rect as a path (ctx.roundRect is too new for older iOS web views). */
function tracePill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A vertical gradient over y0 → y1, from `[offset, colour]` stops. */
function vGradient(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  for (const [at, colour] of stops) g.addColorStop(at, colour)
  return g
}

/**
 * Stand, beam and both numerals, painted in logo units under `ctx`'s transform
 * `(k, tx, ty)` onto a `w × h` canvas area, in the icon's layer order.
 */
function paintLogoArt(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, tx: number, ty: number) {
  const ink = INK_CSS
  // A group casts ONE shadow, as the icon's SVG filter on a <g> does: drawn off
  // screen first, then composited with the shadow. Twelve stacked copies each
  // casting their own would darken it twelve times.
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const oc = off.getContext('2d')
  const shaded = (s: LogoShadow, draw: (c: CanvasRenderingContext2D) => void) => {
    if (!oc) {
      draw(ctx)
      return
    }
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.clearRect(0, 0, w, h)
    oc.setTransform(k, 0, 0, k, tx, ty)
    draw(oc)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.shadowColor = `rgba(${LOGO.shadowRgb}, ${s.alpha})`
    // Canvas shadows ignore the transform (device px), and a blur is twice its σ.
    ctx.shadowOffsetY = s.dy * k
    ctx.shadowBlur = 2 * s.sigma * k
    ctx.drawImage(off, 0, 0)
    ctx.restore()
  }
  ctx.setTransform(k, 0, 0, k, tx, ty)

  // The fulcrum. Its corners hide behind the beam and the foot.
  const { apex, base, join } = LOGO.stand
  shaded(LOGO.low, (c) => {
    c.fillStyle = ink
    c.strokeStyle = ink
    c.lineWidth = join
    c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(apex[0], apex[1])
    c.lineTo(base[0], base[2])
    c.lineTo(base[1], base[2])
    c.closePath()
    c.fill()
    c.stroke()
    const f = LOGO.foot
    c.beginPath()
    tracePill(c, f.x, f.y, f.w, f.h, f.h / 2)
    c.fill()
  })

  // The beam, level: "exactly".
  const b = LOGO.beam
  shaded(LOGO.low, (c) => {
    c.beginPath()
    tracePill(c, b.x, b.y, b.w, b.h, b.h / 2)
    c.fillStyle = vGradient(c, b.y, b.y + b.h, b.fill)
    c.fill()
    c.lineWidth = b.stroke
    c.strokeStyle = ink
    c.stroke()
  })
  const hi = LOGO.beamHi
  ctx.globalAlpha = hi.alpha
  ctx.fillStyle = hi.fill
  ctx.beginPath()
  tracePill(ctx, hi.x, hi.y, hi.w, hi.h, hi.h / 2)
  ctx.fill()
  ctx.globalAlpha = 1

  const offsets: number[] = []
  for (let d = 0; d <= LOGO.depth; d += LOGO.step) offsets.push(d)
  if (offsets[offsets.length - 1] !== LOGO.depth) offsets.push(LOGO.depth)
  const face = vGradient(ctx, LOGO.top, LOGO.baseline, LOGO.face)
  // The walls' gradient is laid out once and moves down with each copy's translate.
  const side = vGradient(ctx, LOGO.top, LOGO.baseline + LOGO.depth, LOGO.side)
  const g = LOGO.gloss
  for (const dg of LOGO.digits) {
    // Rim + depth: the silhouette swept straight down, inked well past its edge.
    shaded(LOGO.drop, (c) => {
      c.fillStyle = ink
      c.strokeStyle = ink
      c.lineWidth = 2 * LOGO.rim
      c.lineJoin = 'round'
      for (const o of offsets) {
        c.save()
        c.translate(0, o)
        c.beginPath()
        tracePath(c, dg.d)
        c.fill()
        c.stroke()
        c.restore()
      }
    })
    // The side walls.
    ctx.fillStyle = side
    for (const o of offsets.slice(1)) {
      ctx.save()
      ctx.translate(0, o)
      ctx.beginPath()
      tracePath(ctx, dg.d)
      ctx.fill()
      ctx.restore()
    }
    // The face over a thin ink seam (the stroke goes first, as paint-order="stroke").
    ctx.beginPath()
    tracePath(ctx, dg.d)
    ctx.lineWidth = LOGO.seam
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ink
    ctx.stroke()
    ctx.fillStyle = face
    ctx.fill()
    if (dg.hole) {
      // The 6's counter: the walls showing through it read as an open mouth at
      // icon size, so it is cleared back to the ground (here: whatever the scene
      // paints behind) with only an ink ring left.
      ctx.save()
      ctx.beginPath()
      tracePath(ctx, dg.hole)
      ctx.clip()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = 2 * LOGO.rim
      ctx.lineJoin = 'miter'
      ctx.stroke()
      ctx.restore()
    }
    // Gloss and shine, clipped to this digit alone.
    ctx.save()
    ctx.beginPath()
    tracePath(ctx, dg.d)
    ctx.clip()
    ctx.fillStyle = `rgba(255, 255, 255, ${g.alpha})`
    ctx.beginPath()
    ctx.ellipse(dg.glossX, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2)
    ctx.fill()
    const s = dg.shine
    ctx.globalAlpha = s.alpha
    ctx.fillStyle = '#FFFFFF'
    ctx.translate(s.cx, s.cy)
    ctx.rotate((s.deg * Math.PI) / 180)
    ctx.beginPath()
    tracePill(ctx, -s.w / 2, -s.h / 2, s.w, s.h, Math.min(s.w, s.h) / 2)
    ctx.fill()
    ctx.restore()
  }
  off.width = 0
  off.height = 0
}

/** A four-point candy glint centred on (x, y), in logo units. */
function paintSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const q = r * 0.16
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.quadraticCurveTo(x + q, y - q, x + r, y)
  ctx.quadraticCurveTo(x + q, y + q, x, y + r)
  ctx.quadraticCurveTo(x - q, y + q, x - r, y)
  ctx.quadraticCurveTo(x - q, y - q, x, y - r)
  ctx.closePath()
  ctx.fillStyle = `#${STAR.toString(16).padStart(6, '0')}`
  ctx.fill()
  ctx.lineWidth = LOGO.sparkleEdge
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK_CSS
  ctx.stroke()
}

/**
 * The logo's artwork box for a given `size`, relative to drawLogo's (x, y), in
 * device px, for laying out around it before it is drawn: from its highest point
 * (the top sparkle's tip) down to the stand's foot. With `band`, `top` counts only
 * what lies within `band` px either side of x, so a wordmark that narrow can sit
 * above the numerals and beside the sparkles rather than above both.
 */
export function logoExtent(size: number, band = Infinity): { top: number; bottom: number; left: number; right: number } {
  const k = size / 1024
  const lo = 512 - band / k
  const hi = 512 + band / k
  const top = Math.min(...LOGO.tops.filter(([l, r]) => r >= lo && l <= hi).map(([, , t]) => t))
  const { l, r, b } = LOGO.box
  return { top: (top - 512) * k, bottom: (b - 512) * k, left: (l - 512) * k, right: (r - 512) * k }
}

let logoSerial = 0

/**
 * The app icon's artwork (see above): the icon's 1024 square is `size` device px
 * wide and centred on (x, y), so every icon dimension is scaled by `size / 1024`.
 * `size` is already in device px: do not pass it through u() again. Unless the
 * player prefers reduced motion, the three sparkles twinkle.
 *
 * The texture is painted once, at exactly the size it is shown (a canvas texture
 * scaled down aliases), and is freed when the container is destroyed, so a
 * scene rebuilt at a new size draws a new one rather than piling up old ones.
 */
export function drawLogo(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Container {
  const k = size / 1024
  const c = scene.add.container(x, y)
  const key = `e67-logo-${++logoSerial}`
  // The art is placed on whole device pixels: a 1:1 texture drawn between pixels
  // is resampled and goes soft.
  const { crop } = LOGO
  const left = Math.floor(x + (crop.l - 512) * k)
  const top = Math.floor(y + (crop.t - 512) * k)
  const artW = Math.ceil(x + (crop.r - 512) * k) - left
  const artH = Math.ceil(y + (crop.b - 512) * k) - top
  // Each sparkle gets its own frame in a column right of the art (2 px gutters,
  // so a twinkle's filtering never samples a neighbour), so it can scale alone.
  const cells = LOGO.sparkles.map(([, , r]) => Math.ceil(2 * (r + LOGO.sparkleEdge) * k) + 2)
  const colX = artW + 2
  const texW = colX + Math.max(...cells)
  const texH = Math.max(artH, cells.reduce((sum, cell) => sum + cell + 2, 0))
  const tex = scene.textures.createCanvas(key, texW, texH)
  if (!tex) return c
  const ctx = tex.getContext()
  paintLogoArt(ctx, artW, artH, k, x - 512 * k - left, y - 512 * k - top)
  tex.add('art', 0, 0, 0, artW, artH)
  c.add(scene.add.image(left - x, top - y, key, 'art').setOrigin(0))

  const glints: Phaser.GameObjects.Image[] = []
  let cellY = 0
  LOGO.sparkles.forEach(([sx, sy, r], i) => {
    const cell = cells[i]
    ctx.setTransform(k, 0, 0, k, colX + cell / 2 - sx * k, cellY + cell / 2 - sy * k)
    paintSparkle(ctx, sx, sy, r)
    tex.add(`glint${i}`, 0, colX, cellY, cell, cell)
    glints.push(scene.add.image((sx - 512) * k, (sy - 512) * k, key, `glint${i}`))
    cellY += cell + 2
  })
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  tex.refresh()
  c.add(glints)

  if (!prefersReducedMotion()) {
    // Out of step with each other, so the three never pulse as one.
    glints.forEach((glint, i) => {
      scene.tweens.add({
        targets: glint,
        scale: { from: 1, to: 0.62 },
        duration: 1100 + i * 380,
        delay: i * 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    })
  }
  const textures = scene.textures
  c.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.tweens.killTweensOf(glints)
    if (textures.exists(key)) textures.remove(key)
  })
  return c
}
