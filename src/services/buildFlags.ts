/**
 * Build-time flags.
 *
 * These read `import.meta.env`, which Vite replaces with a literal at build
 * time — so in a production bundle the call collapses to `false` and the branch
 * behind it is tree-shaken out entirely. Nothing is decided at runtime, and
 * there is no way for a player to flip one.
 *
 * **Every flag here must be OFF unless explicitly enabled.** The variables are
 * absent from a normal `npm run build`, so the default is always the safe,
 * shippable behaviour; opting in takes a deliberate, differently-named script
 * (`npm run build:tf`). That direction of failure matters: forgetting to enable
 * a flag costs a test build, forgetting to disable one ships a broken game.
 */

/**
 * Unlock every level regardless of progress — TestFlight only, so a tester can
 * jump straight to level 600 instead of clearing 599 puzzles to reach it.
 *
 * Enabled by `VITE_UNLOCK_ALL=1`, which only `npm run build:tf` (and so
 * `ios:testflight`) sets. The App Store build (`ios:appstore`) never sets it,
 * and the release gate refuses a live bundle that carries it — see
 * UNLOCK_ALL_MARKER below. See docs/RELEASE.md.
 */
export function allLevelsUnlocked(): boolean {
  return import.meta.env.VITE_UNLOCK_ALL === '1'
}

/**
 * The literal `scripts/check-ad-mode.mjs` counts: `UNLOCKALL:1` exactly once in
 * a VITE_UNLOCK_ALL=1 bundle, and ABSENT from every other — the `live` target
 * refuses any bundle that has it, so an App Store upload can never hand all 600
 * levels to every player.
 *
 * Why a marker and not just the flag: `allLevelsUnlocked()` folds to a bare
 * `true`/`false` in the bundle, which no gate can grep. And the marker must be
 * READ by live code, because a string nothing uses is deleted by the minifier —
 * so stampBuildFlags() writes it onto the page, where the gate finds it in the
 * bundle and a human (or an E2E test) can find it in the DOM. When the flag is
 * off the whole branch folds away and the literal never reaches the bundle.
 */
export const UNLOCK_ALL_MARKER = import.meta.env.VITE_UNLOCK_ALL === '1' ? 'UNLOCKALL:1' : ''

/** Stamp the enabled build flags on <html data-build-flags>. Called once at boot. */
export function stampBuildFlags(root: HTMLElement = document.documentElement): void {
  if (UNLOCK_ALL_MARKER) root.setAttribute('data-build-flags', UNLOCK_ALL_MARKER)
}
