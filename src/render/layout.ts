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
  /** Horizontal centre of the frame. */
  cx: number
  /**
   * The usable area is at least as wide as it is tall: the unfolded iPhone Duo
   * (~951×669 pt), an iPad in landscape, a Split View half. Scenes that care
   * (GameScene) switch to a side-by-side layout instead of a squeezed column.
   */
  wide: boolean
}

/** Width cap for a wide (side-by-side) layout, in design points. */
export const MAX_WIDE_W = 1100

/** Whether a screen of this size gets the side-by-side layout. */
export function isWide(screenW: number, screenH: number): boolean {
  const safe = safeArea()
  const usableW = screenW - safe.left - safe.right
  const usableH = screenH - safe.top - safe.bottom
  return usableW >= usableH
}

/**
 * The centred play area. It is centred between the SIDE safe insets, not on the
 * raw screen: the folded iPhone Duo puts its status bar in a strip down the
 * right edge, so centring on the full width would push the right pan under it.
 * `maxW` lets a wide layout take more width than the phone-shaped column.
 */
export function contentFrame(screenW: number, screenH: number, maxW = MAX_CONTENT_W): ContentFrame {
  const safe = safeArea()
  const left = safe.left
  const usableW = Math.max(1, screenW - safe.left - safe.right)
  const ew = Math.min(usableW, u(maxW))
  const eh = Math.min(screenH, u(MAX_CONTENT_H))
  const ox = left + (usableW - ew) / 2
  return { ox, oy: (screenH - eh) / 2, ew, eh, cx: ox + ew / 2, wide: isWide(screenW, screenH) }
}

export interface SafeArea {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Device-pixel height reserved at the physical bottom of the screen for the
 * native ad banner (0 when no banner is shown / ads removed). It is folded
 * into safeArea().bottom, so every scene automatically keeps its content — and
 * crucially its drag targets — above the banner strip. Set once at boot before
 * scenes lay out (see main.ts); the banner overlays this reserved gap.
 */
let adBannerReservePx = 0

export function setAdBannerReserve(px: number): void {
  adBannerReservePx = Math.max(0, px)
}

export function adBannerReserve(): number {
  return adBannerReservePx
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
    // Home-indicator inset plus any reserved ad-banner strip at the bottom.
    bottom: u(cssPx('--safe-bottom')) + adBannerReservePx,
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
