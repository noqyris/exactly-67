/**
 * Release gate #3: prove Exactly 67 carries REAL LevelPlay ids for a platform
 * before a live build is allowed to exist.
 *
 *   node scripts/check-levelplay-config.mjs ios
 *   node scripts/check-levelplay-config.mjs android
 *
 * Chained into `build:live` (and so `ios:appstore`), FIRST, before anything is
 * built: a live bundle cannot be produced while the ids are still placeholders.
 * The fastlane gate runs it again before every live archive and upload
 * (verify_levelplay_ids! in ios/App/fastlane/Fastfile) and reads the ids back
 * out of the success line at the bottom of this file, to prove the bundle being
 * shipped carries them. That line's wording is therefore load-bearing: change
 * it and every live lane refuses (by design) until the Fastfile's pattern is
 * changed with it.
 *
 * Why this exists: an empty or malformed app key does not crash anything.
 * LevelPlay's init fails quietly, every load reports no fill, the ad layer
 * degrades to "no ads", and the App Store build looks perfectly healthy while
 * earning nothing — the failure nobody notices until a monthly report. The
 * ids come from the LevelPlay dashboard (platform.ironsrc.com → Apps → Exactly 67
 * → the platform's App Key, and its Ad Units page), not from the Unity Ads
 * Game ID, which is a different, numeric identifier.
 *
 * WHAT IT PARSES — src/services/providers/levelplay.ts must declare, as plain
 * string literals (single or double quotes, `export` and a type annotation
 * optional, comments allowed):
 *
 *   const APP_KEYS: Record<string, string> = {
 *     ios: '<9 lower-case hex>',
 *     android: '<9 lower-case hex>',
 *   }
 *   const UNITS_BY_PLATFORM: Record<string, AdUnits> = {
 *     ios: { banner: '<16 [a-z0-9]>', interstitial: '<16 [a-z0-9]>', rewarded: '<16 [a-z0-9]>' },
 *     android: { banner: '…', interstitial: '…', rewarded: '…' },
 *   }
 *
 * Anything else — ids read from env, a template literal, an identifier — is a
 * refusal with a message naming this shape, never a guess.
 *
 * Checks for the requested platform:
 *   - app key matches /^[0-9a-f]{9}$/  (LevelPlay App Key, shaped like 27b820f5d)
 *   - banner / interstitial / rewarded each match /^[a-z0-9]{16}$/  (shaped like c9bxcnrdi8okqp6s)
 *   (both examples are KVIZKO's real ids: right shape, and refused below)
 *   - the three unit ids are distinct (a pasted-twice id silently serves one
 *     format's demand into another, or nothing)
 *   - none equals the other platform's value (iOS and Android are separate
 *     LevelPlay apps; a reused id yields no fill)
 *   - none is one of KVIZKO's ids — the provider was ported from KVIZKO, and
 *     its ids would send Exactly 67's impressions to the wrong app.
 *
 * Exit 0 when valid, 1 when not (or the file/shape cannot be read), 2 on usage.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'src/services/providers/levelplay.ts'
const PLATFORMS = ['ios', 'android']
const FORMATS = ['banner', 'interstitial', 'rewarded']
const APP_KEY_RE = /^[0-9a-f]{9}$/
const UNIT_RE = /^[a-z0-9]{16}$/

// The sibling app's live ids (KVIZKO 1.2.1). Valid-looking, and wrong here.
const KVIZKO_IDS = new Set([
  '27b820f5d', '27ca66f85',
  'c9bxcnrdi8okqp6s', '6ssz32u913am0l56', 'l3uutyzolsfdc0pv',
  '0osrli333khb9vp3', 'u2lai02q67eunfhk', 'yov04goot51y13qd',
])

const platform = process.argv[2]
if (!PLATFORMS.includes(platform)) {
  console.error('usage: node scripts/check-levelplay-config.mjs <ios|android>')
  process.exit(2)
}

const refuse = (lines) => {
  console.error(`\n✗ LevelPlay config (${platform}) — Exactly 67 cannot be built live.`)
  for (const l of lines) console.error(`  ${l}`)
  process.exit(1)
}

const SHAPE_HINT = [
  `Expected in ${SOURCE}:`,
  "  const APP_KEYS: Record<string, string> = { ios: '…', android: '…' }",
  "  const UNITS_BY_PLATFORM: Record<string, AdUnits> = { ios: { banner: '…', interstitial: '…', rewarded: '…' }, android: { … } }",
  'with every value a plain string literal (see the header of scripts/check-levelplay-config.mjs).',
]

const file = join(APP_ROOT, SOURCE)
if (!existsSync(file)) {
  refuse([`${SOURCE} does not exist — there is no LevelPlay provider to read ids from.`, ...SHAPE_HINT])
}
const src = readFileSync(file, 'utf8')

/**
 * Returns the comment-free text of the object literal that starts at `open`
 * (the index of its `{`), up to and including the matching `}`.
 * String literals are kept verbatim; comments are dropped, so an apostrophe or
 * a brace inside a comment cannot unbalance anything.
 */
function objectLiteralAt(text, open) {
  let out = ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end - 1
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) return null
      i = end + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      if (j >= text.length) return null
      out += text.slice(i, j + 1)
      i = j
      continue
    }
    out += c
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return out
    }
  }
  return null
}

/** The object literal assigned to `const <name>`; exactly one declaration allowed. */
function declaredObject(name) {
  const re = new RegExp(`^[ \\t]*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*\\{`, 'gm')
  const matches = [...src.matchAll(re)]
  if (matches.length !== 1) {
    refuse([
      matches.length
        ? `${SOURCE} declares \`const ${name}\` ${matches.length} times — cannot tell which one ships.`
        : `${SOURCE} has no \`const ${name} = { … }\` declaration.`,
      ...SHAPE_HINT,
    ])
  }
  const m = matches[0]
  const body = objectLiteralAt(src, m.index + m[0].length - 1)
  if (!body) refuse([`\`const ${name}\` in ${SOURCE} is not a closed object literal.`, ...SHAPE_HINT])
  return body
}

/** Top-level `key: <string literal>` inside an object literal body, or an explanation. */
function stringProp(body, key, where) {
  const re = new RegExp(`(?:^|[{,\\s])['"]?${key}['"]?\\s*:\\s*(?:(['"])([^'"\\\\\\n]*)\\1|([^,}\\n]*))`, 'g')
  const found = [...body.matchAll(re)]
  if (found.length !== 1) {
    return { error: found.length ? `${where}.${key} is declared ${found.length} times` : `${where}.${key} is missing` }
  }
  const [, quote, value, other] = found[0]
  if (!quote) return { error: `${where}.${key} is not a plain string literal (found: ${String(other).trim() || 'nothing'})` }
  return { value }
}

/** Nested `key: { … }` inside an object literal body. */
function objectProp(body, key, where) {
  const re = new RegExp(`(?:^|[{,\\s])['"]?${key}['"]?\\s*:\\s*\\{`, 'g')
  const found = [...body.matchAll(re)]
  if (found.length !== 1) return { error: found.length ? `${where}.${key} is declared ${found.length} times` : `${where}.${key} is missing` }
  const m = found[0]
  const inner = objectLiteralAt(body, m.index + m[0].length - 1)
  return inner ? { body: inner } : { error: `${where}.${key} is not a closed object literal` }
}

const appKeys = declaredObject('APP_KEYS')
const unitsByPlatform = declaredObject('UNITS_BY_PLATFORM')

function readPlatform(p) {
  const errors = []
  const key = stringProp(appKeys, p, 'APP_KEYS')
  if (key.error) errors.push(key.error)
  const units = {}
  const block = objectProp(unitsByPlatform, p, 'UNITS_BY_PLATFORM')
  if (block.error) errors.push(block.error)
  else {
    for (const f of FORMATS) {
      const u = stringProp(block.body, f, `UNITS_BY_PLATFORM.${p}`)
      if (u.error) errors.push(u.error)
      else units[f] = u.value
    }
  }
  return { key: key.value, units, errors }
}

const mine = readPlatform(platform)
if (mine.errors.length) refuse([...mine.errors, ...SHAPE_HINT])
const other = readPlatform(PLATFORMS.find((p) => p !== platform))

const problems = []
const show = (v) => (v === '' ? "'' (placeholder)" : `'${v}'`)

if (!APP_KEY_RE.test(mine.key)) {
  problems.push(`APP_KEYS.${platform} = ${show(mine.key)} — not a LevelPlay App Key (9 lower-case hex characters, e.g. 27b820f5d).`)
}
for (const f of FORMATS) {
  if (!UNIT_RE.test(mine.units[f])) {
    problems.push(`UNITS_BY_PLATFORM.${platform}.${f} = ${show(mine.units[f])} — not a LevelPlay ad unit id (16 characters [a-z0-9], e.g. c9bxcnrdi8okqp6s).`)
  }
}
const unitValues = FORMATS.map((f) => mine.units[f]).filter((v) => UNIT_RE.test(v))
if (new Set(unitValues).size !== unitValues.length) {
  problems.push(`UNITS_BY_PLATFORM.${platform} reuses one unit id for two formats — each format has its own unit in the dashboard.`)
}
const otherValues = new Set([other.key, ...Object.values(other.units)].filter(Boolean))
for (const v of [mine.key, ...unitValues]) {
  if (v && otherValues.has(v)) {
    problems.push(`'${v}' is used for both iOS and Android — they are separate LevelPlay apps with separate ids.`)
  }
}
for (const v of [mine.key, ...Object.values(mine.units)]) {
  if (KVIZKO_IDS.has(v)) problems.push(`'${v}' is one of KVIZKO's LevelPlay ids — it would credit Exactly 67's ads to another app.`)
}

if (problems.length) {
  refuse([
    ...problems,
    '',
    'Create the Exactly 67 app in the LevelPlay dashboard (platform.ironsrc.com), then copy its App Key',
    `and its banner / interstitial / rewarded unit ids into ${SOURCE}.`,
  ])
}

// Parsed by verify_levelplay_ids! in ios/App/fastlane/Fastfile ("app key …;
// units banner …, interstitial …, rewarded …"). Keep the wording, or change the
// Fastfile's pattern in the same commit.
console.log(
  `✓ LevelPlay config (${platform}) — app key ${mine.key}; units banner ${mine.units.banner}, ` +
    `interstitial ${mine.units.interstitial}, rewarded ${mine.units.rewarded}`,
)
