import { Capacitor } from '@capacitor/core'
import { InAppReview } from '@capacitor-community/in-app-review'
import { noteReviewAsked, parseReviewAsks, reviewDue } from '../game/review'
import { loadReviewAsks, loadReviewRequested, saveReviewAsks } from './storage'

/**
 * "Rate this app" — a thin wrapper over the native review prompt, following the
 * audio/haptics/ads pattern (web-no-op, try-catch). WHEN to ask is pure
 * (game/review.ts): up to three asks a year at moments of delight — the OS caps
 * the sheet at three per 365 days anyway and may show it fewer times. There is
 * no callback telling us whether the sheet appeared or the player rated, so we
 * ask at good moments and never depend on the outcome. Per Apple's HIG: only
 * after engagement, never wired to a button, never gating content, never
 * incentivised, never after a failure. See docs/MONETIZATION.md.
 *
 * Until 1.3.2 it asked once in a lifetime (exactly67.reviewRequested) and the
 * store page has no ratings. A player who had that one ask counts as asked at
 * the first launch of 1.3.2, so the next ask is still two weeks away.
 */

let asks: number[] = []

/** Load the persisted asks at boot (before any win can fire one). */
export async function initReview(): Promise<void> {
  const stored = await loadReviewAsks()
  if (stored) {
    asks = parseReviewAsks(stored)
    return
  }
  if (await loadReviewRequested()) {
    asks = [Date.now()]
    void saveReviewAsks(asks)
  }
}

/**
 * Whether maybeRequestReview() would ask on this clear — a non-consuming
 * predicate, so the win card can keep other asks (the reminder offer) off the
 * same moment. Never pair two asks on one win.
 */
export function reviewWouldAsk(global: number, stars: number): boolean {
  if (!Capacitor.isNativePlatform()) return false
  return reviewDue({ asks, nowMs: Date.now(), global, stars })
}

/**
 * Ask for a review if this clear is a good delight peak. Call from the win
 * overlay, a beat after the star pop. Native-only; resolves immediately whether
 * or not the OS actually shows the sheet.
 */
export async function maybeRequestReview(global: number, stars: number): Promise<void> {
  if (!reviewWouldAsk(global, stars)) return
  // Record the ask up front so a slow/failed native call can't double-ask.
  asks = noteReviewAsked(asks, Date.now())
  void saveReviewAsks(asks)
  try {
    await InAppReview.requestReview()
  } catch {
    // no prompt available / declined — nothing to do
  }
}
