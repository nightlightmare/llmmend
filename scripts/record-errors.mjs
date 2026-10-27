// Records real Provider error responses as fixtures for classifyError. Run by a human with keys:
//   node scripts/record-errors.mjs [filter...]
// Gemini needs GEMINI_API_KEY (environment or .env); Claude goes through Amazon Bedrock with the
// AWS CLI's login (scripts/bedrock.mjs). Only errors that cost nothing are provoked: a bad key, an
// unknown model, and a prompt over the context window, which is rejected before any processing.
// Errors that can't be provoked (overload, quota) are written by hand from the Providers' docs.
// Before sending that prompt, the free token-counting APIs confirm it is over the limit.
// Writes test/fixtures/errors/<provider>/<case>.json ({ status, headers, body }) and .meta.json.
// Only the headers in KEEP are written: never credentials or request ids.
import { mkdir, writeFile } from 'node:fs/promises'
import { sendViaBedrock } from './bedrock.mjs'
import { claude, gemini } from './token-apis.mjs'

const root = new URL('../', import.meta.url)
const KEEP = ['content-type', 'retry-after', 'retry-after-ms', 'x-amzn-errortype']

const CLAUDE_CONTEXT = 1_000_000
const GEMINI_CONTEXT = 1_048_576

// Deterministic filler, the same as record-fixture.mjs.
function filler(words) {
  const vocabulary = ['tide', 'harbour', 'lantern', 'compass', 'reef', 'gull', 'anchor', 'current']
  return Array.from({ length: words }, (_, i) => vocabulary[(i * 7) % vocabulary.length]).join(' ')
}

const message = (text) => ({ messages: [{ role: 'user', content: text }] })

async function overLimit(count, text, limit) {
  const tokens = await count(text)
  if (tokens <= limit * 1.05) throw new Error(`only ${tokens} tokens, not safely over ${limit}`)
  return tokens
}

async function sendGemini(model, body, key = process.env.GEMINI_API_KEY) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    },
  )
  return {
    status: res.status,
    headers: res.headers,
    bytes: new Uint8Array(await res.arrayBuffer()),
  }
}

const geminiText = (text) => ({ contents: [{ role: 'user', parts: [{ text }] }] })
const claudeBody = (model, text) => ({ model, max_tokens: 16, stream: true, ...message(text) })

const cases = {
  'gemini/auth': {
    description: 'An invalid API key.',
    model: 'gemini-3.8-flash',
    send: () => sendGemini('gemini-3.8-flash', geminiText('Hi'), 'invalid-key'),
  },
  'gemini/unknown-model': {
    description: 'A model that does not exist.',
    model: 'gemini-0-nonexistent',
    send: () => sendGemini('gemini-0-nonexistent', geminiText('Hi')),
  },
  // On the free tier the prompt hits the 250,000 input tokens per minute first: a 429 with
  // RetryInfo, not the context window's 400 (that one is in the docs fixtures).
  'gemini/rate-limit': {
    description:
      'A 1.15M-token prompt on the free tier: over its 250,000 input tokens per minute before the context window, so a 429 with RetryInfo.',
    model: 'gemini-3.8-flash',
    send: async () => {
      const text = filler(1_150_000)
      console.log(`     ${await overLimit(gemini, text, GEMINI_CONTEXT)} tokens`)
      return sendGemini('gemini-3.8-flash', geminiText(text))
    },
  },
  'anthropic/auth': {
    description: 'Credentials that do not exist (Bedrock rejects the signature).',
    model: 'claude-opus-5-5',
    via: 'bedrock',
    send: () =>
      sendViaBedrock(claudeBody('claude-opus-5-5', 'Hi'), {
        credentials: { AccessKeyId: 'AKIAIOSFODNN7EXAMPLE', SecretAccessKey: 'invalid' },
      }),
  },
  'anthropic/unknown-model': {
    description: 'A model that does not exist.',
    model: 'claude-nonexistent-0',
    via: 'bedrock',
    send: () => sendViaBedrock(claudeBody('claude-nonexistent-0', 'Hi')),
  },
  'anthropic/context-length': {
    description: `A prompt over the ${CLAUDE_CONTEXT}-token context window.`,
    model: 'claude-opus-5-5',
    via: 'bedrock',
    send: async () => {
      const text = filler(500_000)
      console.log(`     ${await overLimit(claude, text, CLAUDE_CONTEXT)} tokens`)
      return sendViaBedrock(claudeBody('claude-opus-5-5', text))
    },
  },
}

async function record(id) {
  const c = cases[id]
  const { status, headers, bytes } = await c.send()
  if (status < 400) {
    process.exitCode = 1
    return console.log(`fail ${id}: HTTP ${status}, expected an error`)
  }
  const kept = Object.fromEntries(
    KEEP.filter((h) => headers.has(h)).map((h) => [h, headers.get(h)]),
  )
  const response = { status, headers: kept, body: new TextDecoder().decode(bytes) }
  const out = new URL(`test/fixtures/errors/${id}.json`, root)
  await mkdir(new URL('.', out), { recursive: true })
  await writeFile(out, JSON.stringify(response, null, 2) + '\n')
  const [provider, name] = id.split('/')
  const meta = {
    provider,
    case: name,
    description: c.description,
    model: c.model,
    ...(c.via && { via: c.via }),
    recordedAt: new Date().toISOString(),
    synthetic: false,
  }
  await writeFile(new URL(`${name}.meta.json`, out), JSON.stringify(meta, null, 2) + '\n')
  console.log(`ok   ${id}: HTTP ${status}`)
}

const filters = process.argv.slice(2)
for (const id of Object.keys(cases))
  if (!filters.length || filters.some((f) => id.startsWith(f))) await record(id)
