/**
 * What counts as a new play session — the usual analytics definition: a cold
 * launch, OR a return from the background after SESSION_GAP_MS or more, OR a
 * return into a new calendar day.
 *
 * Cold launches alone are the wrong count on iOS. The OS keeps a suspended app
 * alive for days, so a daily player who never swipes the game away would stay in
 * one endless "session": the interstitial session cap would never reset (three
 * ads, then none for days) and the per-session warm-up would never re-apply.
 * The caller (main.ts) keeps counting cold launches too — this only decides
 * whether a return from the background also starts one.
 */

/** A return from the background after this long starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000

/** When the app went to the background: the first `hidden` since the last return. */
export interface Pause {
  at: number
  /** Local day key (days.ts) at that moment. */
  day: string
}

/**
 * Whether coming back to the foreground at `now` (on local day `today`) starts a
 * new session.
 *
 *  - No pause recorded (a `visible` with no `hidden` before it) → not a return.
 *  - A different day key → always a new session, however short the pause.
 *  - A clock set back within the same day → not a new session.
 *  - Otherwise, a pause of SESSION_GAP_MS or more → a new session.
 */
export function returnIsNewSession(pause: Pause | null, now: number, today: string): boolean {
  if (!pause) return false
  if (pause.day !== today) return true
  if (now < pause.at) return false
  return now - pause.at >= SESSION_GAP_MS
}
