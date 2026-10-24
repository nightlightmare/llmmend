// Turns the Vitest coverage summary into a shields.io endpoint badge (one line of JSON on stdout).
// CI publishes it to the `badges` branch after each push to main, and the README badge reads it
// from there, so no third-party coverage service is involved.
//
//   node scripts/coverage-badge.mjs    after `pnpm coverage`
import { readFileSync } from 'node:fs'

const summary = JSON.parse(
  readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'),
)
// Lines, the metric with the strictest threshold in vitest.config.ts.
const pct = Math.floor(summary.total.lines.pct)
const color = pct >= 95 ? 'brightgreen' : pct >= 90 ? 'green' : pct >= 80 ? 'yellow' : 'red'

console.log(JSON.stringify({ schemaVersion: 1, label: 'coverage', message: `${pct}%`, color }))
