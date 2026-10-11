import type { ConsentTrigger } from '../game/adConsent'

/**
 * The words of the ad-consent question — one source for LevelPlay's native
 * alert (providers/levelplay) and the fake-ads build's fake window
 * (providers/mock), so the question walked on a phone in the mock build is the
 * one the App Store build asks. A module of its own because the mock must not
 * import the LevelPlay provider: a mock bundle carrying it would carry a
 * second ADMODE marker, which every release gate refuses.
 *
 * Option A (owner, 2026-10-11 — hq/projects/games/ads-consent-option-a.md;
 * GDPR Art. 4(11) and 7, EDPB 05/2020 §64–65): it says who shows the ads, who
 * receives what, why, what a no means and where the answer is changed — and
 * nothing else. No "the game plays the same either way", no "support us", no
 * "Allow" (the word of Apple's own ATT prompt; Apple HIG, guideline
 * 5.1.1(iv)). A no keeps a way to the same rewards without ads: hints come
 * from playing — the daily gift, the Star Jar, packs and streaks — and hints
 * buy the streak freezes and repairs a video would (GDPR Recital 42).
 *
 * Two answers of equal weight: the native alert draws them alike once
 * PATCHED-EQUAL-BUTTONS is applied (scripts/patch-levelplay-consent.mjs), and
 * the mock draws them alike as well. English only, like the whole UI
 * (Info.plist CFBundleDevelopmentRegion `en`, en-US store metadata), so the
 * policy link speaks the game's language through `privacyButton`, handed to
 * the plugin as `privacyButtonText`.
 */
export const CONSENT_COPY = {
  title: 'Ads and your data',
  message:
    'Exactly 67 (Noqyris) shows ads through Unity LevelPlay. If you accept, Unity Technologies ' +
    '(Unity Ads and ironSource Exchange) receives device and app data, which ads you see and tap, and, ' +
    'only if you also agree to tracking, your advertising identifier, to show you ads and tailor them to you. ' +
    "If you don't accept, no ads are shown, so there are no rewards for watching them; hints still come " +
    'from playing. You can change this any time in Settings → Privacy & ads.',
  /** Put in front of `message` when the question opens because the player tapped an ad offer. */
  adTapLead: 'This reward comes with an ad.',
  accept: 'Accept',
  decline: "Don't accept",
  privacyButton: 'Privacy policy',
  /** The Settings row (and the menu's corner link) that re-opens the question. */
  settingsRow: 'Privacy & ads',
} as const

/** Where the question's policy button goes — the page the store listing names. */
export const PRIVACY_POLICY_URL = 'https://noqyris.github.io/exactly-67/privacy.html'

/** The question's text for what opened it: a tapped offer gets one sentence of context first (option A rule 5). */
export function consentMessage(trigger: ConsentTrigger): string {
  return trigger === 'adTap' ? `${CONSENT_COPY.adTapLead} ${CONSENT_COPY.message}` : CONSENT_COPY.message
}
