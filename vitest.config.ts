import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file in its own process: config is read from process.env when it loads, and some files set their own
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000
  }
})
