/// <reference types="vite/client" />

/**
 * The build-time switches Exactly 67 reads. Vite folds every read to a literal,
 * so an unset variable is `undefined` here, a dead branch is tree-shaken, and
 * the release gate (`scripts/check-ad-mode.mjs`) can prove what a bundle is by
 * counting the markers each one bakes in.
 */
interface ImportMetaEnv {
  /**
   * `live` declares an App Store build — marker ADMODE:live. Anything else is
   * ADMODE:test. On LevelPlay neither value selects test inventory: every
   * ADS:on build serves real ads. Read in src/services/providers/levelplay.ts.
   */
  readonly VITE_AD_MODE?: string
  /**
   * `off` — no ad surface at all (TestFlight follow-up, `ios:sync` default),
   * marker ADS:off. `mock` — our own fake ads, no network, marker ADS:mock.
   * Anything else — the real provider, marker ADS:on. Read in
   * src/services/adProvider.ts ("Build modes").
   */
  readonly VITE_ADS?: string
  /**
   * `1` unlocks every level for TestFlight testers — marker UNLOCKALL:1, which
   * the `live` gate refuses. Read in src/services/buildFlags.ts.
   */
  readonly VITE_UNLOCK_ALL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
