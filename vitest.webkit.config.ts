import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// The json, sse, chunk, prompt and cost suites in WebKit (Safari's engine). Timing tests are left to Node.
export default defineConfig({
  test: {
    include: [
      'test/json/**/*.test.ts',
      'test/sse/**/*.test.ts',
      'test/chunk/**/*.test.ts',
      'test/prompt/**/*.test.ts',
      'test/cost/**/*.test.ts',
    ],
    exclude: ['test/**/*.perf.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'webkit' }],
    },
  },
})
