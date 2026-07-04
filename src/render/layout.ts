/**
 * The game canvas is sized in physical device pixels (see main.ts) so
 * Graphics and Text render crisp on retina screens. Every fixed design
 * dimension therefore goes through u(): 1 design unit = 1 CSS pixel.
 */
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)

export function u(n: number): number {
  return n * DPR
}

/**
 * Largest play area we let the game occupy, in design points. On a phone the
 * screen is narrower/shorter than these, so the frame is the whole screen and
 * nothing changes. On a tablet the frame caps out and is centered, so the game
 * reads as a large, well-proportioned column instead of a stretched phone.
 */
export const MAX_CONTENT_W = 680
export const MAX_CONTENT_H = 940

export interface ContentFrame {
  /** Left/top offset of the centered frame within the screen (0 on phones). */
  ox: number
  oy: number
  /** Effective width/height of the play area, in device pixels. */
  ew: number
  eh: number
  /** Horizontal screen centre (frame is centered, so this is the frame centre). */
  cx: number
}

export function contentFrame(screenW: number, screenH: number): ContentFrame {
  const ew = Math.min(screenW, u(MAX_CONTENT_W))
  const eh = Math.min(screenH, u(MAX_CONTENT_H))
  return { ox: (screenW - ew) / 2, oy: (screenH - eh) / 2, ew, eh, cx: screenW / 2 }
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
