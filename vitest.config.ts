import { defineConfig } from 'vitest/config'

const full = { lines: 100, branches: 100, functions: 100, statements: 100 }

// Coverage instrumentation slows code down unevenly, so timing tests (*.perf.test.ts) only run
// without it: `pnpm test` runs them, `pnpm coverage` skips them.
const coverage = process.argv.includes('--coverage')

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: coverage ? ['test/**/*.perf.test.ts'] : [],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 90,
        statements: 90,
        // The riskiest code: ReDoS and endless loops in the scanner, split UTF-8 in the decoder.
        'src/json/scanner.ts': full,
        'src/sse/decoder.ts': full,
      },
    },
  },
})
