// CI check: runs the route against a stand-in for the Anthropic API (no key, no network) and
// verifies that partial recipes stream before the final one.
import assert from 'node:assert/strict'
import { mockProvider } from '../mock-fetch.ts'

const recipe = {
  title: 'Pancakes',
  ingredients: ['2 eggs', '250 ml milk', '125 g flour'],
  steps: ['Whisk everything together.', 'Fry thin layers in butter.'],
}
// Claude often adds a sentence and a code fence around the JSON.
const provider = mockProvider(
  `Here is a recipe:\n\n\`\`\`json\n${JSON.stringify(recipe, null, 2)}\n\`\`\`\n\nEnjoy!`,
)
globalThis.fetch = provider.fetch

const { POST } = await import('./app/api/recipe/route.ts')
const response = await POST(
  new Request('http://localhost/api/recipe', {
    method: 'POST',
    body: JSON.stringify({ dish: 'pancakes' }),
  }),
)
assert.equal(response.headers.get('content-type'), 'application/x-ndjson')
const lines = (await response.text())
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))

assert.deepEqual(lines.at(-1), { recipe, stopReason: 'end' })
const partials = lines.slice(0, -1).map((line) => line.partial)
assert.ok(partials.length > 5, `only ${partials.length} partial values`)
assert.ok(partials.some((partial) => partial.title && !partial.steps))
assert.match(provider.requests[0]!.url, /\/v1\/messages$/)
console.log(`nextjs example ok: ${partials.length} partial recipes, then the final one`)
