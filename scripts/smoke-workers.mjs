// Runs the smoke checks inside workerd, the Cloudflare Workers runtime, without nodejs_compat.
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('workers/smoke-worker.mjs', import.meta.url)),
  modulesRules: [{ type: 'ESModule', include: ['**/*.js', '**/*.mjs'] }],
  // Must not be newer than the workerd binary that ships with miniflare.
  compatibilityDate: '2026-08-01',
})
try {
  const response = await mf.dispatchFetch('http://localhost/')
  const text = await response.text()
  if (!response.ok) throw new Error(text)
  console.log(text)
} finally {
  await mf.dispose()
}
