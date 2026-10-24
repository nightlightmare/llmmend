// CI check: runs the app against a stand-in for an OpenAI-compatible API (no key, no network).
import assert from 'node:assert/strict'
import { mockProvider } from '../mock-fetch.ts'

const { app } = await import('./src/app.ts')
const ask = async (reply: string) => {
  globalThis.fetch = mockProvider(reply).fetch
  const response = await app.request('/recipe', {
    method: 'POST',
    body: JSON.stringify({ dish: 'pancakes' }),
    headers: { 'content-type': 'application/json' },
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

// Python-style JSON with a trailing comma, after some prose: repaired and validated.
const ok = await ask(
  "Sure!\n{'title': 'Pancakes', 'minutes': 20, 'ingredients': ['eggs', 'milk', 'flour',],}",
)
assert.equal(ok.status, 200)
assert.deepEqual(ok.body.recipe, {
  title: 'Pancakes',
  minutes: 20,
  ingredients: ['eggs', 'milk', 'flour'],
})
assert.equal(ok.body.repaired, true)

// Valid JSON that misses a field: 422 with the schema's issues.
const bad = await ask('{"title": "Pancakes", "ingredients": ["eggs"]}')
assert.equal(bad.status, 422)
assert.equal(bad.body.error, 'schema_mismatch')
assert.ok(Array.isArray(bad.body.schemaIssues) && bad.body.schemaIssues.length === 1)

console.log('hono example ok: repaired a sloppy reply, rejected an incomplete one')
