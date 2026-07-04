import Phaser from 'phaser'
import { u } from './layout'
import { CREAM_CSS, FONT, INK, OUTLINE, PAPER, STAR, STAR_EMPTY } from './palette'

/** Chunky rounded button: ink drop-shadow slab, candy fill, bold label. */
export function makeButton(
  scene: Phaser.Scene,
  label: string,
  width: number,
  height: number,
  fill: number,
  labelColor: string,
  onTap: () => void,
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

  const text = scene.add
    .text(0, 0, label, {
      fontFamily: FONT,
      fontSize: `${Math.round(height * 0.42)}px`,
      fontStyle: '700',
      color: labelColor,
    })
    .setOrigin(0.5)

  c.add([g, text])
  c.setSize(width, height + drop)
  c.setInteractive({ useHandCursor: true })
  c.on('pointerdown', () => {
    draw(true)
    text.y = drop
  })
  const release = () => {
    draw(false)
    text.y = 0
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
