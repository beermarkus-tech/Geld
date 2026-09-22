import { defineConfig } from 'vitest/config'

// Separate from vite.config.js on purpose: the app config pulls in the PWA
// plugin and a git-derived build number that a pure-function test suite has
// no use for. Kept minimal — everything under src/lib is framework-free.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
