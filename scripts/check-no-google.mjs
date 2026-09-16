#!/usr/bin/env node
/**
 * Release gate #2: prove NO Google ad surface can reach a shipped Exactly 67
 * binary.
 *
 * Sibling of scripts/check-ad-mode.mjs. That one asks "which mode?"; this one
 * asks "is Google in the build at all?" — because publisher account
 * pub-3307486877162157 was terminated for invalid traffic on 2026-08-18 and the
 * appeal was rejected 2026-08-19, final. Under the AdSense T&Cs a terminated
 * publisher is not eligible for further participation in AdSense/AdMob/AdMob
 * Mediation, so any AdMob or Google-Ad-Manager demand path is not "risky
 * revenue" — it is zero revenue plus a fresh policy record.
 *
 * Runs BEFORE `cap sync` in every sync/release chain. Exit non-zero on any hit.
 *
 *   node scripts/check-no-google.mjs            # scan the app + native projects
 *   node scripts/check-no-google.mjs --strict   # also fail on the dead id in prose
 *
 * Files `cap sync` generates (the synced web copy, CapApp-SPM, capacitor
 * config/plugin lists, Package.resolved) are only NOTED here, never failed: at
 * this point they still hold the previous build, and failing on them would
 * block the one step that replaces them. scripts/check-native-sync.mjs fails on
 * them after the sync — see scripts/lib/google-surfaces.mjs.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADMOB_ID_RE, DEAD_PUB, GENERATED, GENERATED_PATHS, scanGenerated } from './lib/google-surfaces.mjs'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = process.argv.includes('--strict')
const ADMOB_SKAN = 'cstr6suwn9.skadnetwork' // AdMob's SKAdNetwork id
const failures = []
const notes = []

const abs = (p) => join(APP_ROOT, p)
const read = (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : null)
const fail = (rule, where, detail) => failures.push({ rule, where, detail })

// Prose may name the dead account — the postmortem in CLAUDE.md and
// docs/MONETIZATION.md has to be readable, and the gates themselves must name
// what they refuse. Anything the compiler, the linker, a store or a crawler
// sees may not. Concretely:
//   - any Markdown file (CLAUDE.md, README.md, docs/**/*.md, store/*.md, …);
//   - anything under marketing/ (video briefs and posting sheets, never shipped);
// NOT docs/*.html: docs/ is also the GitHub Pages support/privacy site the store
// listing links to, i.e. the most crawlable thing this repo publishes.
// `--strict` fails prose too. The gate scripts themselves are exempt even then:
// they cannot refuse an id without naming it.
const isProse = (f) => f.endsWith('.md') || f.startsWith('marketing/')
const isGate = (f) => /^scripts\/check-[\w-]+\.mjs$/.test(f) || f === 'scripts/lib/google-surfaces.mjs'

// ── 1. package.json: the mediation network list ──────────────────────────────
// The single most likely accident. capacitor-levelplay-ads' own README shows
//   "networks": ["admob", "applovin", "unityads"]
// as THE example config — admob first. Copy-paste it when adding a network and
// the AdMob adapter, play-services-ads and the AdMob SKAdNetwork id all land in
// the native projects on the next `cap sync`, silently.
const pkg = JSON.parse(read('package.json') ?? '{}')
const nets = (pkg.levelplay?.networks ?? []).map((n) => String(n).toLowerCase())
const GOOGLE_NETS = ['admob', 'googleadmanager', 'google-ad-manager', 'gam', 'admanager', 'adx']
for (const n of nets) {
  if (GOOGLE_NETS.includes(n)) fail('levelplay-network', 'package.json', `levelplay.networks contains "${n}"`)
}
if (pkg.levelplay?.admob) fail('levelplay-network', 'package.json', 'levelplay.admob config block present')
notes.push(`levelplay.networks = [${nets.join(', ') || '(empty)'}]`)

// ── 2. package.json: no AdMob SDK dependency at all ──────────────────────────
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const dep of Object.keys(pkg[field] ?? {})) {
    if (/admob|google-mobile-ads/i.test(dep)) {
      fail('npm-dep', 'package.json', `${field}."${dep}" pulls the Google Mobile Ads SDK`)
    }
  }
}
if (existsSync(abs('node_modules/@capacitor-community/admob'))) {
  // `cap sync` links whatever Capacitor plugins are INSTALLED, not what
  // package.json lists — a leftover directory re-links AdMob into CapApp-SPM.
  fail('npm-dep', 'node_modules/@capacitor-community/admob', 'still installed — `cap sync` would link it again. Run `npm install`.')
}

// ── 3. iOS: the LevelPlay plugin manifest we generate ────────────────────────
const lpSpm = read('node_modules/capacitor-levelplay-ads/Package.swift')
if (lpSpm && /admob/i.test(lpSpm)) {
  fail('ios-link', 'node_modules/capacitor-levelplay-ads/Package.swift', 'LevelPlay manifest links an AdMob adapter (check scripts/patch-levelplay-spm.mjs REGISTRY)')
}

// ── 4. iOS Info.plist: the app id, and the SKAdNetwork tell ──────────────────
const plist = read('ios/App/App/Info.plist')
if (plist) {
  if (plist.includes('GADApplicationIdentifier')) fail('ios-plist', 'ios/App/App/Info.plist', 'GADApplicationIdentifier present')
  if (plist.includes(ADMOB_SKAN)) fail('ios-plist', 'ios/App/App/Info.plist', `AdMob SKAdNetwork id ${ADMOB_SKAN} present — an AdMob adapter was wired`)
}

// ── 5. Capacitor config source ───────────────────────────────────────────────
// capacitor.config.ts is the source of truth; the JSON copies are generated.
const capCfg = read('capacitor.config.ts')
if (capCfg && /admob/i.test(capCfg)) fail('capacitor-config', 'capacitor.config.ts', 'carries AdMob plugin configuration')

// ── 6. Android: manifest meta-data + hand-maintained gradle files ────────────
// (capacitor.build.gradle / capacitor.settings.gradle are generated by
// `cap sync android` and handled in section 9.)
const manifest = read('android/app/src/main/AndroidManifest.xml')
if (manifest && manifest.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  fail('android-manifest', 'android/app/src/main/AndroidManifest.xml', 'com.google.android.gms.ads.APPLICATION_ID meta-data present')
}
for (const g of ['android/app/build.gradle', 'android/build.gradle', 'android/settings.gradle', 'android/variables.gradle']) {
  const src = read(g)
  if (!src) continue
  if (/play-services-ads(?!-identifier)|admob-adapter|capacitor-community-admob/i.test(src)) {
    fail('android-link', g, 'AdMob adapter / play-services-ads / admob plugin on the classpath')
  }
}

// ── 7. app-ads.txt: the only Google surface that is PUBLIC ───────────────────
// A google.com line naming a terminated publisher is a permanent, crawlable
// link between this bundle id and the closed account — exactly the signal
// Google uses to tie a new publisher account back to a disabled one. It also
// authorises nobody who can actually pay, while declaring nothing for the
// network that can.
//
// Exactly 67 keeps no app-ads.txt in this repo today: the file must sit at the
// ROOT of the developer domain on the store listing, which is not this repo's
// GitHub Pages sub-path. When a repo copy exists, declare it in package.json:
//   "adSafety": { "appAdsTxt": "<path>", "sellers": ["unity", "ironsrc"] }
const APP_ADS = process.env.APP_ADS_PATH ?? pkg.adSafety?.appAdsTxt ?? null
const SELLERS = pkg.adSafety?.sellers ?? ['unity', 'ironsrc']
if (!APP_ADS) {
  // NOT a failure. Every other rule here fails on the PRESENCE of a Google
  // surface; the absence of a repo copy of a hosted text file is not one.
  notes.push('app-ads.txt not declared (package.json adSafety.appAdsTxt) — app-ads.txt checks skipped')
} else {
  const appAds = read(APP_ADS)
  if (appAds === null) {
    fail('app-ads', APP_ADS, 'declared in adSafety.appAdsTxt / APP_ADS_PATH but not present in the repo')
  } else {
    // A google.com RESELLER line is NOT a problem and must not be stripped: those
    // are Unity/ironSource's own AdX seats, and removing them tells every
    // Google-sourced buyer this inventory is unauthorised — cutting real demand
    // for no safety gain. What must never appear is OUR terminated publisher, or
    // a google.com DIRECT line, which would claim we sell through Google.
    for (const line of appAds.split('\n')) {
      const l = line.trim()
      if (!l || l.startsWith('#')) continue
      if (l.includes(DEAD_PUB)) {
        fail('app-ads', APP_ADS, `names the terminated publisher: ${l}`)
      } else if (/^google(\.com|syndication)/i.test(l) && /,\s*DIRECT/i.test(l)) {
        fail('app-ads', APP_ADS, `claims a DIRECT Google seller relationship: ${l}`)
      }
    }
    // Somebody must be authorised to sell, or DSPs skip the inventory entirely.
    const sellerRe = new RegExp(`^\\s*(${SELLERS.join('|')})\\.com,[^,]+,\\s*DIRECT`, 'im')
    if (!sellerRe.test(appAds)) {
      fail('app-ads', APP_ADS, `no ${SELLERS.join('/')}.com DIRECT line — the live ad stack is unauthorised`)
    }
  }
}

// ── 8. The dead publisher id / AdMob ids, everywhere they can still hide ─────
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'Pods', 'DerivedData', '.gradle', '.claude', '.playwright-mcp'])
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|swift|kt|java|gradle|xml|plist|xcprivacy|html|txt|pbxproj|entitlements|properties|md)$/
const SCAN_NAMES = new Set(['Fastfile', 'Appfile', 'Deliverfile', 'Matchfile', 'Podfile'])
const isGenerated = (rel) => GENERATED_PATHS.some((g) => rel === g || rel.startsWith(g + '/'))
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = relative(APP_ROOT, p)
    if (SKIP_DIRS.has(name) || isGenerated(rel)) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (SCAN_EXT.test(name) || SCAN_NAMES.has(name)) out.push(rel)
  }
  return out
}
for (const f of walk(APP_ROOT)) {
  const src = read(f)
  if (!src) continue
  if (isGate(f)) continue
  const prose = isProse(f)
  if (src.includes(DEAD_PUB) && (STRICT || !prose)) fail('dead-pub-id', f, `contains ${DEAD_PUB}`)
  if (ADMOB_ID_RE.test(src) && !prose) fail('admob-unit-id', f, 'contains an AdMob app/unit id')
}

// ── 9. Generated native files: noted, never failed, before the sync ──────────
for (const [platform, entries] of Object.entries(GENERATED)) {
  for (const entry of entries) {
    const hits = scanGenerated(APP_ROOT, entry)
    if (!hits.length) continue
    const first = hits[0]
    notes.push(
      `stale generated file: ${first.where}${hits.length > 1 ? ` (+${hits.length - 1} more)` : ''} ${first.detail} — ` +
        `regenerated by \`${entry.by}\`; check-native-sync.mjs ${platform} refuses it after that`,
    )
  }
}

// ── 10. The built bundle — the thing that actually ships ─────────────────────
if (existsSync(abs('dist/assets'))) {
  let bundle = ''
  const stack = [abs('dist/assets')]
  while (stack.length) {
    const d = stack.pop()
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) stack.push(p)
      else if (/\.(js|mjs|cjs|html|json|css)$/.test(n)) bundle += readFileSync(p, 'utf8')
    }
  }
  if (bundle.includes('ca-app-pub-')) fail('bundle', 'dist/assets', 'shipped JS carries an AdMob unit id')
  if (bundle.includes(DEAD_PUB)) fail('bundle', 'dist/assets', `shipped JS carries ${DEAD_PUB}`)
  if (/@capacitor-community\/admob|AdMobPlugin/.test(bundle)) fail('bundle', 'dist/assets', 'shipped JS still references the AdMob Capacitor plugin')
} else {
  notes.push('dist/assets not built — bundle check skipped')
}

// ── report ───────────────────────────────────────────────────────────────────
console.log('no-google gate — Exactly 67' + (STRICT ? ' (strict: prose included)' : ''))
for (const n of notes) console.log(`  · ${n}`)
if (!failures.length) {
  console.log('✓ no Google ad surface found in the build inputs')
  process.exit(0)
}
console.error(`\n✗ ${failures.length} Google ad surface(s) found — release aborted.\n`)
for (const f of failures) console.error(`  [${f.rule}] ${f.where}\n      ${f.detail}`)
console.error('\n  The AdMob publisher account is terminated and the appeal was refused.')
console.error('  Any AdMob/Ad-Manager path earns nothing and creates a new policy record.')
process.exit(1)
