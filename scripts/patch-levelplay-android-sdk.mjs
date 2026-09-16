// Aligns the ANDROID LevelPlay SDK versions with the iOS ones.
//
// THE PROBLEM. The plugin hard-codes its Android versions in two places inside
// node_modules, neither of which we control and both of which reset on every
// `npm install`:
//
//   android/build.gradle          → com.unity3d.ads-mediation:mediation-sdk:X
//   scripts/network-registry.json → per-network adapter + network-SDK versions,
//                                   which the plugin's own Capacitor hook
//                                   (package.json "capacitor:sync:after") then
//                                   injects into android/app/build.gradle
//
// iOS takes its versions from a Swift Package manifest we rewrite ourselves
// (patch-levelplay-spm.mjs). Nothing tied the two together, so in KVIZKO they
// drifted: iOS resolved LevelPlay 9.6.0 / UnityAds adapter 5.10.0 while Android
// built against 9.4.0 / 5.8.0. Both compiled. Both served ads. They were simply
// different SDKs, which is the kind of difference nobody looks for when a bug
// reproduces on one platform only.
//
// Exactly 67 ships iOS only today, but the Android project exists and syncs;
// both patches read scripts/lib/levelplay-versions.mjs so that the day Android
// ships, it links the same SDK iOS already proved.
//
// Fails loudly (exit 1) if either file is missing or no longer has the shape
// this was written for. Idempotent. Wired via package.json "postinstall".
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_VERSION, NETWORKS, wantedNetworks } from './lib/levelplay-versions.mjs'
import { locatePlugin, readAppPackage } from './lib/levelplay-plugin.mjs'

const TAG = 'patch-levelplay-android-sdk'
const pkgDir = locatePlugin(TAG)
if (!pkgDir) process.exit(0)

const stop = (...lines) => {
  console.error(`[${TAG}] ${lines[0]}`)
  for (const l of lines.slice(1)) console.error(`  ${l}`)
  process.exit(1)
}

let changed = 0

/** 1 ── the mediation core, hard-coded in the plugin's own build.gradle */
const gradle = join(pkgDir, 'android/build.gradle')
if (!existsSync(gradle)) {
  stop('MISSING android/build.gradle — plugin layout changed.', 'Do not ship: verify by hand which mediation SDK Android is linking.')
}
const CORE_RE = /(['"])com\.unity3d\.ads-mediation:mediation-sdk:([0-9][0-9.]*)\1/g
const gradleSrc = readFileSync(gradle, 'utf8')
const coreMatches = [...gradleSrc.matchAll(CORE_RE)]
if (coreMatches.length !== 1) {
  stop(
    `expected exactly one mediation-sdk dependency in android/build.gradle, found ${coreMatches.length}.`,
    'Upstream restructured it. Read the file before shipping — Android may now be',
    'linking a different core than iOS without anything saying so.',
  )
}
const coreWas = coreMatches[0][2]
if (coreWas !== CORE_VERSION) {
  writeFileSync(gradle, gradleSrc.replace(CORE_RE, `$1com.unity3d.ads-mediation:mediation-sdk:${CORE_VERSION}$1`))
  console.log(`[${TAG}] ✅ core ${coreWas} → ${CORE_VERSION}`)
  changed++
}

/** 2 ── per-network adapter + network SDK, in the registry the hook reads */
const registryPath = join(pkgDir, 'scripts/network-registry.json')
if (!existsSync(registryPath)) {
  stop(
    'MISSING scripts/network-registry.json — plugin layout changed.',
    'The adapter versions injected into android/app/build.gradle are no longer under our control.',
  )
}
let registry
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8'))
} catch (e) {
  stop(`scripts/network-registry.json is not valid JSON (${e.message}).`, 'Reinstall the plugin before building.')
}

// Every network this app actually enables must be in the registry in the shape
// we rewrite. A network missing here would make the plugin's hook log a warning
// and inject nothing — Android would then build with no demand adapter at all.
for (const n of wantedNetworks(readAppPackage())) {
  const entry = registry[n]
  if (!entry || typeof entry.android !== 'string' || !/:[0-9][0-9.]*$/.test(entry.android)) {
    stop(
      `network-registry.json has no usable "${n}".android coordinate.`,
      'The plugin hook would inject no adapter for it on Android. Read the registry before shipping.',
    )
  }
}

for (const [network, want] of Object.entries(NETWORKS)) {
  const entry = registry[network]
  if (!entry) continue // network not in this plugin build; nothing to align
  // No verified version means we have nothing truthful to write. Leave whatever
  // upstream shipped rather than stamping a number we invented.
  if (!want.adapter) continue

  if (typeof entry.android === 'string') {
    const next = entry.android.replace(/:[0-9][0-9.]*$/, `:${want.adapter}`)
    if (next !== entry.android) {
      console.log(`[${TAG}] ✅ ${network} adapter ${entry.android.split(':').pop()} → ${want.adapter}`)
      entry.android = next
      changed++
    }
  }

  // `androidSdks` is the network's OWN sdk (e.g. unity-ads), which Android
  // declares explicitly while iOS gets it transitively through the adapter.
  if (want.sdk && Array.isArray(entry.androidSdks)) {
    entry.androidSdks = entry.androidSdks.map((dep) => {
      const next = dep.replace(/:[0-9][0-9.]*$/, `:${want.sdk}`)
      if (next !== dep) {
        console.log(`[${TAG}] ✅ ${network} network sdk → ${want.sdk}`)
        changed++
      }
      return next
    })
  }
}

if (changed) writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n')

// Read both back: the point of this script is that the versions ARE aligned,
// not that a write was attempted.
const gradleNow = readFileSync(gradle, 'utf8')
if (!gradleNow.includes(`com.unity3d.ads-mediation:mediation-sdk:${CORE_VERSION}`)) {
  stop(`android/build.gradle does not pin mediation-sdk ${CORE_VERSION} after patching. Do not build.`)
}
const registryNow = JSON.parse(readFileSync(registryPath, 'utf8'))
for (const n of wantedNetworks(readAppPackage())) {
  const want = NETWORKS[n]
  if (want?.adapter && !registryNow[n].android.endsWith(`:${want.adapter}`)) {
    stop(`network-registry.json "${n}" adapter is ${registryNow[n].android}, expected ${want.adapter}. Do not build.`)
  }
}

if (!changed) console.log(`[${TAG}] already aligned — core ${CORE_VERSION}`)
