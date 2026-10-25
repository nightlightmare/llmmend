// CI check: both endpoints, Gemini replaced by a stand-in (no key, no network). CI runs it with
// ci.imports.json, so `llmmend` is this repo's build rather than the published package.
import { mockProvider } from '../mock-fetch.ts'
import { handler } from './main.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const doc = [
  '# Lighthouse',
  'The keeper wakes before dawn and wipes the salt from the glass.',
  '```sh\nlamp --check\n```',
  ...Array.from({ length: 20 }, (_, i) => `Entry ${i}: wind from the north, two ships passed.`),
].join('\n\n')
const chunked = await handler(
  new Request('http://localhost/chunks?maxTokens=60', { method: 'POST', body: doc }),
)
const chunks = (await chunked.json()) as { text: string; tokens: number }[]
assert(chunks.length > 2, `expected several chunks, got ${chunks.length}`)
assert(
  chunks.every((chunk) => chunk.tokens <= 60),
  'a chunk is over maxTokens',
)
assert(
  chunks.some((chunk) => chunk.text.includes('```sh\nlamp --check\n```')),
  'the code block was cut',
)

const summary = 'A lighthouse keeper logs the weather and the ships every day.'
const provider = mockProvider(summary)
globalThis.fetch = provider.fetch
const summarized = await handler(
  new Request('http://localhost/summarize', { method: 'POST', body: doc }),
)
assert((await summarized.text()) === summary, 'the streamed summary differs')
assert(provider.requests[0]!.url.endsWith(':streamGenerateContent?alt=sse'), 'wrong endpoint')

console.log(`deno example ok: ${chunks.length} chunks, summary streamed`)
