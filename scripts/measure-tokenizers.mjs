// Measures how far `estimateTokens` is from real tokenizers on the calibration corpus, for the
// README table. Run by a human after `pnpm build`; both token counting APIs are free:
//   GEMINI_API_KEY=... node scripts/measure-tokenizers.mjs     (Claude through Bedrock: AWS CLI login)
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEncoding } from 'js-tiktoken'
import { estimateTokens } from '../dist/chunk/index.js'

const root = new URL('../', import.meta.url)
if (existsSync(new URL('.env', root))) process.loadEnvFile(new URL('.env', root))

const prose = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
const read = (path) => readFile(new URL(path, root), 'utf8')
const samples = {
  'English prose': prose(await read('docs/api.md')),
  'Russian prose': prose(await read('docs/api.ru.md')),
  'Chinese prose': prose(await read('docs/api.zh-CN.md')),
  Japanese: await read('test/fixtures/chunk/corpus/ja.txt'),
  Korean: await read('test/fixtures/chunk/corpus/ko.txt'),
  'TypeScript code': await read('src/json/parser.ts'),
  'Markdown with tables and code': await read('docs/api.md'),
  'Chat with emoji': await read('test/fixtures/chunk/corpus/chat.txt'),
}

const o200k = getEncoding('o200k_base')

async function gemini(text) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(`Gemini: HTTP ${res.status} ${json.error?.message}`)
  return json.totalTokens
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { encoding: 'utf8' }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  )
const credentials = JSON.parse(
  await run('aws', ['configure', 'export-credentials', '--format', 'process']),
)
const region = process.env.AWS_REGION ?? 'us-east-1'

// Anthropic's count_tokens on bedrock-mantle; credentials go through a 0600 curl config file,
// never the command line.
async function claudeRaw(text) {
  const dir = await mkdtemp(join(tmpdir(), 'llmmend-count-'))
  const config = join(dir, 'curl.config')
  try {
    const lines = [`user = "${credentials.AccessKeyId}:${credentials.SecretAccessKey}"`]
    if (credentials.SessionToken)
      lines.push(`header = "x-amz-security-token: ${credentials.SessionToken}"`)
    await writeFile(config, lines.join('\n') + '\n', { mode: 0o600 })
    const body = JSON.stringify({
      model: 'anthropic.claude-opus-5-5',
      messages: [{ role: 'user', content: text }],
    })
    const out = await new Promise((resolve, reject) => {
      const child = spawn('curl', [
        '-s',
        '-m',
        '120',
        '-K',
        config,
        `https://bedrock-mantle.${region}.api.aws/anthropic/v1/messages/count_tokens`,
        '--aws-sigv4',
        `aws:amz:${region}:bedrock-mantle`,
        '-H',
        'content-type: application/json',
        '-H',
        'anthropic-version: 2023-06-01',
        '--data-binary',
        '@-',
      ])
      let stdout = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.on('error', reject)
      child.on('close', () => resolve(stdout))
      child.stdin.end(body)
    })
    const json = JSON.parse(out)
    if (json.input_tokens === undefined) throw new Error(`Claude: ${out.slice(0, 200)}`)
    return json.input_tokens
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
// The message framing costs a few tokens: measure it on a one-token text and take it off.
const framing = (await claudeRaw('a')) - 1
const claude = async (text) => (await claudeRaw(text)) - framing

const percent = (estimate, real) => {
  const p = Math.round(((estimate - real) / real) * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`
}
console.log('| Text | Characters | `o200k_base` | Gemini 3.8 Flash | Claude Opus 5.5 |')
console.log('|---|---|---|---|---|')
for (const [name, text] of Object.entries(samples)) {
  const estimate = estimateTokens(text)
  const [g, c] = [await gemini(text), await claude(text)]
  const o = o200k.encode(text).length
  console.log(
    `| ${name} | ${text.length} | ${percent(estimate, o)} | ${percent(estimate, g)} | ${percent(estimate, c)} |`,
  )
}
