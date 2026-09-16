// Verifies what a NATIVE project is actually holding, AFTER `cap sync`.
//
// WHY THIS IS A SEPARATE STEP. Every Exactly 67 sync/release chain is
//
//   build → check-ad-mode → check-no-google → cap sync → check-native-sync
//
// Before `cap sync`, `dist/` is the new bundle and the native project still
// holds the previous one, so comparing them compares before with after. In
// KVIZKO, where this gate was first built, that comparison lived in the
// pre-sync gate: on the App Store chain — `dist/` just became LIVE, iOS still
// held TEST — it failed and `&&` aborted the chain, leaving a LIVE bundle
// sitting in dist/ and no sync at all. The gate meant to protect the two-build
// release was the thing that blocked it.
//
// Run AFTER the sync instead, and the comparison is the one worth making: does
// the native project now carry exactly the bundle the gate just approved.
//
//   node scripts/check-native-sync.mjs ios live     # after ios:appstore
//   node scripts/check-native-sync.mjs ios off      # after ios:testflight / ios:sync
//   node scripts/check-native-sync.mjs ios mock     # after ios:sync:mock
//   node scripts/check-native-sync.mjs ios test     # after ios:sync:test
//
// Both arguments are required. A missing directory or a missing marker is a
// FAILURE here, never a skip: this script is only ever invoked for a platform
// that was just synced, so "nothing to look at" means the sync did not happen.
//
// The fastlane `archive` and `ad_gate` lanes run it once more for iOS, right
// before an archive: a chain that ended red here still leaves its bundle in
// App/public, and `AD_TARGET=live fastlane archive` would otherwise build it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GENERATED, scanGenerated } from './lib/google-surfaces.mjs'
import { readAppPackage } from './lib/levelplay-plugin.mjs'
import { CORE_VERSION, IOS_AD_QUALITY_VERSION, NETWORKS, requireAdapterVersion, wantedNetworks } from './lib/levelplay-versions.mjs'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const WEB_DIR = {
  ios: 'ios/App/App/public/assets',
  android: 'android/app/src/main/assets/public/assets',
}

// Same targets, and the same exact-count contract, as scripts/check-ad-mode.mjs
// — see that file for why each one exists. A number is "exactly this many"; an
// array is "any of these". UNLOCKALL:1 (VITE_UNLOCK_ALL, the TestFlight "all
// levels unlocked" flag) must be absent from a live build and appear at most
// once in any other.
//        ADMODE:test  ADMODE:live  ADS:on  ADS:off  ADS:mock  UNLOCKALL:1
const TARGETS = {
  live: { test: 0, live: 1, on: 1, off: 0, mock: 0, unlock: 0 },
  off: { test: 1, live: 0, on: 0, off: 1, mock: 0, unlock: [0, 1] },
  mock: { test: 1, live: 0, on: 0, off: 0, mock: 1, unlock: [0, 1] },
  test: { test: 1, live: 0, on: 1, off: 0, mock: 0, unlock: [0, 1] },
}
const accepts = (rule, n) => (Array.isArray(rule) ? rule.includes(n) : rule === n)
const DESCRIBE = {
  live: 'LIVE ads (App Store)',
  off: 'ADS OFF (TestFlight / dev)',
  mock: 'FAKE ads (mock provider)',
  test: 'TEST mode (real waterfall, dev only)',
}

const [platform, expected] = process.argv.slice(2)
if (!Object.hasOwn(WEB_DIR, platform ?? '') || !Object.hasOwn(TARGETS, expected ?? '')) {
  console.error('usage: node scripts/check-native-sync.mjs <ios|android> <live|off|mock|test>')
  process.exit(2)
}

const dir = join(APP_ROOT, WEB_DIR[platform])
const fail = (msg, hint) => {
  console.error(`\n✗ native-sync (${platform}): ${msg}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

if (!existsSync(dir)) {
  fail(`${WEB_DIR[platform]} does not exist`, `\`cap sync ${platform}\` did not run, or it failed. Nothing was verified.`)
}

const js = readdirSync(dir).filter((f) => f.endsWith('.js'))
if (!js.length) fail(`${WEB_DIR[platform]} holds no JavaScript`, 'The sync copied nothing — do not archive this project.')
const bundle = js.map((f) => readFileSync(join(dir, f), 'utf8')).join('')

// 1 ── a boot-mode build must never reach a native project. Exactly 67 has no
//      such entry today; the portfolio's ad-id capture screen and Test Suite
//      entry both carry ADMODE:test + ADS:on like the test build, so only their
//      own marker would tell them apart if one is ever ported here.
if (bundle.includes('ADIDCAPTURE:1')) {
  fail('holds an AD-ID CAPTURE build', 'That ships an advertising-id readout instead of the game. Rebuild without VITE_ADID_CAPTURE.')
}
if (bundle.includes('TESTSUITE:1')) {
  fail('holds a TEST SUITE build', 'That ships the Test Suite entry instead of the game. Rebuild without VITE_TESTSUITE.')
}

// 2 ── the mode, the ads switch and the unlock flag must be what was asked for.
//      Count the markers — "exactly once" is the contract, and a doubled one
//      means a stale chunk sits beside a fresh one.
const count = (literal) => bundle.split(literal).length - 1
const seen = {
  test: count('ADMODE:test'),
  live: count('ADMODE:live'),
  on: count('ADS:on'),
  off: count('ADS:off'),
  mock: count('ADS:mock'),
  unlock: count('UNLOCKALL:1'),
}
console.log(
  `native-sync (${platform}) — target ${expected.toUpperCase()}; markers seen: ` +
    `ADMODE:test ×${seen.test}  ADMODE:live ×${seen.live}  ADS:on ×${seen.on}  ADS:off ×${seen.off}  ADS:mock ×${seen.mock}  UNLOCKALL:1 ×${seen.unlock}`,
)
if (seen.test + seen.live !== 1) {
  fail(
    seen.test + seen.live === 0 ? 'carries no ADMODE marker' : 'carries more than one ADMODE marker',
    'The bundle predates the marker, the provider was changed, or a stale chunk is in it. It cannot be proven safe — do not ship it.',
  )
}
if (seen.on + seen.off + seen.mock !== 1) {
  fail(
    seen.on + seen.off + seen.mock === 0 ? 'carries no ADS marker (ADS:on / ADS:off / ADS:mock)' : 'carries more than one ADS marker',
    'The bundle predates VITE_ADS, or a stale chunk is in it. It cannot be proven — do not ship it.',
  )
}
if (seen.unlock > 1) {
  fail(`carries UNLOCKALL:1 ${seen.unlock} times`, 'A stale chunk or a second seam. It must appear at most once — re-run the whole chain.')
}
// `mock` is checked BEFORE `off`: a fake-ads bundle bakes ADMODE:test like an
// ordinary test build, so without its own branch it would read as `test`.
const actual = seen.live
  ? seen.off || seen.mock
    ? 'live-contradiction'
    : 'live'
  : seen.mock
    ? 'mock'
    : seen.off
      ? 'off'
      : 'test'
if (actual === 'live-contradiction') {
  fail(
    `carries ADMODE:live with ${seen.off ? 'ADS:off' : 'ADS:mock'}`,
    'A store build that never loads a real ad is a contradiction, not a mode. Rebuild without VITE_ADS.',
  )
}
if (actual !== expected) {
  fail(
    `carries ${DESCRIBE[actual]} but ${DESCRIBE[expected]} was requested`,
    actual === 'test' && expected === 'off'
      ? 'This bundle loads the LIVE waterfall. The TestFlight build must be ads-off — rebuild with VITE_ADS=off (npm run ios:testflight).'
      : actual === 'off' && expected === 'test'
        ? 'An ads-off bundle never passes as the test build. If you meant it, the target is `off`.'
        : 'The sync copied a different build than the one the gate approved. Re-run the whole chain.',
  )
}
if (!Object.entries(TARGETS[expected]).every(([k, rule]) => accepts(rule, seen[k]))) {
  // Mode and ads agree, so the only rule left to break is the unlock flag.
  fail(
    'carries UNLOCKALL:1 in a LIVE build',
    'Every level would be unlocked for every App Store player. That flag is TestFlight-only — rebuild without VITE_UNLOCK_ALL (npm run ios:appstore).',
  )
}

// 3 ── the files `cap sync` just generated must be clean of Google — the
//      synced web copy included (scripts/lib/google-surfaces.mjs lists them).
//      The pre-sync gate only NOTES these (they still held the previous build
//      then); now they are this sync's output, so a hit is real. Package.resolved
//      is the exception to "this sync's output" — Xcode writes it, not
//      Capacitor — so its hint says how to regenerate it before re-running.
for (const entry of GENERATED[platform]) {
  const hits = scanGenerated(APP_ROOT, entry)
  if (hits.length) {
    fail(
      `${hits[0].where} ${hits[0].detail}${hits.length > 1 ? ` (+${hits.length - 1} more file(s))` : ''}`,
      `Regenerate it with \`${entry.by}\`, then re-run the whole chain. Nothing that links AdMob may be archived.`,
    )
  }
}

// 4 ── the iOS binary must actually LINK the ad SDK, at the versions that were
//      tested. The LevelPlay plugin compiles, links and ships as a silent no-op
//      when its SDK is missing (see scripts/patch-levelplay-spm.mjs), so "the
//      bundle says ADS:on" proves nothing about the binary. Two links in that
//      chain are checkable here: CapApp-SPM must depend on the plugin, and the
//      committed resolved graph must pin the LevelPlay core, every enabled
//      network's adapter and that network's SDK at EXACTLY the numbers in
//      scripts/lib/levelplay-versions.mjs. Presence alone is not enough: the
//      patched manifest says `from:`, so "Update to Latest Package Versions" or
//      a deleted Package.resolved moves build N onto a graph nobody has run,
//      with the package names all still there.
//
//      Every target, not only the ADS:on ones: the SDK is linked into the
//      ads-off TestFlight binary and the mock build too (VITE_ADS only decides
//      whether the JS starts it), and a graph that drifted in build N+1 is still
//      in the tree when the next build N is archived.
const IOS_SDK_PACKAGE = { unityads: 'unity-ads-swift-package' }
if (platform === 'ios') {
  const capSpm = join(APP_ROOT, 'ios/App/CapApp-SPM/Package.swift')
  const capSrc = existsSync(capSpm) ? readFileSync(capSpm, 'utf8') : ''
  if (!capSrc.includes('.product(name: "CapacitorLevelplayAds"')) {
    fail(
      'ios/App/CapApp-SPM/Package.swift does not link CapacitorLevelplayAds',
      'The plugin is not installed or `cap sync ios` did not pick it up — the binary would carry no ad layer. Run `npm install`, then the chain again.',
    )
  }
  const RESOLVED = 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'
  const resolveHint =
    'Restore the committed file (`git checkout ' + RESOLVED + '`) — never "Update to Latest Package Versions".\n' +
    '  A deliberate bump starts in scripts/lib/levelplay-versions.mjs, then `npm install`,\n' +
    '  `xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App`, commit Package.resolved, re-run the chain.'
  const resolvedPath = join(APP_ROOT, RESOLVED)
  if (!existsSync(resolvedPath)) {
    fail(`${RESOLVED} does not exist`, `The archive would link whatever resolves on the day — or nothing. ${resolveHint}`)
  }
  let pins
  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'))
    if (!Array.isArray(parsed.pins)) throw new Error('no top-level "pins" array (Package.resolved v2/v3 expected)')
    pins = Object.fromEntries(parsed.pins.map((p) => [String(p.identity ?? '').toLowerCase(), p.state?.version ?? null]))
  } catch (e) {
    fail(`${RESOLVED} cannot be read: ${e.message}`, resolveHint)
  }
  const expectedPins = { 'levelplay-swift-package': CORE_VERSION, 'unity-ad-quality-swift-package': IOS_AD_QUALITY_VERSION }
  for (const n of wantedNetworks(readAppPackage())) {
    expectedPins[`levelplay-${n}-adapter-swift-package`] = requireAdapterVersion(n, 'ios')
    const sdkPackage = IOS_SDK_PACKAGE[n]
    const sdk = NETWORKS[n]?.iosSdk ?? NETWORKS[n]?.sdk
    if (!sdkPackage || !sdk) {
      fail(
        `no iOS SDK pin is known for the enabled network "${n}"`,
        'Add its SPM package identity to IOS_SDK_PACKAGE here and its verified SDK version to scripts/lib/levelplay-versions.mjs.',
      )
    }
    expectedPins[sdkPackage] = sdk
  }
  const wrong = Object.entries(expectedPins).filter(([id, v]) => pins[id] !== v)
  if (wrong.length) {
    fail(
      `Package.resolved is not the tested SDK graph: ${wrong
        .map(([id, v]) => `${id} ${pins[id] === undefined ? 'is not pinned' : `is ${pins[id] ?? 'not a version pin'}`} (want ${v})`)
        .join('; ')}`,
      resolveHint,
    )
  }
}

// 5 ── and it must be the bundle that was just built, not an older one with the
//      same mode. Same mode is not the same build: a stale sync of a same-mode
//      bundle is invisible to the check above. Vite fingerprints every chunk,
//      so a dist/ file name the native copy lacks means a different build.
const distDir = join(APP_ROOT, 'dist/assets')
if (existsSync(distDir)) {
  const distJs = readdirSync(distDir).filter((f) => f.endsWith('.js'))
  const missing = distJs.filter((f) => !js.includes(f))
  if (missing.length) {
    fail(
      `dist/ has ${missing.length} file(s) the native project does not: ${missing.slice(0, 3).join(', ')}`,
      `\`cap sync ${platform}\` ran against a different build. Re-run it.`,
    )
  }
  const extra = js.filter((f) => !distJs.includes(f))
  if (extra.length) {
    fail(
      `the native project has ${extra.length} file(s) dist/ does not: ${extra.slice(0, 3).join(', ')}`,
      'A stale chunk from an earlier build sits beside the fresh one. Re-run the sync.',
    )
  }
} else {
  fail('dist/assets does not exist', 'Nothing to compare the native copy with — the build did not run. Re-run the whole chain.')
}

console.log(
  `✓ native-sync (${platform}): ${DESCRIBE[expected]}${seen.unlock ? ', all levels unlocked' : ''}, matches dist/, ` +
    `no Google surface in the synced project${platform === 'ios' ? ', LevelPlay SDK linked + pinned to the tested versions' : ''}, no boot-mode build`,
)
