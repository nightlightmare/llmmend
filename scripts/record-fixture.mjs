// Records real Provider responses as test fixtures. Run by a human with API keys:
//   node scripts/record-fixture.mjs [--list] [filter...]
// A filter matches `<provider>/<case>` by prefix, e.g. `anthropic` or `openai/text`.
// Keys come from the environment or `.env` (git-ignored). Headers are never written to disk.
// ANTHROPIC_VIA=bedrock sends the anthropic cases to Claude in Amazon Bedrock instead (same
// Messages API and SSE), signed with the AWS CLI's credentials; AWS_REGION defaults to us-east-1.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { sendViaBedrock } from './bedrock.mjs'

const root = new URL('../', import.meta.url)
const requestsDir = new URL('fixtures/requests/', root)

// Where each Provider lives and how it authenticates. `key: null` means no key is needed.
const providers = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    key: 'ANTHROPIC_API_KEY',
    auth: (k) => ({ 'x-api-key': k, 'anthropic-version': '2026-10-21' }),
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    key: 'OPENAI_API_KEY',
    auth: (k) => ({ authorization: `Bearer ${k}` }),
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: 'OPENROUTER_API_KEY',
    auth: (k) => ({ authorization: `Bearer ${k}` }),
  },
  ollama: {
    url: `${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/v1/chat/completions`,
    key: null,
    auth: () => ({}),
  },
  // Ollama's OpenAI Responses API, for the 'openai-responses' adapter without an OpenAI key.
  'ollama-responses': {
    url: `${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/v1/responses`,
    key: null,
    auth: () => ({}),
  },
  // The model goes in the URL, not the body.
  gemini: {
    url: (body) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:streamGenerateContent?alt=sse`,
    key: 'GEMINI_API_KEY',
    auth: (k) => ({ 'x-goog-api-key': k }),
    body: (body) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'model')),
  },
}

// Deterministic filler, so cache-write and cache-read requests share a byte-identical prefix.
function filler(words) {
  const vocabulary = ['tide', 'harbour', 'lantern', 'compass', 'reef', 'gull', 'anchor', 'current']
  return Array.from({ length: words }, (_, i) => vocabulary[(i * 7) % vocabulary.length]).join(' ')
}

// Replaces `{{filler:N}}` in any string of the request body.
function expand(value) {
  if (typeof value === 'string') return value.replace(/\{\{filler:(\d+)\}\}/g, (_, n) => filler(+n))
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

async function listCases() {
  const files = await readdir(requestsDir, { recursive: true })
  return files
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.includes('/') && f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .toSorted()
}

async function sendDirect(config, key, body) {
  const url = typeof config.url === 'function' ? config.url(body) : config.url
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...config.auth(key) },
    body: JSON.stringify(config.body ? config.body(body) : body),
    signal: AbortSignal.timeout(300_000),
  })
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) }
}

async function record(id) {
  const [provider, name] = id.split('/')
  const config = providers[provider]
  if (!config) throw new Error(`unknown provider "${provider}"`)
  const viaBedrock = provider === 'anthropic' && process.env.ANTHROPIC_VIA === 'bedrock'
  const key = config.key ? process.env[config.key] : ''
  if (key === undefined && !viaBedrock) return console.log(`skip ${id}: ${config.key} is not set`)

  const request = JSON.parse(await readFile(new URL(`${id}.json`, requestsDir), 'utf8'))
  const body = expand(request.body)
  const { status, bytes } = viaBedrock
    ? await sendViaBedrock(body)
    : await sendDirect(config, key, body)
  if (status !== 200) {
    process.exitCode = 1
    return console.log(`fail ${id}: HTTP ${status} ${new TextDecoder().decode(bytes)}`)
  }

  const meta = {
    provider,
    case: name,
    description: request.description,
    model: body.model,
    ...(viaBedrock && { via: 'bedrock' }),
    recordedAt: new Date().toISOString(),
    synthetic: false,
  }
  let out
  if (request.save === 'reply') {
    // Non-streaming reply text for the `json` corpus; the expected value is written by hand.
    const json = JSON.parse(new TextDecoder().decode(bytes))
    out = new URL(`test/fixtures/llm-replies/real-${provider}-${name}.txt`, root)
    await mkdir(new URL('.', out), { recursive: true })
    await writeFile(out, json.choices[0].message.content)
  } else {
    out = new URL(`test/fixtures/sse/${id}.sse`, root)
    await mkdir(new URL('.', out), { recursive: true })
    await writeFile(out, bytes)
  }
  await writeFile(
    new URL(out.href.replace(/\.(sse|txt)$/, '.meta.json')),
    JSON.stringify(meta, null, 2) + '\n',
  )
  console.log(`ok   ${id} -> ${out.pathname.slice(root.pathname.length)}`)
}

if (existsSync(new URL('.env', root))) process.loadEnvFile(new URL('.env', root))

const args = process.argv.slice(2)
const all = await listCases()
if (args.includes('--list')) {
  console.log(all.join('\n'))
} else {
  const filters = args.filter((a) => !a.startsWith('--'))
  const selected = filters.length ? all.filter((id) => filters.some((f) => id.startsWith(f))) : all
  if (!selected.length) throw new Error(`no request matches ${filters.join(', ')}`)
  // Sequential on purpose: cache-read cases must run after their cache-write case.
  for (const id of selected) {
    try {
      await record(id)
    } catch (error) {
      process.exitCode = 1
      console.log(`fail ${id}: ${error.cause?.message ?? error.message}`)
    }
  }
}
