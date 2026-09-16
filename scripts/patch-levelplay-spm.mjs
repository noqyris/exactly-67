// Gives capacitor-levelplay-ads a working Swift Package Manager integration.
//
// WHY THIS EXISTS — and why skipping it is worse than a build error:
// The published plugin is CocoaPods-first. Its own Package.swift says so, and
// says what happens without Pods: "all SDK code is guarded by
// `#if canImport(IronSource)` and degrades to no-ops."
//
// Exactly 67 has no Podfile — iOS is wired through Capacitor's SPM integration
// (ios/App/CapApp-SPM). So out of the box the plugin COMPILES, links, ships,
// and silently serves nothing. No crash, no warning, no ad, no revenue. That
// failure is invisible until somebody reads a monthly report, which is exactly
// the shape of bug this app cannot afford after losing its AdMob account.
//
// The plugin's own SPM instructions point at
// `Unity-Technologies/Unity-Mediation-iAds-Swift-Package`, which returns 404 —
// it is stale. The packages Unity actually publishes today live under
// `ironsource-mobile` and require LevelPlay SDK 9.3.0+ for SPM support.
//
// SECOND UPSTREAM DEFECT, same file: the plugin names its library product
// `CapacitorLevelPlayAds` (capital P), but `cap sync` generates
// `.product(name: "CapacitorLevelplayAds", …)` from the npm package name
// `capacitor-levelplay-ads` (lower-case p). The names never match, so an iOS
// build fails outright with
//   product 'CapacitorLevelplayAds' … not found in package 'CapacitorLevelplayAds'
// This is in the published tarball before any patching — the plugin's iOS SPM
// path had never been built by anyone, consistent with its README calling SPM
// "secondary". We emit the name Capacitor expects.
//
// The upstream manifest also declares a test target at ios/Tests/…, a directory
// the npm tarball does not ship; SPM refuses a target whose path is missing, so
// the patched manifest leaves it out.
//
// Ported unchanged in substance from KVIZKO, where this manifest links the SDK
// in a shipped App Store build.
//
// Fails loudly (exit 1) rather than guessing when the plugin's layout is not the
// one this was written for. Idempotent: safe to run any number of times. Wired
// via package.json "postinstall".
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_VERSION, wantedNetworks, requireAdapterVersion } from './lib/levelplay-versions.mjs'
import { locatePlugin, readAppPackage } from './lib/levelplay-plugin.mjs'

const TAG = 'patch-levelplay-spm'
const PATCH_MARK = 'PATCHED by scripts/patch-levelplay-spm.mjs'

const stop = (...lines) => {
  console.error(`[${TAG}] ${lines[0]}`)
  for (const l of lines.slice(1)) console.error(`  ${l}`)
  process.exit(1)
}

const pkgDir = locatePlugin(TAG)
if (!pkgDir) process.exit(0)

const manifest = join(pkgDir, 'Package.swift')
if (!existsSync(manifest)) {
  stop('plugin found but Package.swift is missing — layout changed.', 'Do not ship: verify by hand whether the SDK is linked at all.')
}

// The target path the patched manifest points at. If the Swift sources moved,
// writing a manifest that names the old path would fail the iOS build with a
// confusing SPM error — or, worse, compile an empty target.
const SOURCES = 'ios/Sources/LevelPlayAdsPlugin'
const sourcesDir = join(pkgDir, SOURCES)
if (!existsSync(sourcesDir) || !readdirSync(sourcesDir).some((f) => f.endsWith('.swift'))) {
  stop(
    `${SOURCES} is missing or holds no Swift — the plugin layout changed.`,
    'The patched manifest would point at nothing. Read the new tarball before shipping.',
  )
}
// The whole reason the SDK must be linked: the plugin compiles its ad code only
// when the `IronSource` module is importable. If that guard changed, linking
// UnityMediationSDK may no longer switch the ad code on.
const impl = join(sourcesDir, 'LevelPlayAdsImpl.swift')
if (!existsSync(impl) || !readFileSync(impl, 'utf8').includes('#if canImport(IronSource)')) {
  stop(
    'LevelPlayAdsImpl.swift no longer guards its SDK code with `#if canImport(IronSource)`.',
    'This patch links the SDK so that guard turns the ad code on; with a different guard it may stay a no-op.',
    'Read the plugin source before shipping.',
  )
}

const current = readFileSync(manifest, 'utf8')
// Only two manifests may be overwritten: the known upstream one, and one this
// script wrote before. Anything else is a layout nobody verified.
const isUpstream =
  current.includes('name: "CapacitorLevelPlayAds"') &&
  current.includes('name: "LevelPlayAdsPlugin"') &&
  current.includes(`path: "${SOURCES}"`) &&
  !current.includes('LevelPlay-Swift-Package')
const isOurs = current.includes(PATCH_MARK)
if (!isUpstream && !isOurs) {
  stop(
    'Package.swift is neither the known upstream manifest nor one this script wrote.',
    'Upstream changed its SPM integration. Read it before overwriting — it may already link the SDK,',
    'or link it under a different product name.',
  )
}

// Adapters must match the `levelplay.networks` list in package.json: an adapter
// linked here but not configured in the LevelPlay dashboard is dead weight, and
// one configured there but missing here simply never bids.
// Versions live in scripts/lib/levelplay-versions.mjs, which the Android patch
// reads too, so the two platforms cannot drift apart unnoticed.
const CORE = {
  url: 'https://github.com/ironsource-mobile/LevelPlay-Swift-Package',
  from: CORE_VERSION,
  product: 'UnityMediationSDK',
  package: 'LevelPlay-Swift-Package',
}
/**
 * Known SPM adapters, keyed by the same network names the plugin's own
 * `levelplay.networks` config uses. Add entries as more networks are enabled —
 * never `admob` (scripts/check-no-google.mjs refuses it).
 */
const REGISTRY = {
  unityads: {
    url: 'https://github.com/ironsource-mobile/LevelPlay-UnityAds-Adapter-Swift-Package',
    product: 'UnityAdsAdapter',
    package: 'LevelPlay-UnityAds-Adapter-Swift-Package',
  },
  applovin: {
    url: 'https://github.com/ironsource-mobile/LevelPlay-AppLovin-Adapter-Swift-Package',
    product: 'AppLovinAdapter',
    package: 'LevelPlay-AppLovin-Adapter-Swift-Package',
  },
  vungle: {
    url: 'https://github.com/ironsource-mobile/LevelPlay-Vungle-Adapter-Swift-Package',
    product: 'VungleAdapter',
    package: 'LevelPlay-Vungle-Adapter-Swift-Package',
  },
}

// Follow package.json — the plugin's own hook that wires Android adapters reads
// the SAME list, so hard-coding here would let the platforms drift: a network
// enabled in the dashboard and on Android, silently absent from the iOS binary.
const wanted = wantedNetworks(readAppPackage())
if (!wanted.length) {
  stop(
    'package.json levelplay.networks is empty — the iOS binary would link the LevelPlay core and no demand adapter.',
    'Exactly 67 runs on ["unityads"]. Restore it before installing.',
  )
}
const unknown = wanted.filter((n) => !REGISTRY[n])
if (unknown.length) {
  stop(
    `no SPM adapter known for: ${unknown.join(', ')}`,
    'Those networks would be missing from the iOS binary while working on Android.',
    'Add them to REGISTRY (find the repo under github.com/ironsource-mobile) or drop them.',
  )
}
// requireAdapterVersion() stops the install if an enabled network has no
// verified version, instead of pinning something nobody confirmed exists.
const ADAPTERS = wanted.map((n) => ({ network: n, ...REGISTRY[n], from: requireAdapterVersion(n, 'ios') }))

const patched = `// swift-tools-version: 5.9
import PackageDescription

// ${PATCH_MARK} — do not edit here, the change is
// reapplied on every npm install. The upstream manifest ships no SDK at all and
// the plugin then no-ops silently; see that script for the full reasoning.
let package = Package(
    name: "CapacitorLevelplayAds",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorLevelplayAds",
            targets: ["LevelPlayAdsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "${CORE.url}", from: "${CORE.from}"),
${ADAPTERS.map((a) => `        .package(url: "${a.url}", from: "${a.from}"),`).join('\n')}
    ],
    targets: [
        .target(
            name: "LevelPlayAdsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "${CORE.product}", package: "${CORE.package}"),
${ADAPTERS.map((a) => `                .product(name: "${a.product}", package: "${a.package}"),`).join('\n')}
            ],
            path: "${SOURCES}")
    ]
)
`

if (current === patched) {
  console.log(`[${TAG}] already patched — LevelPlay ${CORE.from}+, adapters: ${ADAPTERS.map((a) => `${a.network} ${a.from}+`).join(', ')}`)
  process.exit(0)
}
writeFileSync(manifest, patched)

// Read it back: "wrote a file" is not "the manifest links the SDK".
const written = readFileSync(manifest, 'utf8')
const mustContain = [
  'name: "CapacitorLevelplayAds"',
  CORE.url,
  `.product(name: "${CORE.product}", package: "${CORE.package}")`,
  ...ADAPTERS.flatMap((a) => [a.url, `.product(name: "${a.product}", package: "${a.package}")`]),
]
const missing = mustContain.filter((s) => !written.includes(s))
if (missing.length) stop(`patched Package.swift is missing: ${missing.join(' | ')}`, 'The write did not take. Do not build.')

console.log(
  `[${TAG}] ✅ SPM manifest patched — LevelPlay ${CORE.from}+ and ${ADAPTERS.length} adapter(s): ` +
    ADAPTERS.map((a) => `${a.network} ${a.from}+`).join(', '),
)
