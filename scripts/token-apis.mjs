// Exact token counts from Claude (Anthropic's count_tokens on Bedrock, through the AWS CLI login)
// and Gemini (countTokens, GEMINI_API_KEY from the environment or .env). Both APIs are free.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)
if (existsSync(new URL('.env', root))) process.loadEnvFile(new URL('.env', root))

export const GEMINI_MODEL = 'gemini-3.8-flash'
export const CLAUDE_MODEL = 'anthropic.claude-opus-5-5'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retries rate limits and server errors, which a few thousand calls in a row run into. */
async function retrying(call) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      if (!error.retry || attempt >= 6) throw error
      await sleep(1000 * 2 ** attempt)
    }
  }
}

function failure(message, status) {
  const error = new Error(message)
  error.retry = status === 429 || status >= 500
  return error
}

async function geminiRaw(text) {
  return retrying(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:countTokens`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
      },
    )
    const json = await res.json()
    if (!res.ok) throw failure(`Gemini: HTTP ${res.status} ${json.error?.message}`, res.status)
    return json.totalTokens
  })
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

// Credentials go through a 0600 curl config file, never the command line.
const configDir = await mkdtemp(join(tmpdir(), 'llmmend-count-'))
const config = join(configDir, 'curl.config')
{
  const lines = [`user = "${credentials.AccessKeyId}:${credentials.SecretAccessKey}"`]
  if (credentials.SessionToken)
    lines.push(`header = "x-amz-security-token: ${credentials.SessionToken}"`)
  await writeFile(config, lines.join('\n') + '\n', { mode: 0o600 })
}
process.on('exit', () => rm(configDir, { recursive: true, force: true }))

async function claudeRaw(text) {
  return retrying(async () => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      messages: [{ role: 'user', content: text }],
    })
    const out = await new Promise((resolve, reject) => {
      const child = spawn('curl', [
        '-s',
        '-m',
        '120',
        '-w',
        '\n%{http_code}',
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
    const newline = out.lastIndexOf('\n')
    const status = Number(out.slice(newline + 1))
    const json = JSON.parse(out.slice(0, newline) || '{}')
    if (json.input_tokens === undefined)
      throw failure(`Claude: HTTP ${status} ${out.slice(0, 200)}`, status)
    return json.input_tokens
  })
}

// The message framing costs a few tokens: measure it on a one-token text and take it off.
const claudeFraming = (await claudeRaw('a')) - 1
const geminiFraming = (await geminiRaw('a')) - 1

/** Claude's token count for `text`, without the message framing. */
export const claude = async (text) => (await claudeRaw(text)) - claudeFraming
/** Gemini's token count for `text`, without the message framing. */
export const gemini = async (text) => (await geminiRaw(text)) - geminiFraming

/** Runs `task` over `items`, `limit` at a time, keeping the order. */
export async function pool(items, limit, task) {
  const out = Array.from({ length: items.length })
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return out
}
