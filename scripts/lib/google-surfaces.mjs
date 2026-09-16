// The Google ad surfaces that live in files `cap sync` (or Xcode's package
// resolve) GENERATES — shared by the two gates that have to look at them at
// different moments.
//
// WHY THEY ARE SPLIT OUT. Every Exactly 67 chain runs
//
//   build → check-ad-mode → check-no-google → cap sync → check-native-sync
//
// Before `cap sync`, these files still describe the PREVIOUS build. During the
// AdMob → LevelPlay migration that previous build is an AdMob one: the synced
// web copy carries `ca-app-pub-…` ids, CapApp-SPM links the AdMob plugin, and
// capacitor.config.json registers AdMobPlugin. A pre-sync gate that FAILS on
// them can never pass, because the only thing that replaces them is the sync it
// is blocking — the chain deadlocks and the tempting way out is a hand-run
// `cap sync` with no gate at all. So:
//
//   - check-no-google.mjs (pre-sync) reports a hit here as a NOTE: stale, the
//     next sync regenerates it;
//   - check-native-sync.mjs (post-sync) FAILS on the same hit for the platform
//     it just synced, because by then the file must be clean.
//
// The source-of-truth inputs that decide what the sync generates — package.json
// dependencies, Info.plist, AndroidManifest.xml, capacitor.config.ts — are
// never in this list; check-no-google fails on those before anything is synced.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The terminated AdMob publisher (closed 2026-08-18, appeal refused 2026-08-19). */
export const DEAD_PUB = 'pub-3307486877162157'
/** Any AdMob app or unit id: ca-app-pub-<16 digits>~<id> or /<id>. */
export const ADMOB_ID_RE = /ca-app-pub-\d{10,}[~/]\d+/

const bundleHit = (src) =>
  src.includes('ca-app-pub-') || src.includes(DEAD_PUB) ? 'carries an AdMob app/unit id or the terminated publisher id' : null

/**
 * Per platform: generated path (relative to the app root), what regenerates it,
 * and a detector returning a description of the Google surface or null.
 * A `dir` entry is scanned file by file (`ext` filter).
 */
export const GENERATED = {
  ios: [
    {
      path: 'ios/App/App/public',
      dir: true,
      ext: /\.(js|mjs|cjs|html|json)$/,
      by: 'cap sync ios',
      detect: bundleHit,
    },
    {
      path: 'ios/App/App/capacitor.config.json',
      by: 'cap sync ios',
      detect: (src) => (/admob/i.test(src) ? 'registers an AdMob Capacitor plugin class' : null),
    },
    {
      path: 'ios/App/CapApp-SPM/Package.swift',
      by: 'cap sync ios',
      detect: (src) =>
        /admob|GoogleMobileAds/i.test(src) ? 'links an AdMob Capacitor plugin — the Google Mobile Ads SDK ends up in the binary' : null,
    },
    {
      // Not written by `cap sync`: Xcode (or `xcodebuild -resolvePackageDependencies`)
      // rewrites it from CapApp-SPM's graph. It is committed, so a stale pin
      // outlives the sync that removed the dependency.
      path: 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
      by: 'xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App (after cap sync ios)',
      detect: (src) =>
        /google-mobile-ads|google-user-messaging-platform|googleads/i.test(src)
          ? 'still pins Google Mobile Ads / UMP in the resolved SPM graph'
          : null,
    },
  ],
  android: [
    {
      path: 'android/app/src/main/assets/public',
      dir: true,
      ext: /\.(js|mjs|cjs|html|json)$/,
      by: 'cap sync android',
      detect: bundleHit,
    },
    {
      path: 'android/app/src/main/assets/capacitor.plugins.json',
      by: 'cap sync android',
      detect: (src) => (/admob/i.test(src) ? 'registers an AdMob Capacitor plugin' : null),
    },
    {
      path: 'android/app/src/main/assets/capacitor.config.json',
      by: 'cap sync android',
      detect: (src) => (/admob/i.test(src) ? 'carries AdMob plugin configuration' : null),
    },
    {
      path: 'android/capacitor.settings.gradle',
      by: 'cap sync android',
      detect: (src) => (/capacitor-community-admob|admob/i.test(src) ? 'includes the AdMob Capacitor plugin project' : null),
    },
    {
      path: 'android/app/capacitor.build.gradle',
      by: 'cap sync android',
      detect: (src) =>
        /capacitor-community-admob|play-services-ads(?!-identifier)|admob-adapter/i.test(src)
          ? 'puts the AdMob plugin / play-services-ads on the classpath'
          : null,
    },
  ],
}

/** Every generated path, for walkers that must not treat them as source. */
export const GENERATED_PATHS = Object.values(GENERATED)
  .flat()
  .map((g) => g.path)

/**
 * Runs one GENERATED entry's detector against what is on disk.
 * Returns [{ where, detail }] — empty when the path is clean or absent.
 * Absence is not a hit: whether a sync happened is check-native-sync's
 * question, asked separately.
 */
export function scanGenerated(root, entry) {
  const abs = join(root, entry.path)
  if (!existsSync(abs)) return []
  const files = entry.dir ? listFiles(abs).filter((f) => entry.ext.test(f)) : [abs]
  const hits = []
  for (const f of files) {
    const detail = entry.detect(readFileSync(f, 'utf8'))
    if (detail) hits.push({ where: relative(root, f), detail })
  }
  return hits
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) listFiles(p, out)
    else out.push(p)
  }
  return out
}
