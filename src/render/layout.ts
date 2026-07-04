/**
 * The game canvas is sized in physical device pixels (see main.ts) so
 * Graphics and Text render crisp on retina screens. Every fixed design
 * dimension therefore goes through u(): 1 design unit = 1 CSS pixel.
 */
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)

export function u(n: number): number {
  return n * DPR
}

export interface SafeArea {
  top: number
  bottom: number
  left: number
  right: number
}

function cssPx(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

/**
 * iOS notch / home-indicator insets, exposed by style.css via env(),
 * converted to game (device-pixel) units.
 */
export function safeArea(): SafeArea {
  return {
    top: u(cssPx('--safe-top')),
    bottom: u(cssPx('--safe-bottom')),
    left: u(cssPx('--safe-left')),
    right: u(cssPx('--safe-right')),
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
