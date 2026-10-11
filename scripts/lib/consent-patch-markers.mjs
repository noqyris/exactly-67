// The consent patches every release gate requires in the installed plugin —
// scripts/patch-levelplay-consent.mjs writes them at every `npm install`.
//
// A gate cannot trust that postinstall ran: a targeted `npm install <pkg>` skips
// it, and an unpatched plugin compiles, links and ships. Unpatched, a Decline
// reads back as consent from the second launch (CONSENT-ORDER), a Google-era
// IAB TCF record counts as an answer (CUSTOM-STATUS), the first answer of a
// process sticks in the SDK (GDPR-FRESH), Decline is drawn apart from Accept and
// the policy link stays English (EQUAL-BUTTONS), and every answer tells each SDK
// that GDPR does not apply (NO-TCF-STUB). So the gates count the markers in the
// very files the iOS build compiles (CapApp-SPM points at node_modules) and
// Gradle reads.
//
// Written down here, apart from the patch script's PATCHES table, on purpose:
// deleting a patch there must not quietly delete its gate. The counts are what
// the patched files carry — each patched body names its marker exactly once —
// and scripts/consentGates.test.ts proves this table, the patch script and the
// Xcode guard (ios/App/ad-mode-guard.sh, which has its own copy of the iOS rows)
// agree.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LP_IOS = 'ios/Sources/LevelPlayAdsPlugin'
const LP_ANDROID = 'android/src/main/java/com/capacitor/plugins/levelplay/consent'

/** [file relative to the plugin, marker, how many times the patched file carries it] */
export const CONSENT_PATCH_MARKERS = {
  ios: [
    [`${LP_IOS}/TcfPrefs.swift`, 'PATCHED-CONSENT-ORDER', 1],
    [`${LP_IOS}/LevelPlayAdsImpl.swift`, 'PATCHED-CUSTOM-STATUS', 1],
    [`${LP_IOS}/LevelPlayAdsImpl.swift`, 'PATCHED-GDPR-FRESH', 1],
    [`${LP_IOS}/LevelPlayAdsImpl.swift`, 'PATCHED-EQUAL-BUTTONS', 1],
    [`${LP_IOS}/LevelPlayAdsImpl.swift`, 'PATCHED-NO-TCF-STUB', 2],
  ],
  android: [
    [`${LP_ANDROID}/TcfPrefs.java`, 'PATCHED-CONSENT-ORDER', 1],
    [`${LP_ANDROID}/CustomModalConsentProvider.java`, 'PATCHED-CUSTOM-STATUS', 1],
    [`${LP_ANDROID}/CustomModalConsentProvider.java`, 'PATCHED-EQUAL-BUTTONS', 1],
    [`${LP_ANDROID}/CustomModalConsentProvider.java`, 'PATCHED-NO-TCF-STUB', 2],
  ],
}

/**
 * Every way the installed plugin at `pluginDir` falls short of the table for
 * `platform` — a missing file, or a marker seen a different number of times.
 * Empty when it is fully patched.
 */
export function consentPatchProblems(pluginDir, platform) {
  const rows = CONSENT_PATCH_MARKERS[platform]
  if (!rows) throw new Error(`no consent-patch table for platform "${platform}"`)
  const problems = []
  for (const [file, marker, want] of rows) {
    const path = join(pluginDir, file)
    if (!existsSync(path)) {
      problems.push(`${file} is missing`)
      continue
    }
    const n = readFileSync(path, 'utf8').split(marker).length - 1
    if (n !== want) problems.push(`${file} carries ${marker} ×${n}, expected ×${want}`)
  }
  return problems
}
