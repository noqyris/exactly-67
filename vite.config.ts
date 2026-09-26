/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built app loads from capacitor://localhost on iOS.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The ad suites re-import the whole module graph (600 levels included) per
    // test; alone they take up to ~4 s, so the 5 s default failed the build gate
    // at random whenever the machine was busy.
    testTimeout: 30_000,
  },
})
