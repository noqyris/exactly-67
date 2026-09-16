/**
 * Release gate: prove which ad MODE the built Exactly 67 bundle declares.
 *
 * The app bakes literal markers into the bundle; the bundler folds each env
 * read to one of them, and each must appear EXACTLY once:
 *
 *   ADMODE:test | ADMODE:live          folded from VITE_AD_MODE
 *                                      (src/services/providers/levelplay.ts)
 *   ADS:on | ADS:off | ADS:mock        folded from VITE_ADS
 *                                      (src/services/adProvider.ts)
 *   UNLOCKALL:1  — or ABSENT           folded from VITE_UNLOCK_ALL
 *                                      (src/services/buildFlags.ts)
 *
 * and this script greps dist/ for them. Grepping unit ids proves nothing on
 * Unity LevelPlay: the network has no test/live id pair, the SAME unit ids ship
 * in every mode, and every ADS:on build serves the REAL waterfall — `isTesting`
 * only unlocks the Test Suite. `ADS:off` is the one build that serves nothing:
 * the ad layer never initialises, so there is no waterfall to put in front of
 * anyone.
 *
 *   node scripts/check-ad-mode.mjs live [dir]  # App Store upload:                     ADMODE:live + ADS:on,  no UNLOCKALL
 *   node scripts/check-ad-mode.mjs off  [dir]  # TestFlight follow-up + dev default:  ADMODE:test + ADS:off
 *   node scripts/check-ad-mode.mjs mock [dir]  # FAKE ads, developer testing only:     ADMODE:test + ADS:mock
 *   node scripts/check-ad-mode.mjs test [dir]  # real waterfall, dev integration only: ADMODE:test + ADS:on
 *
 * The four targets are disjoint, on purpose:
 *   - `live` refuses ADS:off and ADS:mock — a store build that never loads a
 *     real ad is a contradiction, not a mode — and refuses UNLOCKALL:1, the
 *     TestFlight "every level unlocked" flag, which would hand all 600 levels
 *     to every App Store player;
 *   - `off` refuses ADS:on — the follow-up TestFlight build after a live upload
 *     is ADS:off (settled 2026-09-15), because TestFlight offers the newest
 *     build first and an ADS:on build there is a real-ads build on the owner's
 *     phone;
 *   - `test` refuses ADS:off — it would be a silent ad-less build nobody meant —
 *     and is never uploaded anywhere: it serves the live waterfall;
 *   - `mock` is our own drawn rectangles; every other target demands
 *     `ADS:mock ×0`, so a fake-ads build can never pass as a release.
 * A missing or doubled marker fails every target: the bundle predates the
 * markers, a stale chunk sits beside a fresh one, or a seam moved — either way
 * it cannot be proven, and "cannot prove" is a refusal here.
 *
 * `dir` defaults to <app>/dist/assets. Exits 2 on bad usage, 1 on a mismatch, so
 * it can sit in an && chain and abort the release.
 *
 * Why this exists: the mode flag fails SAFE (`!== 'live'`), so the residual
 * mistake is shipping a store build nobody declared live — or a hand-rolled
 * `cap sync` that skips this check. The old AdMob-era flag let real-ad builds
 * reach TestFlight, where the owner installs the newest build and taps his own
 * ads; Google closed publisher account pub-3307486877162157 for invalid traffic
 * on 2026-08-18 over exactly that, and every app on the account lost its ads.
 *
 * There is deliberately NO fallback for a bundle without a single ADMODE marker.
 * The AdMob-era gate classified such bundles by counting `ca-app-pub-…` ids —
 * but every AdMob-era Exactly 67 bundle carries the terminated publisher's
 * units, so there is no target that may accept one. scripts/check-no-google.mjs
 * runs after this gate in every sync/release chain and refuses those ids again.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Exact occurrence counts a passing bundle must show, per target. A number is
// "exactly this many"; an array is "any of these".
//
// The exact-count contract does the work: because every target states a count
// for EVERY marker, a new marker is refused by every target that did not ask
// for it — nobody has to remember to exclude it.
//
// UNLOCKALL:1 is the TestFlight-only "all levels unlocked" flag
// (VITE_UNLOCK_ALL=1 → src/services/buildFlags.ts allLevelsUnlocked()). The App
// Store must never carry it; every other build may (build:tf sets it, the
// others do not), but never more than once.
//        ADMODE:test  ADMODE:live  ADS:on  ADS:off  ADS:mock  UNLOCKALL:1
const TARGETS = {
  live: { test: 0, live: 1, on: 1, off: 0, mock: 0, unlock: 0 },
  off: { test: 1, live: 0, on: 0, off: 1, mock: 0, unlock: [0, 1] },
  mock: { test: 1, live: 0, on: 0, off: 0, mock: 1, unlock: [0, 1] },
  test: { test: 1, live: 0, on: 1, off: 0, mock: 0, unlock: [0, 1] },
}
const accepts = (rule, n) => (Array.isArray(rule) ? rule.includes(n) : rule === n)

const want = process.argv[2]
if (!Object.hasOwn(TARGETS, want ?? '')) {
  console.error('usage: node scripts/check-ad-mode.mjs <live|off|mock|test> [dir]')
  console.error('  live  App Store upload                         ADMODE:live + ADS:on, UNLOCKALL:1 absent')
  console.error('  off   TestFlight follow-up build, dev default  ADMODE:test + ADS:off')
  console.error('  mock  fake ads, developer testing only         ADMODE:test + ADS:mock')
  console.error('  test  real waterfall, dev integration only     ADMODE:test + ADS:on')
  process.exit(2)
}
// An explicit dir is taken relative to where the command was typed; the
// default is always this app's dist/, wherever the command was typed.
const dir = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : join(APP_ROOT, 'dist/assets')

function readAll(d) {
  let out = ''
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) { out += readAll(p); continue }
    if (/\.(js|mjs|cjs|html|json)$/.test(name)) out += readFileSync(p, 'utf8')
  }
  return out
}

let bundle
try { bundle = readAll(dir) } catch {
  console.error(`✗ cannot read ${dir} — run the build first`)
  process.exit(1)
}
if (!bundle) {
  console.error(`✗ ${dir} holds no JavaScript — run the build first`)
  process.exit(1)
}

// A boot-mode bundle is never a release, whatever its markers say. Exactly 67
// has no such entry today, but the portfolio's Test Suite entry
// (VITE_TESTSUITE=1) and advertising-id readout (VITE_ADID_CAPTURE=1) — the
// capture build used to pin a test device — carry ADMODE:test + ADS:on like the
// normal test build. If either is ported here, this refuses it on every target
// without anyone having to remember to add the rule.
for (const [marker, what] of [['TESTSUITE:1', 'a Test Suite entry (VITE_TESTSUITE=1)'], ['ADIDCAPTURE:1', 'an ad-id capture screen (VITE_ADID_CAPTURE=1)']]) {
  if (bundle.includes(marker)) {
    console.error(`✗ MISMATCH — release aborted. Bundle is ${what}, not the game; no target accepts it.`)
    console.error('  Rebuild in a shell where that variable is not set.')
    process.exit(1)
  }
}

// Count, do not just test presence: "exactly once" is the contract, and a
// doubled marker means a stale chunk is in the bundle.
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
  `ad-mode check — target ${want.toUpperCase()}; markers seen: ` +
    `ADMODE:test ×${seen.test}  ADMODE:live ×${seen.live}  ADS:on ×${seen.on}  ADS:off ×${seen.off}  ADS:mock ×${seen.mock}  UNLOCKALL:1 ×${seen.unlock}`,
)

const mode = seen.test + seen.live === 1 ? (seen.test ? 'test' : 'live') : null
const ads = seen.on + seen.off + seen.mock === 1 ? (seen.on ? 'on' : seen.off ? 'off' : 'mock') : null
const label =
  `${mode ? `ADMODE:${mode}` : 'no usable ADMODE marker'} + ${ads ? `ADS:${ads}` : 'no usable ADS marker'}` +
  (seen.unlock ? ` + UNLOCKALL:1${seen.unlock > 1 ? ` ×${seen.unlock}` : ''}` : '')

const ok = Object.entries(TARGETS[want]).every(([k, rule]) => accepts(rule, seen[k]))
if (ok) {
  console.log(`✓ bundle matches target — ${label}`)
  // A pass is NOT permission to tap an ad. On LevelPlay the test flag only
  // unlocks the integration Test Suite — every ADS:on build serves the real
  // waterfall, and nothing makes a tap safe: a dashboard device pin narrows the
  // SOURCE for about an hour, non-bidding rows stay live.
  if (want === 'live') {
    console.log('  warning: REAL ads. Two-build rule: upload this as build N, then bump the build number and')
    console.log('           IMMEDIATELY upload the ads-off TestFlight build N+1 (npm run ios:testflight).')
    console.log('           Once N is READY_FOR_SALE, expire every real-ads build on TestFlight.')
  }
  if (want === 'off') {
    console.log('  note: ads OFF — the ad layer never initialises, nothing loads, nothing to tap.')
    console.log('        Not a store build (`live` refuses it).' + (seen.unlock ? ' All levels unlocked (TestFlight).' : ''))
  }
  if (want === 'mock') {
    console.log('  note: FAKE ads drawn by the app — no network is called. Developer testing only;')
    console.log('        never archive or upload it.')
  }
  if (want === 'test') {
    console.log('  note: on LevelPlay this unlocks the Test Suite only — inventory is REAL.')
    console.log('        Dev integration only: never upload it, and never tap an ad — on any build, on any phone.')
  }
  process.exit(0)
}

console.error(`\n✗ MISMATCH — release aborted. Bundle is ${label}, target ${want.toUpperCase()}.`)
if (!mode) {
  console.error(`  The ADMODE marker (from VITE_AD_MODE) is ${seen.test + seen.live === 0 ? 'missing' : 'present more than once'} —`)
  console.error('  the bundle predates the LevelPlay migration, a stale chunk sits beside a fresh one, or the seam moved.')
  if (bundle.includes('ca-app-pub-')) {
    console.error('  It also carries AdMob unit ids: this is an AdMob-era bundle from a terminated publisher. No target accepts it.')
  }
  console.error('  It cannot be proven; rebuild.')
}
if (mode && !ads) {
  console.error('  The ADS marker (ADS:on / ADS:off / ADS:mock, from VITE_ADS) is missing or appears more than once —')
  console.error('  the bundle predates it, a stale chunk sits beside a fresh one, or the seam moved.')
  console.error('  It cannot be proven; rebuild.')
}
if (seen.unlock > 1) {
  console.error(`  UNLOCKALL:1 appears ${seen.unlock} times — a stale chunk or a second seam. It must appear at most once.`)
}
if (mode === 'live' && (ads === 'off' || ads === 'mock')) {
  console.error(`  ADMODE:live with ADS:${ads} is a contradiction — a store build that never loads a real ad.`)
  console.error('  Rebuild without VITE_ADS.')
}
if (want === 'live' && seen.unlock) {
  console.error('  This bundle unlocks EVERY level (VITE_UNLOCK_ALL=1). That is the TestFlight-only flag;')
  console.error('  on the App Store it gives all 600 levels away. Rebuild in a shell without VITE_UNLOCK_ALL.')
}
if (want === 'live' && mode === 'test') {
  console.error('  This bundle is TEST mode but is going to the store = zero revenue.')
  console.error('  Only VITE_AD_MODE=live (npm run build:live / ios:appstore) declares a build live.')
}
if (want !== 'live' && mode === 'live') {
  console.error('  This bundle is declared LIVE but the target is not the store.')
  console.error("  A real-ads binary on a tester's phone is how the AdMob account was lost.")
}
if (want === 'off' && ads === 'on') {
  console.error('  This bundle loads the LIVE waterfall (ADS:on). The TestFlight follow-up build must be ads-off —')
  console.error('  TestFlight offers the newest build first, to the owner. Rebuild with VITE_ADS=off (build:tf / build:adsoff).')
}
if (want === 'test' && ads === 'off') {
  console.error('  This is an ads-off bundle (VITE_ADS=off). It never passes as the test build —')
  console.error('  if you meant it, the target is `off` (build:adsoff / build:tf).')
}
if (want !== 'mock' && ads === 'mock') {
  console.error('  This is the FAKE-ads bundle (VITE_ADS=mock): our own drawn ads, zero revenue. Developer testing only.')
}
if (want === 'mock' && ads && ads !== 'mock') {
  console.error(`  This bundle is ADS:${ads}, not the fake-ads build. Rebuild with VITE_ADS=mock (build:mock).`)
}
process.exit(1)
