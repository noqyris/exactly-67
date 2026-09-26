#!/usr/bin/env node
/**
 * The fake-store bundle gate (from the mobile-game-playbook skill; KVIZKO 02b9647). A FAKE-ADS build (VITE_ADS=mock) buys from
 * services/providers/mockIap — no StoreKit, no money. Every other bundle must
 * not carry a byte of it: a fake store in a real build would hand out every
 * product for free.
 *
 *   node scripts/check-iap-mock-off.mjs               scan dist/: the marker must be ABSENT
 *   node scripts/check-iap-mock-off.mjs --expect-on   scan dist/: the marker must be PRESENT (mock builds)
 *   --dir <path>                                      scan that build directory instead of dist/
 *
 * The needle is IAP_MOCK_MARKER ('IAP:mock'), which the fake sheet renders as
 * an attribute value, so no minifier can drop it while the module is bundled.
 * It contains none of the ad-mode markers (ADMODE:*, ADS:on|off|mock).
 * Exit 1 on any failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NEEDLE = 'IAP:mock'
const argv = process.argv.slice(2)
const expectOn = argv.includes('--expect-on')
const dirIdx = argv.indexOf('--dir')
const dir = resolve(ROOT, dirIdx >= 0 ? argv[dirIdx + 1] : 'dist')

function walk(d) {
  const out = []
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|html|css)$/.test(name)) out.push(p)
  }
  return out
}

if (!existsSync(dir)) {
  console.error(`✗ iap-mock gate: ${relative(ROOT, dir) || dir} does not exist — build first`)
  process.exit(1)
}
const hits = walk(dir).filter((f) => readFileSync(f, 'utf8').includes(NEEDLE))
if (expectOn) {
  if (hits.length === 0) {
    console.error('✗ iap-mock gate: a FAKE-ADS build must carry the fake store, and this one does not')
    process.exit(1)
  }
  console.log(`✓ iap-mock gate (mock build): fake store present (${hits.map((f) => relative(dir, f)).join(', ')})`)
} else {
  if (hits.length > 0) {
    console.error(`✗ iap-mock gate: the FAKE store is in a non-mock bundle: ${hits.map((f) => relative(dir, f)).join(', ')}`)
    process.exit(1)
  }
  console.log('✓ iap-mock gate: no fake store in this bundle')
}
