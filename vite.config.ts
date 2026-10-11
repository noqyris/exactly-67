/// <reference types="vitest" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

/**
 * The version and build the store shows, e.g. "1.3.0 (38)", read from the one
 * place they live — ios/App/App.xcodeproj/project.pbxproj (MARKETING_VERSION /
 * CURRENT_PROJECT_VERSION; Info.plist only refers to them). Baked into the
 * bundle as __APP_VERSION__ so "Report an ad" (services/report.ts) can name the
 * build that served the ad without a native plugin. Read, never written: a bump
 * stays a project.pbxproj edit, and the bundle built after it carries it.
 */
function appVersion(): string {
  try {
    const pbx = readFileSync(new URL('./ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8')
    const version = /MARKETING_VERSION = ([0-9][0-9.]*);/.exec(pbx)?.[1]
    const build = /CURRENT_PROJECT_VERSION = ([0-9]+);/.exec(pbx)?.[1]
    return version && build ? `${version} (${build})` : 'unknown'
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  // Relative base so the built app loads from capacitor://localhost on iOS.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The ad suites re-import the whole module graph (600 levels included) per
    // test; alone they take up to ~4 s, so the 5 s default failed the build gate
    // at random whenever the machine was busy.
    testTimeout: 30_000,
  },
})
