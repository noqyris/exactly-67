import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * scripts/patch-levelplay-consent.mjs fixes the plugin's custom CMP in eleven
 * places: the decline that read back as consent (PATCHED-CONSENT-ORDER ×2, the
 * only one Exactly 67 had until option A), an IAB TCF record left by another
 * CMP read as OUR answer (PATCHED-CUSTOM-STATUS ×2), the first answer of a
 * process sticking in the iOS GDPR map (PATCHED-GDPR-FRESH), Decline styled
 * apart from Accept and an English policy link (PATCHED-EQUAL-BUTTONS ×2), and
 * the fake TCF record that told every SDK GDPR does not apply
 * (PATCHED-NO-TCF-STUB ×4). A silently un-applied consent patch is worse than
 * none, so these tests run the real script — in a throwaway copy of the app,
 * because it finds the app from its own location, never from the working
 * directory — against an upstream-shaped plugin, and prove: every patch lands,
 * a re-run changes nothing, ANY shape mismatch writes NOTHING, the exact 0.1.42
 * pin is enforced — and then that the installed plugin really carries all eleven.
 */

interface Patch {
  marker: string
  label: string
  file: string
  old: string
  new: string
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/patch-levelplay-consent.mjs')
const PLUGIN = join(ROOT, 'node_modules/capacitor-levelplay-ads')
const PLUGIN_IN = (app: string) => join(app, 'node_modules/capacitor-levelplay-ads')

let PATCHES: Patch[] = []
let TMP = ''
let seq = 0
beforeAll(async () => {
  // Importing does not patch: the script runs its main() only when node runs it.
  PATCHES = ((await import(pathToFileURL(SCRIPT).href)) as { PATCHES: Patch[] }).PATCHES
  TMP = mkdtempSync(join(tmpdir(), 'e67-lp-consent-'))
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

const files = (): string[] => [...new Set(PATCHES.map((p) => p.file))]
const count = (src: string, needle: string): number => src.split(needle).length - 1

interface FixtureOptions {
  /** Rewrite a plugin file's upstream text; null leaves the file out. */
  edit?: (file: string, src: string) => string | null
  /** The installed plugin's version. */
  installed?: string | null
  /** The app's package.json pin; null = not a dependency. */
  pin?: string | null
}

/**
 * A copy of the app: its package.json, the script and scripts/lib as they are
 * in this repo, and a plugin whose files hold the upstream (defective) bodies,
 * each between filler.
 */
function fixture(opts: FixtureOptions = {}): string {
  const app = join(TMP, `app-${++seq}`)
  mkdirSync(join(app, 'scripts/lib'), { recursive: true })
  copyFileSync(SCRIPT, join(app, 'scripts/patch-levelplay-consent.mjs'))
  for (const f of readdirSync(join(ROOT, 'scripts/lib'))) copyFileSync(join(ROOT, 'scripts/lib', f), join(app, 'scripts/lib', f))
  const pin = opts.pin === undefined ? '0.1.42' : opts.pin
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: pin === null ? {} : { 'capacitor-levelplay-ads': pin } }))
  const installed = opts.installed === undefined ? '0.1.42' : opts.installed
  if (installed === null) return app
  const pkg = PLUGIN_IN(app)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'capacitor-levelplay-ads', version: installed }))
  for (const file of files()) {
    const bodies = PATCHES.filter((p) => p.file === file).map((p) => p.old)
    const upstream = `// upstream ${file}\n\n${bodies.join('\n\n    // unrelated code\n\n')}\n\n// end\n`
    const src = opts.edit ? opts.edit(file, upstream) : upstream
    if (src === null) continue
    mkdirSync(dirname(join(pkg, file)), { recursive: true })
    writeFileSync(join(pkg, file), src)
  }
  return app
}

const read = (app: string, file: string): string => readFileSync(join(PLUGIN_IN(app), file), 'utf8')
const snapshot = (app: string): Record<string, string | null> =>
  Object.fromEntries(
    files().map((f) => {
      const path = join(PLUGIN_IN(app), f)
      return [f, existsSync(path) ? readFileSync(path, 'utf8') : null]
    }),
  )

/** Run the copy's script — from a different directory, as a hand-run would be. */
function run(app: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(app, 'scripts/patch-levelplay-consent.mjs')], { cwd: TMP, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('the eleven patches', () => {
  it('are exactly the five fixes, in eleven places, across four files', () => {
    expect(PATCHES.map((p) => p.marker).sort()).toEqual([
      'PATCHED-CONSENT-ORDER',
      'PATCHED-CONSENT-ORDER',
      'PATCHED-CUSTOM-STATUS',
      'PATCHED-CUSTOM-STATUS',
      'PATCHED-EQUAL-BUTTONS',
      'PATCHED-EQUAL-BUTTONS',
      'PATCHED-GDPR-FRESH',
      'PATCHED-NO-TCF-STUB',
      'PATCHED-NO-TCF-STUB',
      'PATCHED-NO-TCF-STUB',
      'PATCHED-NO-TCF-STUB',
    ])
    expect(files()).toHaveLength(4)
    expect(new Set(PATCHES.map((p) => p.label)).size).toBe(PATCHES.length)
    for (const p of PATCHES) {
      expect(count(p.new, `${p.marker} (scripts/patch-levelplay-consent.mjs)`), p.label).toBe(1)
      expect(p.old, p.label).not.toMatch(/PATCHED-/)
      expect(p.new.includes(p.old), `${p.label}: the patched body must not contain the defective one`).toBe(false)
    }
  })

  it('keep PATCHED-CONSENT-ORDER at exactly one per TcfPrefs file — the count the release gates pin', () => {
    for (const p of PATCHES.filter((x) => x.file.endsWith('TcfPrefs.swift') || x.file.endsWith('TcfPrefs.java'))) {
      expect(count(p.new, 'PATCHED-CONSENT-ORDER'), p.label).toBe(1)
    }
  })

  it('custom status: only the app’s own recorded answer counts — the IABTCF_* keys are no longer read first', () => {
    const ios = PATCHES.find((p) => p.label.startsWith('iOS LevelPlayAdsImpl.swift consentStatus'))!
    const android = PATCHES.find((p) => p.label.startsWith('Android CustomModalConsentProvider.java getStatus'))!
    for (const p of [ios, android]) {
      expect(p.old, p.label).toMatch(/TcfPrefs\.hasDecision/)
      expect(p.new, p.label).not.toMatch(/TcfPrefs\.hasDecision/)
    }
    expect(ios.new).toMatch(/return "UNKNOWN"/)
  })

  it('GDPR map: every decision overwrites "all" and reaches setGDPRConsent(_:)', () => {
    const p = PATCHES.find((x) => x.marker === 'PATCHED-GDPR-FRESH')!
    expect(p.old).toMatch(/if gdprConsents\.isEmpty/)
    expect(p.new).not.toMatch(/if gdprConsents\.isEmpty/)
    expect(p.new).toMatch(/LPMPrivacySettings\.setGDPRConsent\(granted\)/)
  })

  it('equal buttons: Decline is no longer .cancel, and the policy link reads privacyButtonText', () => {
    const ios = PATCHES.find((p) => p.label.startsWith('iOS LevelPlayAdsImpl.swift showConsentModal'))!
    expect(ios.old).toMatch(/style: \.cancel/)
    expect(ios.new).not.toMatch(/style: \.cancel/)
    expect(ios.new).not.toMatch(/\.preferredAction\s*=/)
    expect(count(ios.new, 'style: .default')).toBe(3)
    expect(ios.new).toMatch(/options\["privacyButtonText"\]/)
    const android = PATCHES.find((p) => p.label === 'Android CustomModalConsentProvider.java privacy button')!
    expect(android.old).toMatch(/setNeutralButton\("Privacy policy"/)
    expect(android.new).toMatch(/opts\.getString\("privacyButtonText", "Privacy policy"\)/)
  })

  it('no TCF stub: an answer clears the IABTCF_* keys instead of writing gdprApplies=0, and a stored one drops the old stub', () => {
    const stub = PATCHES.filter((p) => p.marker === 'PATCHED-NO-TCF-STUB')
    expect(stub).toHaveLength(4)
    for (const p of stub) {
      expect(p.new, p.label).not.toMatch(/writeStub/)
      expect(p.new, p.label).toMatch(/TcfPrefs\.clear\((context)?\)/)
    }
    for (const p of stub.filter((x) => /storeConsent|store\(\)/.test(x.label))) expect(p.old, p.label).toMatch(/writeStub/)
  })
})

describe('running the script', () => {
  it('applies all eleven to an upstream-shaped plugin', () => {
    const app = fixture()
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    for (const p of PATCHES) {
      const src = read(app, p.file)
      expect(src, p.label).toContain(p.new)
      expect(src, p.label).not.toContain(p.old)
    }
  })

  it('patches the app it belongs to whatever the working directory — never this repo', () => {
    const app = fixture()
    const before = readFileSync(join(PLUGIN, PATCHES[0].file), 'utf8')
    expect(run(app).status).toBe(0)
    expect(readFileSync(join(PLUGIN, PATCHES[0].file), 'utf8')).toBe(before)
  })

  it('is idempotent: a second run reports eleven already patched and writes nothing', () => {
    const app = fixture()
    expect(run(app).status).toBe(0)
    const once = snapshot(app)
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('already patched (11 patches)')
    expect(snapshot(app)).toEqual(once)
  })

  it('upgrades a plugin that carries only PATCHED-CONSENT-ORDER (every Exactly 67 tree before option A), leaving those bodies byte-identical', () => {
    const app = fixture({
      edit: (file, src) => {
        let out = src
        for (const p of PATCHES.filter((x) => x.file === file && x.marker === 'PATCHED-CONSENT-ORDER')) out = out.replace(p.old, p.new)
        return out
      },
    })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('2 of 11 patches were already in place')
    for (const f of files().filter((x) => x.includes('TcfPrefs'))) expect(read(app, f)).toBe(before[f])
    for (const p of PATCHES) expect(read(app, p.file), p.label).toContain(p.new)
  })

  it('ALL-OR-NOTHING: one body in an unknown shape fails loudly and no file is touched', () => {
    const app = fixture({
      edit: (file, src) =>
        file.endsWith('CustomModalConsentProvider.java') ? src.replace('TcfPrefs.hasDecision(context)', 'TcfPrefs.decided(context)') : src,
    })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('no longer matches the known-defective form')
    expect(snapshot(app)).toEqual(before)
  })

  it('fails loudly on a missing file, and writes nothing', () => {
    const app = fixture({ edit: (file, src) => (file.endsWith('LevelPlayAdsImpl.swift') ? null : src) })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('MISSING')
    expect(snapshot(app)).toEqual(before)
  })

  it('fails on a body that appears twice — only the first would be patched, silently', () => {
    const p = PATCHES.find((x) => x.marker === 'PATCHED-NO-TCF-STUB')!
    const app = fixture({ edit: (file, src) => (file === p.file ? `${src}\n\n${p.old}\n` : src) })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('more than once')
    expect(snapshot(app)).toEqual(before)
  })

  it('fails on a marker whose body is not the expected one — an edited patch is not a proven one', () => {
    const p = PATCHES.find((x) => x.marker === 'PATCHED-GDPR-FRESH')!
    const app = fixture({
      edit: (file, src) => (file === p.file ? src.replace(p.old, `    // ${p.marker} (scripts/patch-levelplay-consent.mjs)\n    // hand-edited\n`) : src),
    })
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('not the expected patched body')
  })

  it('fails on a patched body found twice, or beside the defective one — a file edited by hand', () => {
    const p = PATCHES.find((x) => x.marker === 'PATCHED-EQUAL-BUTTONS' && x.file.endsWith('.swift'))!
    const app = fixture({ edit: (file, src) => (file === p.file ? `${src}\n\n${p.new}\n` : src) })
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('carries the patched body twice, or beside the defective one')
  })

  it('refuses any plugin version but 0.1.42 — the bodies were verified against that tarball alone', () => {
    const app = fixture({ installed: '0.1.43' })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('0.1.42')
    expect(snapshot(app)).toEqual(before)
  })

  it('refuses a caret pin, which would let npm move the plugin under the patches', () => {
    const r = run(fixture({ pin: '^0.1.42' }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('Pin it exactly')
  })

  it('a plugin declared but not installed is a hard stop, never a skip', () => {
    const r = run(fixture({ installed: null }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('cannot resolve it')
  })

  it('skips quietly in an app that does not depend on the plugin', () => {
    const r = run(fixture({ pin: null, installed: null }))
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('nothing to patch')
  })
})

describe('the installed plugin', () => {
  // The tree the iOS build compiles (CapApp-SPM points at node_modules). A
  // targeted `npm install <pkg>` can skip postinstall; this is where it shows.
  it.skipIf(!existsSync(join(PLUGIN, 'package.json')))(
    'carries all eleven patched bodies — run `node scripts/patch-levelplay-consent.mjs` if not',
    () => {
      for (const p of PATCHES) {
        const src = readFileSync(join(PLUGIN, p.file), 'utf8')
        expect(src, `${p.label}: run node scripts/patch-levelplay-consent.mjs`).toContain(p.new)
        expect(src, p.label).not.toContain(p.old)
      }
    },
  )
})
