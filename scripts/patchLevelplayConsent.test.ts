import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * scripts/patch-levelplay-consent.mjs fixes the plugin's custom CMP in fifteen
 * places: the decline that read back as consent (PATCHED-CONSENT-ORDER ×2, the
 * only one Exactly 67 had until option A), an IAB TCF record left by another
 * CMP read as OUR answer (PATCHED-CUSTOM-STATUS ×2), the first answer of a
 * process sticking in the iOS GDPR map (PATCHED-GDPR-FRESH), Decline styled
 * apart from Accept and an English policy link (PATCHED-EQUAL-BUTTONS ×2), and
 * the fake TCF record that told every SDK GDPR does not apply
 * (PATCHED-NO-TCF-STUB ×4), and a refusal told to an SDK that was never started
 * (PATCHED-QUIET-REFUSAL ×4, both platforms). A silently un-applied consent patch is worse than
 * none, so these tests run the real script — in a throwaway copy of the app,
 * because it finds the app from its own location, never from the working
 * directory — against an upstream-shaped plugin, and prove: every patch lands,
 * a re-run changes nothing, ANY shape mismatch writes NOTHING, the exact 0.1.42
 * pin is enforced — and then that the installed plugin really carries all fifteen.
 */

interface Patch {
  marker: string
  label: string
  file: string
  old: string
  new: string
  /** The label of an earlier part whose body this one is written inside. */
  inside?: string
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/patch-levelplay-consent.mjs')
const PLUGIN = join(ROOT, 'node_modules/capacitor-levelplay-ads')
const PLUGIN_IN = (app: string) => join(app, 'node_modules/capacitor-levelplay-ads')

let PATCHES: Patch[] = []
/** A part's body as a fully patched file holds it — its `new`, with any later part written inside it applied. */
let settled: (p: Patch) => string = (p) => p.new
let TMP = ''
let seq = 0
beforeAll(async () => {
  // Importing does not patch: the script runs its main() only when node runs it.
  const script = (await import(pathToFileURL(SCRIPT).href)) as { PATCHES: Patch[]; settled: (p: Patch) => string }
  PATCHES = script.PATCHES
  settled = script.settled
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
 * each between filler. A part written inside another part's body (`inside`)
 * has no upstream text of its own: its `old` appears once the earlier part is in.
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
    const bodies = PATCHES.filter((p) => p.file === file && !p.inside).map((p) => p.old)
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

describe('the fifteen patches', () => {
  it('are exactly the six fixes, in fifteen places, across six files', () => {
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
      'PATCHED-QUIET-REFUSAL',
      'PATCHED-QUIET-REFUSAL',
      'PATCHED-QUIET-REFUSAL',
      'PATCHED-QUIET-REFUSAL',
    ])
    expect(files()).toHaveLength(6)
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

describe('the quiet refusal: a no is not told to an SDK that is not running', () => {
  const IOS_IMPL = 'ios/Sources/LevelPlayAdsPlugin/LevelPlayAdsImpl.swift'
  const CORE = 'android/src/main/java/com/capacitor/plugins/levelplay'
  const quiet = (): Patch[] => PATCHES.filter((p) => p.marker === 'PATCHED-QUIET-REFUSAL')
  const part = (label: string): Patch => quiet().find((p) => p.label.includes(label))!
  const host = (): Patch => PATCHES.find((p) => p.marker === 'PATCHED-GDPR-FRESH')!
  /** A body without its comment lines, trimmed. */
  const code = (body: string): string[] =>
    body
      .split('\n')
      .filter((line) => line.trim() && !/^\s*(\/\/|\/\*\*?|\*)/.test(line))
      .map((line) => line.trim())
  /** Every file with extension `ext` under `dir`. */
  const sources = (dir: string, ext: string): string[] => {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const path = join(d, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (name.endsWith(ext)) out.push(path)
      }
    }
    walk(dir)
    return out
  }

  it('is four places — two on each platform — under one marker', () => {
    expect(quiet().map((p) => p.label)).toEqual([
      'iOS LevelPlayAdsImpl.swift initialize() marks the SDK started',
      'iOS LevelPlayAdsImpl.swift applyUserConsent() keeps a refusal from an idle SDK',
      'Android PrivacyExecutor.java setUserConsent() keeps a refusal from an idle SDK',
      'Android LevelPlayAdsPlugin.java initialize() marks the SDK started',
    ])
    expect(quiet().map((p) => p.file)).toEqual([IOS_IMPL, IOS_IMPL, `${CORE}/privacy/PrivacyExecutor.java`, `${CORE}/LevelPlayAdsPlugin.java`])
    for (const p of quiet()) {
      // One marker per place — the counts the gates pin (iOS ×2; Android ×1 + ×1) —
      // and no other part's marker: a second PATCHED-GDPR-FRESH in the iOS file
      // would trip the gates that count it.
      expect(p.new.match(/PATCHED-[A-Z-]+/g), p.label).toEqual(['PATCHED-QUIET-REFUSAL'])
    }
  })

  it('a yes is never held back: only `granted == false` is, on either platform', () => {
    expect(code(part('PrivacyExecutor').new)).toContain('final boolean tell = granted || adSdkStarted;')
    expect(code(part('applyUserConsent').new)).toContain('if !granted && !LevelPlayAdsImpl.adSdkStarted { return }')
  })

  describe('iOS', () => {
    it('is one line of applyUserConsent(), after the books and before both SDK calls', () => {
      const gate = part('applyUserConsent')
      const body = code(settled(host()))
      expect(body.slice(body.indexOf('#if canImport(IronSource)') + 1, body.indexOf('#endif'))).toEqual([
        'for network in networks where !network.isEmpty {',
        'gdprConsents[network] = NSNumber(value: granted)',
        '}',
        'gdprConsents["all"] = NSNumber(value: granted)',
        'if !granted && !LevelPlayAdsImpl.adSdkStarted { return }',
        'LPMPrivacySettings.setGDPRConsents(gdprConsents)',
        'LPMPrivacySettings.setGDPRConsent(granted)',
      ])
      // Take the gate away and the body is the one that shipped in 1.3.1, line for line.
      expect(code(settled(host())).filter((l) => l !== 'if !granted && !LevelPlayAdsImpl.adSdkStarted { return }')).toEqual(code(host().new))
      expect(code(gate.new).filter((l) => l !== 'if !granted && !LevelPlayAdsImpl.adSdkStarted { return }')).toEqual(code(gate.old))
    })

    it('is written INSIDE the body of PATCHED-GDPR-FRESH, which stays as it shipped', () => {
      const gate = part('applyUserConsent')
      expect(gate.inside).toBe(host().label)
      expect(PATCHES.indexOf(host())).toBeLessThan(PATCHES.indexOf(gate))
      expect(gate.file).toBe(host().file)
      expect(count(host().new, gate.old)).toBe(1)
      // A body that changes cannot be recognised in a plugin that already carries
      // it — the same bytes as the canonical copy and KVIZKO.
      expect(createHash('sha256').update(host().new).digest('hex')).toBe('ebd3c79d0f93e60566fae518f01e59871824f192f90b16f643280fda8fbcb1a0')
      // In a patched file the host reads with the gate in it, and carries both markers once each.
      expect(settled(host())).not.toBe(host().new)
      expect(count(settled(host()), 'PATCHED-GDPR-FRESH')).toBe(1)
      expect(count(settled(host()), 'PATCHED-QUIET-REFUSAL')).toBe(1)
    })

    it('"running" is one process-wide flag, set where initialize() commits to starting the SDK and never cleared', () => {
      const src = part('initialize() marks the SDK started')
      expect(src.file).toBe(IOS_IMPL)
      const lines = code(src.new)
      expect(lines).toContain('private static var adSdkStarted = false')
      expect(count(src.new, 'adSdkStarted = true')).toBe(1)
      expect(count(src.new, 'adSdkStarted = false')).toBe(1) // the declaration
      // After upstream's two early returns and its own `initializing = true`: the flag,
      // then the refusal that was kept back — which now passes the gate.
      const at = lines.indexOf('initializing = true')
      expect(lines.slice(at - 2, at + 3)).toEqual([
        'if initialized { completion(true, nil); return }',
        'if initializing { completion(false, "LevelPlay is already initializing."); return }',
        'initializing = true',
        'LevelPlayAdsImpl.adSdkStarted = true',
        'if consentStatus() == "DENIED" { applyUserConsent(granted: false, networks: []) }',
      ])
      // Upstream's lines are all still there, in order.
      expect(lines.filter((l) => !/adSdkStarted|consentStatus\(\) == "DENIED"/.test(l))).toEqual(code(src.old))
    })
  })

  describe('Android', () => {
    it('keeps the books and makes both SDK calls wait — and nothing else in setUserConsent() moved', () => {
      const p = part('PrivacyExecutor')
      const method = p.new.slice(0, p.new.indexOf('\n    }\n') + '\n    }\n'.length)
      const lines = code(method)
      expect(lines.filter((l) => /LevelPlay\w*\./.test(l))).toEqual([
        'if (tell) LevelPlay.setConsent(granted);',
        'LevelPlayPrivacySettings.setGDPRConsents(new HashMap<>(gdprConsents));',
      ])
      // Take the gate away and the method is upstream's, line for line.
      const ungated = lines
        .filter((l) => l !== 'final boolean tell = granted || adSdkStarted;')
        .map((l) => l.replace('if (tell) LevelPlay.setConsent', 'LevelPlay.setConsent').replace('if (tell && !gdprConsents', 'if (!gdprConsents'))
      expect(ungated).toEqual(code(p.old))
    })

    it('"running" is one process-wide flag, and the start tells the SDK a stored no first', () => {
      const src = part('PrivacyExecutor').new
      expect(src).toContain('private static volatile boolean adSdkStarted = false;')
      expect(count(src, 'adSdkStarted = true')).toBe(1)
      const starting = code(src.slice(src.indexOf('public void adSdkStarting(boolean storedRefusal) {')))
      expect(starting.slice(0, 4)).toEqual(['public void adSdkStarting(boolean storedRefusal) {', 'adSdkStarted = true;', 'if (storedRefusal) setUserConsent(false, null);', '}'])
      // Not the two the plugin already kept: both are false again after a start that failed.
      expect(code(src).join(' ')).not.toMatch(/isInitialized|initializing/)
      expect(code(part('LevelPlayAdsPlugin.java').new)).toEqual([
        'Boolean isTesting = call.getBoolean("isTesting", false);',
        'privacyExecutor.adSdkStarting(consentProvider.getStatus() == ConsentStatus.DENIED);',
        'coreImplementation.initialize(',
      ])
    })
  })

  it('the other consent path and the two privacy flags are not touched', () => {
    // persistConsent() → applyNetworkConsents / setUserConsents: a consent screen drawn in JS, which this app does not have.
    for (const p of quiet()) expect(`${p.old}${p.new}`, p.label).not.toMatch(/applyNetworkConsents|setUserConsents|setCCPA|setCOPPA|persistConsent/)
  })

  it('no part rewrites inside another part’s body unless it says so — and this is the only one that does', () => {
    const pairs: string[] = []
    for (const p of PATCHES) {
      for (const q of PATCHES) {
        if (p === q || p.file !== q.file || !p.new.includes(q.old)) continue
        pairs.push(`${q.label} ⊂ ${p.label}`)
        expect(q.inside, q.label).toBe(p.label)
      }
    }
    expect(pairs).toEqual([`${part('applyUserConsent').label} ⊂ ${host().label}`])
    for (const p of PATCHES.filter((x) => !PATCHES.some((q) => q.inside === x.label))) expect(settled(p), p.label).toBe(p.new)
  })

  // The plugin as Xcode (and Gradle) compile it.
  describe.skipIf(!existsSync(join(PLUGIN, 'package.json')))('in the installed plugin', () => {
    const swift = (): string => readFileSync(join(PLUGIN, IOS_IMPL), 'utf8')

    it('iOS: every call that hands GDPR consent to the SDK is accounted for', () => {
      const callers = sources(join(PLUGIN, 'ios/Sources'), '.swift').filter((f) => /LPMPrivacySettings\.setGDPRConsents?\(/.test(code(readFileSync(f, 'utf8')).join('\n')))
      expect(callers.map((f) => f.slice(join(PLUGIN, 'ios/Sources/LevelPlayAdsPlugin').length + 1))).toEqual(['LevelPlayAdsImpl.swift'])
      const lines = code(swift())
      const func = (name: string): string[] => {
        const from = lines.findIndex((l) => l.startsWith(`public func ${name}(`))
        return lines.slice(from, lines.findIndex((l, i) => i > from && /^(public |private )?func /.test(l)))
      }
      const apply = func('applyUserConsent')
      const gate = apply.indexOf('if !granted && !LevelPlayAdsImpl.adSdkStarted { return }')
      expect(gate).toBeGreaterThan(0)
      expect(apply.slice(0, gate).join('\n')).not.toMatch(/LPMPrivacySettings|LevelPlay\./)
      expect(apply.slice(gate + 1).filter((l) => /LPMPrivacySettings/.test(l))).toEqual(['LPMPrivacySettings.setGDPRConsents(gdprConsents)', 'LPMPrivacySettings.setGDPRConsent(granted)'])
      // persistConsent()'s path: as upstream wrote it.
      expect(func('applyNetworkConsents').filter((l) => /LPMPrivacySettings/.test(l))).toEqual(['LPMPrivacySettings.setGDPRConsents(gdprConsents)'])
      expect(count(lines.join('\n'), 'LPMPrivacySettings.setGDPRConsent(')).toBe(1)
      expect(count(lines.join('\n'), 'LPMPrivacySettings.setGDPRConsents(')).toBe(2)
    })

    it('iOS: the flag is set in initialize() alone, before the SDK’s own start, and nothing clears it', () => {
      const all = sources(join(PLUGIN, 'ios/Sources'), '.swift').map((f) => code(readFileSync(f, 'utf8')).join('\n')).join('\n')
      expect(count(all, 'adSdkStarted = true')).toBe(1)
      expect(count(all, 'private static var adSdkStarted = false')).toBe(1)
      const lines = code(swift())
      const mark = lines.indexOf('LevelPlayAdsImpl.adSdkStarted = true')
      expect(lines[mark - 1]).toBe('initializing = true')
      expect(lines[mark + 1]).toBe('if consentStatus() == "DENIED" { applyUserConsent(granted: false, networks: []) }')
      const start = lines.findIndex((l) => l.startsWith('LevelPlay.initWith('))
      expect(start).toBeGreaterThan(mark)
      expect(count(lines.join('\n'), 'LevelPlay.initWith(')).toBe(1)
      expect(lines.filter((l) => l.includes('adSdkStarted'))).toEqual([
        'private static var adSdkStarted = false',
        'LevelPlayAdsImpl.adSdkStarted = true',
        'if !granted && !LevelPlayAdsImpl.adSdkStarted { return }',
      ])
    })

    it('Android: the flag is set from initialize() alone, past the app-key check, right before the SDK’s start', () => {
      const all = sources(join(PLUGIN, 'android/src/main/java'), '.java').map((f) => code(readFileSync(f, 'utf8')).join('\n')).join('\n')
      expect(count(all, '.adSdkStarting(')).toBe(1)
      expect(count(all, 'adSdkStarted = true')).toBe(1)
      const plugin = code(readFileSync(join(PLUGIN, CORE, 'LevelPlayAdsPlugin.java'), 'utf8'))
      const init = plugin.slice(plugin.indexOf('public void initialize(PluginCall call) {'))
      const order = ['call.reject("appKey is required to initialize LevelPlay.");', 'privacyExecutor.adSdkStarting(consentProvider.getStatus() == ConsentStatus.DENIED);', 'coreImplementation.initialize(']
      const at = order.map((l) => init.indexOf(l))
      expect(at[0]).toBeGreaterThan(0)
      expect(at).toEqual([...at].sort((a, b) => a - b))
      expect(at[2]).toBe(at[1] + 1)
      // Both decisions of the plugin's own question go through the gated method.
      expect(count(plugin.join('\n'), 'privacyExecutor.setUserConsent(granted, networks);')).toBe(2)
    })
  })

  it('the app never calls persistConsent — the one consent path this part leaves as it was', () => {
    const app = sources(join(ROOT, 'src'), '.ts').filter((f) => !f.endsWith('.test.ts'))
    expect(app.length).toBeGreaterThan(30)
    expect(app.filter((f) => readFileSync(f, 'utf8').includes('persistConsent'))).toEqual([])
  })
})

describe('running the script', () => {
  it('applies all fifteen to an upstream-shaped plugin', () => {
    const app = fixture()
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    for (const p of PATCHES) {
      const src = read(app, p.file)
      expect(src, p.label).toContain(settled(p))
      expect(src, p.label).not.toContain(p.old)
    }
  })

  it('patches the app it belongs to whatever the working directory — never this repo', () => {
    const app = fixture()
    const before = readFileSync(join(PLUGIN, PATCHES[0].file), 'utf8')
    expect(run(app).status).toBe(0)
    expect(readFileSync(join(PLUGIN, PATCHES[0].file), 'utf8')).toBe(before)
  })

  it('is idempotent: a second run reports fifteen already patched and writes nothing', () => {
    const app = fixture()
    expect(run(app).status).toBe(0)
    const once = snapshot(app)
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('already patched (15 patches)')
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
    expect(r.out).toContain('2 of 15 patches were already in place')
    for (const f of files().filter((x) => x.includes('TcfPrefs'))) expect(read(app, f)).toBe(before[f])
    for (const p of PATCHES) expect(read(app, p.file), p.label).toContain(settled(p))
  })

  it('upgrades the 1.3.1 tree (parts 1–5): the four quiet-refusal places land and no other file moves', () => {
    const earlier = PATCHES.filter((p) => p.marker !== 'PATCHED-QUIET-REFUSAL')
    expect(earlier).toHaveLength(11)
    const app = fixture({ edit: (file, src) => earlier.filter((p) => p.file === file).reduce((out, p) => out.replace(p.old, p.new), src) })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('11 of 15 patches were already in place')
    expect(count(r.out, '(PATCHED-QUIET-REFUSAL)')).toBe(4)
    const touched = ['LevelPlayAdsImpl.swift', 'PrivacyExecutor.java', 'LevelPlayAdsPlugin.java']
    for (const f of files().filter((x) => !touched.some((t) => x.endsWith(t)))) expect(read(app, f), f).toBe(before[f])
    for (const p of PATCHES) expect(read(app, p.file), p.label).toContain(settled(p))
    // What every other part put into the iOS file is still there, byte for byte.
    for (const p of earlier.filter((x) => x.marker !== 'PATCHED-GDPR-FRESH')) expect(read(app, p.file), p.label).toContain(p.new)
    expect(run(app).out).toContain('already patched (15 patches)')
  })

  it('recognises the body a later part is written inside in both of its forms', () => {
    const host = PATCHES.find((p) => p.marker === 'PATCHED-GDPR-FRESH')!
    const gate = PATCHES.find((p) => p.inside === host.label)!
    const app = fixture({ edit: (file, src) => (file === host.file ? src.replace(host.old, host.new) : src) })
    expect(read(app, host.file)).toContain(host.new)
    expect(run(app).status).toBe(0)
    const patched = read(app, host.file)
    expect(patched).not.toContain(host.new)
    expect(patched).toContain(settled(host))
    expect(patched).toContain(gate.new)
    expect(count(patched, 'PATCHED-GDPR-FRESH')).toBe(1)
    // With the gate in it: still "already patched", not "an edited patch".
    const again = run(app)
    expect(again.status, again.out).toBe(0)
    expect(again.out).toContain('already patched (15 patches)')
    expect(read(app, host.file)).toBe(patched)
  })

  it('a gate edited by hand is not a proven one: it fails loudly and nothing is written', () => {
    const app = fixture()
    expect(run(app).status).toBe(0)
    const file = PATCHES.find((p) => p.marker === 'PATCHED-GDPR-FRESH')!.file
    const path = join(PLUGIN_IN(app), file)
    writeFileSync(path, readFileSync(path, 'utf8').replace('if !granted && !LevelPlayAdsImpl.adSdkStarted { return }', 'if !granted { return }'))
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('not the expected patched body')
    expect(snapshot(app)).toEqual(before)
  })

  it('refuses a setUserConsent() upstream has reshaped — a gate around the wrong call is no gate', () => {
    const app = fixture({
      edit: (file, src) => (file.endsWith('PrivacyExecutor.java') ? src.replace('LevelPlay.setConsent(granted);', 'LevelPlay.setConsent(granted, true);') : src),
    })
    const before = snapshot(app)
    const r = run(app)
    expect(r.status).toBe(1)
    expect(r.out).toContain('setUserConsent() keeps a refusal from an idle SDK no longer matches the known-defective form')
    expect(snapshot(app)).toEqual(before)
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
    'carries all fifteen patched bodies — run `node scripts/patch-levelplay-consent.mjs` if not',
    () => {
      for (const p of PATCHES) {
        const src = readFileSync(join(PLUGIN, p.file), 'utf8')
        expect(src, `${p.label}: run node scripts/patch-levelplay-consent.mjs`).toContain(settled(p))
        expect(src, p.label).not.toContain(p.old)
      }
    },
  )
})
