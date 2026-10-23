// Records real Provider responses as test fixtures. Run by a human with API keys:
//   node scripts/record-fixture.mjs [--list] [filter...]
// A filter matches `<provider>/<case>` by prefix, e.g. `anthropic` or `openai/text`.
// Keys come from the environment or `.env` (git-ignored). Headers are never written to disk.
// ANTHROPIC_VIA=bedrock sends the anthropic cases to Claude in Amazon Bedrock instead (same
// Messages API and SSE), signed with the AWS CLI's credentials; AWS_REGION defaults to us-east-1.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...config.auth(key) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  })
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) }
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { encoding: 'utf8' }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  )

let awsCredentials
// Temporary credentials of whatever the AWS CLI is logged in with (aws login, SSO, profile).
async function bedrockCredentials() {
  awsCredentials ??= JSON.parse(
    await run('aws', ['configure', 'export-credentials', '--format', 'process']),
  )
  return awsCredentials
}

// curl signs the request with SigV4 (service bedrock-mantle); the body goes in on stdin, the
// response bytes come out on stdout untouched, and the status code on stderr. The credentials
// go in a curl config file readable only by this user and deleted right after, never on the
// command line, where any process on the machine could read them.
async function sendViaBedrock(body) {
  const region = process.env.AWS_REGION ?? 'us-east-1'
  const creds = await bedrockCredentials()
  const lines = [`user = "${creds.AccessKeyId}:${creds.SecretAccessKey}"`]
  if (creds.SessionToken) lines.push(`header = "x-amz-security-token: ${creds.SessionToken}"`)
  const dir = await mkdtemp(join(tmpdir(), 'llmmend-record-'))
  const config = join(dir, 'curl.conf')
  try {
    await writeFile(config, lines.join('\n') + '\n', { mode: 0o600 })
    const curl = spawn('curl', [
      '-s',
      '-m',
      '300',
      '-K',
      config,
      `https://bedrock-mantle.${region}.api.aws/anthropic/v1/messages`,
      '--aws-sigv4',
      `aws:amz:${region}:bedrock-mantle`,
      '-H',
      'content-type: application/json',
      '-H',
      'anthropic-version: 2026-10-21',
      '--data-binary',
      '@-',
      '-w',
      '%{stderr}%{http_code}',
    ])
    const out = []
    let status = ''
    curl.stdout.on('data', (chunk) => out.push(chunk))
    curl.stderr.on('data', (chunk) => (status += chunk))
    curl.stdin.end(JSON.stringify({ ...body, model: `anthropic.${body.model}` }))
    await new Promise((resolve, reject) => curl.on('close', resolve).on('error', reject))
    return { status: Number(status.trim()), bytes: new Uint8Array(Buffer.concat(out)) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
