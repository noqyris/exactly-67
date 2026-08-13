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
 * Enabled by `VITE_UNLOCK_ALL=1`, which only `npm run build:tf` sets. The App
 * Store build must go through plain `npm run ios:sync`, where this is false and
 * the normal one-level-at-a-time progression applies. See docs/RELEASE.md.
 */
export function allLevelsUnlocked(): boolean {
  return import.meta.env.VITE_UNLOCK_ALL === '1'
}
