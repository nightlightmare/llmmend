// Runtime smoke test against the built `dist`, without a test framework.
// Runs on every supported runtime (Node 20+, Bun, Deno): `node scripts/smoke.mjs`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { checks } from './smoke-checks.mjs'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (subpath === './package.json') continue
  const check = checks[subpath]
  assert.ok(check, `no smoke check for "${subpath}"`)
  await check(await import(new URL(`../${target.import.default}`, import.meta.url).href))
  await check(require(`../${target.require.default}`))
}

console.log(`smoke ok: ${Object.keys(checks).join(', ')}`)
