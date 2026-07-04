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

/** iOS notch / home-indicator insets, exposed by style.css via env(). */
export function safeArea(): SafeArea {
  return {
    top: cssPx('--safe-top'),
    bottom: cssPx('--safe-bottom'),
    left: cssPx('--safe-left'),
    right: cssPx('--safe-right'),
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
