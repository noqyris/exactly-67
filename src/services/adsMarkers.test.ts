import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The build markers the release gates count, and the structural promises the
 * gates rely on.
 *
 * `scripts/check-ad-mode.mjs` proves what a bundle IS by counting plain
 * substrings: ADMODE:test|live, ADS:on|off|mock exactly once each, and
 * UNLOCKALL:1 at most once (never in a `live` bundle). Those literals are folded
 * from env at build time — so what gets folded, and where it rides so it
 * survives minification, is what these tests pin. The bundle counts themselves
 * are verified by building (see the gate); this is the source-level half.
 */

const repo = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const read = (p: string): string => readFileSync(repo(p), 'utf8')
/** Comments may name a network for history; code may not. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('ADS marker — exactly one value per build', () => {
  const cases: [string, string][] = [
    ['', 'ADS:on'],
    ['off', 'ADS:off'],
    ['mock', 'ADS:mock'],
    ['on', 'ADS:on'],
    ['OFF', 'ADS:on'], // only the exact value switches ads off
  ]
  for (const [env, marker] of cases) {
    it(`VITE_ADS=${JSON.stringify(env)} bakes ${marker}`, async () => {
      vi.stubEnv('VITE_ADS', env)
      vi.resetModules()
      const { ADS_MARKER } = await import('./adProvider')
      expect(ADS_MARKER).toBe(marker)
    })
  }

  it('no marker is a substring of another — the gates count by plain substring', () => {
    const markers = ['ADS:on', 'ADS:off', 'ADS:mock', 'ADMODE:test', 'ADMODE:live', 'UNLOCKALL:1']
    for (const a of markers) {
      for (const b of markers) {
        if (a !== b) expect(a.includes(b), `${a} must not contain ${b}`).toBe(false)
      }
    }
  })
})

describe('UNLOCKALL marker — present exactly when VITE_UNLOCK_ALL=1', () => {
  it('is the literal the gate counts under VITE_UNLOCK_ALL=1, and allLevelsUnlocked agrees', async () => {
    vi.stubEnv('VITE_UNLOCK_ALL', '1')
    vi.resetModules()
    const flags = await import('./buildFlags')
    expect(flags.UNLOCK_ALL_MARKER).toBe('UNLOCKALL:1')
    expect(flags.allLevelsUnlocked()).toBe(true)
  })

  it('is empty — so the literal folds out of the bundle — for every other value', async () => {
    for (const env of ['', '0', 'true', 'yes', ' 1', '11']) {
      vi.stubEnv('VITE_UNLOCK_ALL', env)
      vi.resetModules()
      const flags = await import('./buildFlags')
      expect(flags.UNLOCK_ALL_MARKER, JSON.stringify(env)).toBe('')
      expect(flags.allLevelsUnlocked(), JSON.stringify(env)).toBe(false)
    }
  })

  it('is stamped by live code, so the minifier cannot drop it', async () => {
    vi.stubEnv('VITE_UNLOCK_ALL', '1')
    vi.resetModules()
    const flags = await import('./buildFlags')
    const attrs: Record<string, string> = {}
    flags.stampBuildFlags({ setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLElement)
    expect(attrs['data-build-flags']).toBe('UNLOCKALL:1')
    expect(read('src/main.ts')).toMatch(/^\s*stampBuildFlags\(\)/m)
  })

  it('stamps nothing in a normal build', async () => {
    vi.stubEnv('VITE_UNLOCK_ALL', '')
    vi.resetModules()
    const flags = await import('./buildFlags')
    const attrs: Record<string, string> = {}
    flags.stampBuildFlags({ setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLElement)
    expect(attrs).toEqual({})
  })

  it('the literal appears exactly once in the source, so it can appear at most once in a bundle', () => {
    const shipped = ['src/services/buildFlags.ts', 'src/services/ads.ts', 'src/services/adProvider.ts', 'src/main.ts']
    const total = shipped.map((f) => codeOnly(read(f)).split('UNLOCKALL:1').length - 1).reduce((a, b) => a + b, 0)
    expect(total).toBe(1)
  })
})

describe('the providers carry the markers on `id`, and agree on the contract', () => {
  it('LevelPlay: ADMODE folded from VITE_AD_MODE, ADS from the seam', () => {
    const levelplay = read('src/services/providers/levelplay.ts')
    expect(levelplay).toMatch(/const TESTING = import\.meta\.env\.VITE_AD_MODE !== 'live'/)
    expect(levelplay).toMatch(/const AD_MODE_MARKER = TESTING \? 'ADMODE:test' : 'ADMODE:live'/)
    expect(levelplay).toMatch(/id: `levelplay \$\{AD_MODE_MARKER\} \$\{ADS_MARKER\}`/)
  })

  it('the mock is always ADMODE:test and carries ADS:mock in a mock build', async () => {
    vi.stubEnv('VITE_ADS', 'mock')
    vi.resetModules()
    const { mockProvider } = await import('./providers/mock')
    expect(mockProvider.id).toContain('ADS:mock')
    expect(mockProvider.id).toContain('ADMODE:test')
    expect(mockProvider.id).not.toContain('ADMODE:live')
  })

  it('both report testing=false — there is no safe-to-tap build on this network', async () => {
    vi.stubEnv('VITE_ADS', 'mock')
    vi.resetModules()
    const { mockProvider } = await import('./providers/mock')
    expect(mockProvider.testing).toBe(false)
    expect(read('src/services/providers/levelplay.ts')).toMatch(/^\s*testing: false,$/m)
  })

  it('the mock matches LevelPlay on the contract that decides waits', async () => {
    vi.resetModules()
    const { mockProvider } = await import('./providers/mock')
    expect(mockProvider.resolvesOnPresent('interstitial')).toBe(true)
    expect(mockProvider.resolvesOnPresent('rewarded')).toBe(false)
    for (const f of ['banner', 'interstitial', 'rewarded'] as const) expect(mockProvider.supports(f)).toBe(true)
  })

  it('the policy picks the provider with an INLINE env read, so the other one tree-shakes out', () => {
    // Through the adsMock() helper the bundler could not fold the choice, and a
    // store bundle would carry the fake provider — and a second ADMODE marker.
    expect(read('src/services/ads.ts')).toMatch(
      /const provider = import\.meta\.env\.VITE_ADS === 'mock' \? mockProvider : levelplayProvider/,
    )
  })

  it('the mock banner is the height of the reserved strip', () => {
    expect(read('src/services/providers/mock.ts')).toMatch(/height: `\$\{BANNER_RESERVE_DESIGN_PX\}px`/)
  })
})

describe('the old ad stack is gone', () => {
  it('no TEST ADS badge — on LevelPlay it would paint "safe to tap" onto live ads', async () => {
    expect(existsSync(repo('src/testAdsBadge.ts'))).toBe(false)
    expect(read('src/main.ts')).not.toMatch(/testAdsBadge|isTestAds/)
    const ads = await import('./ads')
    expect('isTestAds' in ads).toBe(false)
  })

  it('no Google ad plugin, unit id or app-open code anywhere in the ad layer', () => {
    // Spelled in pieces so this file does not itself trip the repo-wide grep for
    // the old network's name and unit-id prefix that it is enforcing.
    const oldNetwork = new RegExp(['ad', 'mob'].join(''), 'i')
    const oldUnitPrefix = ['ca', 'app', 'pub'].join('-')
    for (const f of [
      'src/main.ts',
      'src/services/ads.ts',
      'src/services/adProvider.ts',
      'src/services/providers/levelplay.ts',
      'src/services/providers/mock.ts',
      'src/render/GameScene.ts',
      'src/render/MenuScene.ts',
    ]) {
      const src = read(f)
      expect(src, f).not.toMatch(oldNetwork)
      expect(src, f).not.toContain(oldUnitPrefix)
      expect(codeOnly(src), f).not.toMatch(/appOpen|app-open/i)
    }
  })

  it('scenes reach ads only through the policy layer', () => {
    for (const f of ['src/render/GameScene.ts', 'src/render/MenuScene.ts', 'src/render/StoreScene.ts', 'src/main.ts']) {
      const src = read(f)
      expect(src, f).not.toContain('capacitor-levelplay-ads')
      expect(src, f).not.toMatch(/providers\//)
    }
  })
})
