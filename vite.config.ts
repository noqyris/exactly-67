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
  },
})
