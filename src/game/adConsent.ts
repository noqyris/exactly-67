/**
 * When Exactly 67 may ask for ad consent — the owner's option A (2026-10-11,
 * hq/projects/games/ads-consent-option-a.md), as pure rules. Ported from
 * KVIZKO's game/adConsent.ts; "a finished game" is a finished level here.
 *
 *  - Never on a cold launch before any play. The first question comes after
 *    the first finished level, in place of that level's break (the moment an
 *    interstitial would go, on the way out of the win card). A player who
 *    leaves without answering gets the same question after a later level.
 *  - A player who said no is asked again only when they tap an ad offer
 *    themselves, and at most once in `CONSENT.reaskAfterDays` after that no
 *    (the ICO and CNIL guidance on not re-asking a refusal). Until then the
 *    offers are simply not drawn, so no button leads nowhere; Settings →
 *    "Privacy & ads" re-opens the question at any time.
 *  - No ads and Unlimited owners see no break ads, so nothing asks them after
 *    a level; the rewarded offers a No ads owner keeps ask on tap.
 *
 * The service layer (services/ads) owns the SDK and the clock and hands the
 * state in; this module owns only the rules.
 */

/** The plugin's three answers: no answer yet, yes, no. */
export type ConsentState = 'UNKNOWN' | 'GRANTED' | 'DENIED'

/** What opened the consent question. */
export type ConsentTrigger = 'afterLevel' | 'adTap' | 'settings'

export const CONSENT = {
  /** A tapped offer re-asks a refusal at most once per this many days. */
  reaskAfterDays: 180,
} as const

const DAY_MS = 86_400_000

export interface AfterLevelInput {
  state: ConsentState
  /** Owns No ads or Unlimited hints: no unsolicited question. */
  adsRemoved: boolean
  /** Already asked after a level in this session — one try per session. */
  askedThisSession: boolean
  /**
   * The win card already put something else in front of the player — a
   * reminder offer, the rating prompt, the no-ads nudge or a reward video —
   * on the promise that nothing follows it. The question waits for a plain
   * break, like the interstitial it stands in for.
   */
  cardAsked: boolean
}

/** Whether leaving a finished level's win card should open the consent question. */
export function consentDueAfterLevel(input: AfterLevelInput): boolean {
  if (input.state !== 'UNKNOWN') return false
  return !input.adsRemoved && !input.askedThisSession && !input.cardAsked
}

export interface TapInput {
  state: ConsentState
  /** Epoch ms the question was last shown; 0 = never recorded (any build before option A). */
  lastAskedAt: number
  nowMs: number
}

/**
 * Whether a tap on an ad offer may open the consent question. A player who
 * never answered may always be asked; a refusal only once the quiet period
 * has passed. A clock that went backwards counts as "not yet".
 */
export function consentAskOnTap(input: TapInput): boolean {
  if (input.state === 'GRANTED') return false
  if (input.state === 'UNKNOWN') return true
  if (input.lastAskedAt <= 0) return true
  return input.nowMs - input.lastAskedAt >= CONSENT.reaskAfterDays * DAY_MS
}

/**
 * Whether ad offers may be drawn at all: with consent, or when a tap would
 * lead to the question. Never a button that does nothing.
 */
export function adOffersVisible(input: TapInput): boolean {
  return input.state === 'GRANTED' || consentAskOnTap(input)
}
