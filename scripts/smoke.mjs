// Runtime smoke test against the built `dist`, without a test framework.
// Runs on every supported runtime (Node 20+, Bun, Deno): `node scripts/smoke.mjs`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// One check per subpath; keep in sync with `exports`.
const checks = {
  '.': (m) => {
    assert.equal(new m.LlmmendJsonError('not_found', '', []).name, 'LlmmendJsonError')
    assert.ok(new m.LlmmendHttpError(500, new Headers(), '') instanceof m.LlmmendError)
  },
  './json': (m) => assert.equal(new m.LlmmendJsonError('truncated', '', []).code, 'truncated'),
  './sse': (m) => assert.equal(new m.LlmmendHttpError(429, new Headers(), '').status, 429),
}

for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (subpath === './package.json') continue
  const check = checks[subpath]
  assert.ok(check, `no smoke check for "${subpath}"`)
  check(await import(new URL(`../${target.import.default}`, import.meta.url).href))
  check(require(`../${target.require.default}`))
}

console.log(`smoke ok: ${Object.keys(checks).join(', ')}`)
