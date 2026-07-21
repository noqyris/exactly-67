import { Capacitor } from '@capacitor/core'
import { InAppReview } from '@capacitor-community/in-app-review'
import { loadReviewRequested, saveReviewRequested } from './storage'

/**
 * "Rate this app" — a thin, one-shot wrapper over the native review prompt,
 * following the audio/haptics/ads pattern (toggle-gated, web-no-op, try-catch).
 *
 * The prompt is fire-and-forget by design: on iOS `InAppReview.requestReview()`
 * calls the modern StoreKit `AppStore.requestReview(in:)` (with an
 * `SKStoreReviewController` fallback), which the OS silently caps at ~3 prompts
 * per 365 days and may show zero times. There is no callback telling us whether
 * the sheet appeared or the user rated — so we simply spend our one ask at the
 * best possible moment and never depend on the outcome. Per Apple's HIG we:
 *   - ask only after demonstrated engagement, at a moment of genuine delight,
 *   - never wire it to a button, never gate content on it, never incentivise it,
 *   - ask at most once (a persisted flag), and never after a failure.
 *
 * See docs/MONETIZATION.md.
 */

/** Global level (>= this) at which a first-ever 3★ clear is delight enough to ask. */
const DELIGHT_MIN_GLOBAL = 8
/** Fallback: ask by this milestone even for players who never earn 3★. */
const MILESTONE_GLOBAL = 12

let requested = false

/** Load the persisted one-shot flag at boot (before any win can fire the ask). */
export async function initReview(): Promise<void> {
  requested = await loadReviewRequested()
}

/**
 * Ask for a review if this clear is a good delight peak and we've never asked.
 * Call from the win overlay, a beat after the star pop. Native-only; resolves
 * immediately whether or not the OS actually shows the sheet.
 */
export async function maybeRequestReview(global: number, stars: number): Promise<void> {
  if (!Capacitor.isNativePlatform() || requested) return
  const delight = stars === 3 && global >= DELIGHT_MIN_GLOBAL
  const milestone = global >= MILESTONE_GLOBAL
  if (!(delight || milestone)) return
  // Spend the one-shot up front so a slow/failed native call can't double-ask.
  requested = true
  void saveReviewRequested(true)
  try {
    await InAppReview.requestReview()
  } catch {
    // no prompt available / declined — nothing to do
  }
}
