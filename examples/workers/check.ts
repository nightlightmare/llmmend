// CI check: the same Worker against stand-ins for three providers (no key, no network).
import assert from 'node:assert/strict'
import { mockProvider } from '../mock-fetch.ts'

const { default: worker } = await import('./src/index.ts')
const reply = 'The sea is calm today, and the lighthouse keeper writes in his diary.'

for (const [upstream, auth, body] of [
  [
    'https://api.anthropic.com/v1/messages',
    'x-api-key',
    { model: 'claude-opus-5-5', max_tokens: 200, stream: true, messages: [] },
  ],
  [
    'https://api.openai.com/v1/chat/completions',
    undefined,
    { model: 'gpt-5-mini', stream: true, messages: [] },
  ],
  [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    'x-goog-api-key',
    { contents: [] },
  ],
] as const) {
  const provider = mockProvider(reply)
  globalThis.fetch = provider.fetch
  const response = await worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        cookie: 'secret',
      },
      body: JSON.stringify(body),
    }),
    { UPSTREAM_URL: upstream, API_KEY: 'test-key', ...(auth ? { AUTH_HEADER: auth } : {}) },
  )
  assert.equal(await response.text(), reply, upstream)
  const sent = provider.requests[0]!
  assert.equal(sent.headers.get(auth ?? 'authorization'), auth ? 'test-key' : 'Bearer test-key')
  assert.equal(sent.headers.get('cookie'), null)
  assert.deepEqual(await sent.json(), body)
}
console.log('workers example ok: one Worker, three providers')
