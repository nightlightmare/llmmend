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
  './json': (m) => {
    assert.equal(new m.LlmmendJsonError('truncated', '', []).code, 'truncated')
    assert.equal(m.repairJson("{name: 'Ada', ok: True,").json, '{"name":"Ada","ok":true}')
    assert.deepEqual(m.extractJsonOrThrow('Sure:\n```json\n{"a": [1, 2]}\n```'), { a: [1, 2] })
    assert.deepEqual(m.parsePartialJson('{"t": "Hel'), { value: { t: 'Hel' }, complete: false })
  },
  './sse': async (m) => {
    assert.equal(new m.LlmmendHttpError(429, new Headers(), '').status, 429)
    // Exercises the runtime's ReadableStream and streaming TextDecoder: the emoji is split.
    const bytes = new TextEncoder().encode('data: 🌊\r\n\r\n')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 8))
        controller.enqueue(bytes.subarray(8))
        controller.close()
      },
    })
    const events = []
    for await (const event of m.parseSSE(stream)) events.push(event)
    assert.deepEqual(events, [{ event: 'message', data: '🌊' }])
    // Exercises the runtime's Response.
    const reply = [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    const body = reply.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
    assert.deepEqual(await m.collectText(new Response(body), { provider: 'anthropic' }), {
      text: 'Hi',
      stopReason: 'end',
      usage: { outputTokens: 1 },
    })
  },
}

for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (subpath === './package.json') continue
  const check = checks[subpath]
  assert.ok(check, `no smoke check for "${subpath}"`)
  await check(await import(new URL(`../${target.import.default}`, import.meta.url).href))
  await check(require(`../${target.require.default}`))
}

console.log(`smoke ok: ${Object.keys(checks).join(', ')}`)
