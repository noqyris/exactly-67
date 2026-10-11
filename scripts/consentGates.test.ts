import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The release gates refuse a plugin without its consent patches: every sync
 * chain through scripts/check-native-sync.mjs (and the fastlane archive and
 * ad_gate lanes, which re-run it), and every Xcode build through
 * ios/App/ad-mode-guard.sh. Each keeps its own table on purpose — removing a
 * patch from the patch script must not quietly remove its gate — so this suite
 * proves the tables agree with what the patch script writes, and runs the
 * Xcode guard itself against a patched and an unpatched tree.
 */

interface Patch {
  marker: string
  file: string
  old: string
  new: string
}
type Row = [file: string, marker: string, count: number]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GUARD = join(ROOT, 'ios/App/ad-mode-guard.sh')

let PATCHES: Patch[] = []
let MARKERS: { ios: Row[]; android: Row[] } = { ios: [], android: [] }
let problems: (pluginDir: string, platform: string) => string[] = () => []
let TMP = ''
let seq = 0
beforeAll(async () => {
  PATCHES = ((await import(pathToFileURL(join(ROOT, 'scripts/patch-levelplay-consent.mjs')).href)) as { PATCHES: Patch[] }).PATCHES
  const lib = (await import(pathToFileURL(join(ROOT, 'scripts/lib/consent-patch-markers.mjs')).href)) as {
    CONSENT_PATCH_MARKERS: { ios: Row[]; android: Row[] }
    consentPatchProblems: typeof problems
  }
  MARKERS = lib.CONSENT_PATCH_MARKERS
  problems = lib.consentPatchProblems
  TMP = mkdtempSync(join(tmpdir(), 'e67-consent-gates-'))
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

/** What a fully patched plugin carries: each (file, marker) once per patch body that names it. */
function expectedRows(platform: 'ios' | 'android'): Row[] {
  const n = new Map<string, number>()
  for (const p of PATCHES.filter((x) => x.file.startsWith(`${platform}/`))) {
    const key = `${p.file}\u0000${p.marker}`
    n.set(key, (n.get(key) ?? 0) + 1)
  }
  return [...n].map(([key, c]) => [...(key.split('\u0000') as [string, string]), c] as Row)
}

const sortRows = (rows: Row[]): Row[] => [...rows].sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))

/** A plugin directory with every patched file, patched (or upstream). */
function plugin(patched: boolean): string {
  const dir = join(TMP, `plugin-${++seq}`)
  for (const file of new Set(PATCHES.map((p) => p.file))) {
    const bodies = PATCHES.filter((p) => p.file === file).map((p) => (patched ? p.new : p.old))
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), `// ${file}\n\n${bodies.join('\n\n')}\n`)
  }
  return dir
}

describe('the gate tables match what the patch script writes', () => {
  it('scripts/lib/consent-patch-markers.mjs — iOS and Android', () => {
    expect(sortRows(MARKERS.ios)).toEqual(sortRows(expectedRows('ios')))
    expect(sortRows(MARKERS.android)).toEqual(sortRows(expectedRows('android')))
  })

  it('ios/App/ad-mode-guard.sh carries the same iOS rows, at the same counts', () => {
    const src = readFileSync(GUARD, 'utf8')
    const rows = [...src.matchAll(/^need_patch (\S+) (PATCHED-[A-Z-]+) (\d+)$/gm)].map((m) => [m[1], m[2], Number(m[3])] as Row)
    const want = expectedRows('ios').map(([file, marker, c]) => [basename(file), marker, c] as Row)
    expect(sortRows(rows)).toEqual(sortRows(want))
    expect(src).toContain('lp="$SRCROOT/../../node_modules/capacitor-levelplay-ads/ios/Sources/LevelPlayAdsPlugin"')
  })

  it('scripts/check-native-sync.mjs applies the table for the platform it checks', () => {
    const src = readFileSync(join(ROOT, 'scripts/check-native-sync.mjs'), 'utf8')
    expect(src).toMatch(/import \{ consentPatchProblems \} from '\.\/lib\/consent-patch-markers\.mjs'/)
    expect(src).toMatch(/consentPatchProblems\(pluginDir, platform\)/)
  })
})

describe('consentPatchProblems — what check-native-sync refuses', () => {
  it('a fully patched plugin passes on both platforms', () => {
    const dir = plugin(true)
    expect(problems(dir, 'ios')).toEqual([])
    expect(problems(dir, 'android')).toEqual([])
  })

  it('the upstream plugin fails on every row', () => {
    const dir = plugin(false)
    expect(problems(dir, 'ios')).toHaveLength(MARKERS.ios.length)
    expect(problems(dir, 'android')).toHaveLength(MARKERS.android.length)
  })

  it('a missing file is named, and so is a marker seen the wrong number of times', () => {
    const dir = plugin(true)
    unlinkSync(join(dir, MARKERS.ios[0][0]))
    const impl = join(dir, 'ios/Sources/LevelPlayAdsPlugin/LevelPlayAdsImpl.swift')
    writeFileSync(impl, readFileSync(impl, 'utf8').replace('PATCHED-NO-TCF-STUB', 'NO-STUB'))
    const found = problems(dir, 'ios')
    expect(found.some((p) => p.includes('TcfPrefs.swift is missing'))).toBe(true)
    expect(found.some((p) => p.includes('PATCHED-NO-TCF-STUB ×1, expected ×2'))).toBe(true)
  })
})

describe('the Xcode guard refuses an unpatched plugin on every build', () => {
  const SCENE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UIApplicationSceneManifest</key>
  <dict>
    <key>UIApplicationSupportsMultipleScenes</key>
    <false/>
    <key>UISceneConfigurations</key>
    <dict>
      <key>UIWindowSceneSessionRoleApplication</key>
      <array>
        <dict>
          <key>UISceneDelegateClassName</key>
          <string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
        </dict>
      </array>
    </dict>
  </dict>
</dict>
</plist>
`

  /** A repo tree as the guard sees it from SRCROOT: an ads-off bundle, and the plugin under ../../node_modules. */
  function tree(patched: boolean): string {
    const root = join(TMP, `repo-${++seq}`)
    const app = join(root, 'ios/App/App')
    mkdirSync(join(app, 'public/assets'), { recursive: true })
    writeFileSync(join(app, 'Info.plist'), SCENE_PLIST)
    writeFileSync(join(app, 'SceneDelegate.swift'), '// scene delegate\n')
    // Built from pieces: this file must not carry the bundle markers itself.
    writeFileSync(join(app, 'public/assets/index.js'), `const a="${['ADMODE', 'test'].join(':')}";const b="${['ADS', 'off'].join(':')}";`)
    const lp = join(root, 'node_modules/capacitor-levelplay-ads')
    for (const file of new Set(PATCHES.map((p) => p.file))) {
      const bodies = PATCHES.filter((p) => p.file === file).map((p) => (patched ? p.new : p.old))
      mkdirSync(dirname(join(lp, file)), { recursive: true })
      writeFileSync(join(lp, file), `// ${file}\n\n${bodies.join('\n\n')}\n`)
    }
    return root
  }

  function guard(root: string, action = 'build'): { status: number | null; out: string } {
    const r = spawnSync('/bin/sh', [GUARD], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SRCROOT: join(root, 'ios/App'), ACTION: action },
      encoding: 'utf8',
    })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }

  const macOnly = process.platform !== 'darwin' // the guard reads Info.plist with PlistBuddy

  it.skipIf(macOnly)('a patched plugin passes — an ads-off Run builds', () => {
    const r = guard(tree(true))
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('ads-off bundle (ADS:off)')
  })

  it.skipIf(macOnly)('an unpatched plugin never builds — not a Run, not an Archive', () => {
    for (const action of ['build', 'install']) {
      const r = guard(tree(false), action)
      expect(r.status, `${action}: ${r.out}`).toBe(1)
      expect(r.out).toContain('missing its consent patches')
      expect(r.out).toContain('LevelPlayAdsImpl.swift has PATCHED-NO-TCF-STUB x0 (expected x2)')
    }
  })

  it.skipIf(macOnly)('one patch short is enough to refuse, and a missing file is named', () => {
    const root = tree(true)
    const lp = join(root, 'node_modules/capacitor-levelplay-ads/ios/Sources/LevelPlayAdsPlugin')
    writeFileSync(join(lp, 'LevelPlayAdsImpl.swift'), readFileSync(join(lp, 'LevelPlayAdsImpl.swift'), 'utf8').replace('PATCHED-EQUAL-BUTTONS', 'EQUAL'))
    unlinkSync(join(lp, 'TcfPrefs.swift'))
    const r = guard(root)
    expect(r.status).toBe(1)
    expect(r.out).toContain('TcfPrefs.swift is missing')
    expect(r.out).toContain('LevelPlayAdsImpl.swift has PATCHED-EQUAL-BUTTONS x0 (expected x1)')
  })
})
