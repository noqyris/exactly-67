/**
 * Sharing the result card.
 *
 * Deliberately dependency-free. `@capacitor/share` would give a nicer native
 * sheet, but adding it means a `cap sync` and a native rebuild, and the two
 * routes below already cover both platforms:
 *
 * - `navigator.share` — the real OS share sheet. Available in WKWebView on
 *   modern iOS, which is what Capacitor runs, and on mobile browsers.
 * - the clipboard — everywhere else, including desktop.
 *
 * Same fire-and-forget, never-throw shape as `haptics.ts`: a failed share must
 * never break the win overlay, and a user dismissing the sheet is not an error.
 */

export type ShareOutcome = 'shared' | 'copied' | 'unavailable'

/** `Navigator.share` is optional in the DOM lib, so widen rather than redeclare. */
type MaybeSharing = Navigator & { share?: (data: ShareData) => Promise<void> }

export function shareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as MaybeSharing).share === 'function'
}

export async function shareText(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as MaybeSharing)

  if (nav?.share) {
    try {
      await nav.share({ text })
      return 'shared'
    } catch {
      // Dismissing the sheet rejects. Fall through to the clipboard rather than
      // treating a deliberate cancel as a failure worth reporting.
    }
  }

  try {
    await nav?.clipboard?.writeText(text)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}
