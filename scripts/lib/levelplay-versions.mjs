// THE single place LevelPlay versions are pinned for Exactly 67 — the npm
// plugin, the iOS SDK and the Android SDK.
//
// WHY THIS FILE EXISTS. iOS and Android take their SDK versions from completely
// different sources: iOS from a Swift Package manifest we rewrite
// (patch-levelplay-spm.mjs), Android from two files inside the plugin's
// node_modules (patch-levelplay-android-sdk.mjs). Nothing connected them, so in
// the sibling app KVIZKO — where this setup was first shipped — they drifted:
// on 2026-08-26 iOS was resolving LevelPlay 9.6.0 / UnityAds adapter 5.10.0
// while Android was building against 9.4.0 / 5.8.0.
//
// That drift is not academic. Mediation behaviour, event ordering and bidding
// support change between minor versions, so a bug that reproduces on one
// platform and not the other costs a day before anyone suspects the SDK. Both
// patch scripts read the numbers below; bumping a version here moves both
// platforms — or, when the two platforms are deliberately held apart, the split
// is written down here (`iosAdapter`) instead of happening by accident.
//
// The pins are KVIZKO's, unchanged: that combination is what serves ads in a
// shipped App Store build (KVIZKO 1.2.1, 2026-09-16). Exactly 67 starts from a
// known-good SDK rather than from whatever is newest on the day of the port.
//
// WHAT HOLDS iOS TO THESE NUMBERS. Not the manifest: patch-levelplay-spm.mjs
// writes `from: "<version>"`, an open range, so any resolve may pick a newer
// 9.x core or 5.x adapter. The committed Package.resolved is the real pin, and
// two gates keep it honest: scripts/check-native-sync.mjs requires every iOS
// sync (live, off, mock and test alike, since every binary links the SDK) to
// resolve EXACTLY the versions below, and the fastlane archive passes
// `disable_package_automatic_updates`, so xcodebuild fails rather than
// re-resolve to something else on the day of a release.
//
// HOW TO BUMP. Check what actually exists first — Android artefacts are on Maven
// Central and iOS packages are GitHub tags under github.com/ironsource-mobile:
//
//   curl -s https://repo1.maven.org/maven2/com/unity3d/ads-mediation/mediation-sdk/maven-metadata.xml
//
// Then change it here, run `npm install` to re-apply the patches, re-resolve
// (`xcodebuild -resolvePackageDependencies`) and confirm Package.resolved landed
// on exactly the new numbers (check-native-sync refuses anything else), and
// build BOTH platforms before trusting it. An ad SDK that compiles is not an ad
// SDK that fills.

/**
 * The capacitor-levelplay-ads npm version every patch was written against.
 *
 * package.json pins the dependency to exactly this string (no caret), and each
 * patch refuses to run against any other installed version. The patches rewrite
 * or search-and-replace the plugin's own files — its Package.swift, its consent
 * code, its Gradle file and network registry — so a silent minor bump could move
 * any of them and leave a patch half-applied with nothing saying so. Bumping the
 * plugin is therefore a deliberate act: read the new tarball, re-verify the
 * three patches against it, then change this constant AND package.json together.
 */
export const PLUGIN_VERSION = '0.1.42'

/** LevelPlay mediation core. iOS: SPM package. Android: com.unity3d.ads-mediation:mediation-sdk */
export const CORE_VERSION = '9.6.0'

/**
 * Unity Ad Quality, iOS only: LevelPlay 9.6.0 pulls it in transitively with the
 * open range 9.0.0..<10.0.0, so nothing but Package.resolved decides which one
 * links. 9.9.0 is what KVIZKO's shipped graph resolved, and the newest tag on
 * 2026-09-16. check-native-sync holds Package.resolved to it with the others.
 */
export const IOS_AD_QUALITY_VERSION = '9.9.0'

/**
 * Per-network adapter versions, keyed by the same network names package.json
 * `levelplay.networks` uses.
 *
 * `adapter` is the LevelPlay adapter; `sdk` is the network's own SDK, which
 * Android declares separately and iOS pulls in transitively: the iOS adapter's
 * own manifest pins the SDK `exact:`, and check-native-sync requires
 * Package.resolved to carry `iosSdk ?? sdk`. Record `iosSdk` only when the iOS
 * adapter pins a different SDK than Android declares.
 *
 * `iosAdapter`, when present, is the iOS pin and `adapter` is then Android's
 * only. For Unity Ads the platforms are deliberately apart: Android takes
 * Maven's 5.12.0, while iOS is HELD at 5.11.0, the adapter in KVIZKO's shipped
 * graph. An SPM 5.12.0 tag exists as of 2026-09-16, but its manifest pins Unity
 * Ads `exact: "4.20.1"` (5.11.0 pins 4.20.0), so moving iOS to it moves the
 * Unity Ads SDK too, and that is a new graph nobody has run. Without
 * `iosAdapter` both platforms read `adapter`.
 *
 * ONLY VERIFIED NUMBERS BELONG HERE, and `null` is the honest value for the
 * rest. An earlier iOS registry carried `5.0.0` for Vungle; Maven's oldest
 * published vungle-adapter is 5.11.0, so that pin had never been resolved by
 * anyone and would have failed the first time somebody enabled the network.
 * Guessing a plausible version is worse than admitting there isn't one, because
 * the guess only surfaces months later as an unresolvable dependency.
 *
 * To add a network: find the Android version on Maven Central AND the iOS tag
 * under github.com/ironsource-mobile, confirm they exist, then fill both in.
 * Never add `admob` — see scripts/check-no-google.mjs.
 */
export const NETWORKS = {
  // Android verified 2026-09-10: Maven lists 5.10.0, 5.11.0, 5.12.0 (latest,
  // 2026-08-17); the adapter CHANGELOG for 5.12.0 reads "Requires Unity Ads SDK
  // 4.20.0 or above. This adapter will not show ads on earlier SDK versions."
  // and unity-ads 4.20.0 is Maven's latest. iOS: adapter 5.11.0, whose manifest
  // pins Unity-Ads-Swift-Package exact 4.20.0, so `sdk` is right for both
  // platforms. There was no SPM 5.12.0 tag when this was pinned; there is one
  // now (see `iosAdapter` above for why iOS stays put).
  unityads: { adapter: '5.12.0', sdk: '4.20.0', iosAdapter: '5.11.0' },
  // Maven has 5.7.0–5.9.0. The matching SPM tag has NOT been checked, so the
  // guard below stops a build rather than pinning a number nobody confirmed.
  applovin: { adapter: null, sdk: null },
  vungle: { adapter: null, sdk: null },
}

/**
 * Networks configured in package.json, minus the one Exactly 67 may never use
 * again. The AdMob publisher behind this app was terminated on 2026-08-18; an
 * AdMob adapter earns nothing and re-creates a Google policy record.
 * check-no-google.mjs refuses the name outright — this filter only makes sure a
 * patch never links it while that gate is being ignored.
 */
export function wantedNetworks(appPkg) {
  return (appPkg.levelplay?.networks ?? []).map((n) => String(n).toLowerCase()).filter((n) => n !== 'admob')
}

/**
 * Version for a network we are actually building, or a loud stop.
 *
 * Enabling a network is a deliberate act; discovering months later that its
 * adapter version was invented is not. This turns that into a message at the
 * moment the network is switched on.
 *
 * `platform` defaults to 'ios' because patch-levelplay-spm.mjs is the caller
 * that needs the split pin; the Android patch reads `NETWORKS[n].adapter`
 * directly. Pass 'android' explicitly to get that pin.
 */
export function requireAdapterVersion(network, platform = 'ios') {
  const entry = NETWORKS[network]
  const v = platform === 'ios' ? (entry?.iosAdapter ?? entry?.adapter) : entry?.adapter
  if (v) return v
  console.error(`[levelplay-versions] "${network}" is enabled but has no verified adapter version.`)
  console.error('  Look up the Android artefact on Maven Central:')
  console.error(`    https://repo1.maven.org/maven2/com/unity3d/ads-mediation/${network}-adapter/maven-metadata.xml`)
  console.error('  and the matching iOS tag under github.com/ironsource-mobile, confirm BOTH exist,')
  console.error('  then fill them into scripts/lib/levelplay-versions.mjs. Do not guess a number.')
  process.exit(1)
}
