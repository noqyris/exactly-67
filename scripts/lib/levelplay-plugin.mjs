// Shared plumbing for the three capacitor-levelplay-ads postinstall patches:
// where the app lives, and where (and which) plugin is installed.
//
// Every patch used to resolve these for itself from process.cwd(). That is
// right when npm runs postinstall and wrong the moment somebody runs a patch by
// hand from another directory — the patch then reads some other package.json,
// finds no plugin and "skips". A patch that skips silently is worse than one
// that never existed: the consent patch skipping means shipping a consent
// dialog that turns "decline" into consent. So the root is derived from this
// file's own location, and a plugin that package.json declares but Node cannot
// find is a hard stop, never a skip.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PLUGIN_VERSION } from './levelplay-versions.mjs'

/** The Exactly 67 app root: scripts/lib/ → two levels up. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const PLUGIN_NAME = 'capacitor-levelplay-ads'

/** The app's package.json, parsed. */
export function readAppPackage() {
  return JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))
}

/**
 * Directory of the installed plugin, or null when the app does not declare it.
 *
 * Resolved through Node rather than a hard-coded `node_modules/…` path, so it
 * follows hoisting, workspaces and any other layout Node itself understands.
 *
 * Exits 1 — loudly — when:
 *   - package.json declares the plugin but it is not installed;
 *   - package.json pins anything other than exactly PLUGIN_VERSION (a caret
 *     range lets `npm install` move the plugin under the patches);
 *   - the installed version is not PLUGIN_VERSION (the patches were verified
 *     against that tarball's files and nothing else).
 */
export function locatePlugin(tag) {
  const appPkg = readAppPackage()
  const spec = appPkg.dependencies?.[PLUGIN_NAME] ?? appPkg.devDependencies?.[PLUGIN_NAME]
  if (spec === undefined) {
    console.log(`[${tag}] ${PLUGIN_NAME} is not a dependency of this app — nothing to patch`)
    return null
  }

  const stop = (...lines) => {
    console.error(`[${tag}] ${lines[0]}`)
    for (const l of lines.slice(1)) console.error(`  ${l}`)
    process.exit(1)
  }

  if (spec !== PLUGIN_VERSION) {
    stop(
      `package.json pins ${PLUGIN_NAME} as "${spec}", but the patches were verified against exactly "${PLUGIN_VERSION}".`,
      `Pin it exactly ("${PLUGIN_NAME}": "${PLUGIN_VERSION}", no caret) — or, to move to a new plugin version,`,
      'read the new tarball, re-verify all three patches, and bump PLUGIN_VERSION in scripts/lib/levelplay-versions.mjs.',
    )
  }

  const require = createRequire(pathToFileURL(APP_ROOT + '/'))
  let pkgDir
  try {
    pkgDir = dirname(require.resolve(`${PLUGIN_NAME}/package.json`))
  } catch {
    stop(
      `package.json declares ${PLUGIN_NAME} but Node cannot resolve it from ${APP_ROOT}.`,
      'The install is incomplete. Do not build: without the plugin (and these patches) iOS ships an ad layer that',
      'serves nothing and Android ships an unpatched consent dialog. Re-run `npm install`.',
    )
  }
  if (!existsSync(join(pkgDir, 'package.json'))) stop(`${pkgDir}/package.json is missing — the install is corrupt.`)

  const installed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
  if (installed !== PLUGIN_VERSION) {
    stop(
      `installed ${PLUGIN_NAME} is ${installed}, but the patches were verified against ${PLUGIN_VERSION}.`,
      'A patch applied to files it was not written for can half-apply silently. Re-run `npm install` with the exact pin,',
      'or re-verify the patches against the new version and bump PLUGIN_VERSION deliberately.',
    )
  }
  return pkgDir
}
