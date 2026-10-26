// Format drift check: replays the streaming Ollama cases against a running Ollama and compares
// the fresh streams with the recorded fixtures. See fixtures/requests/README.md.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { streamLlm } from '../dist/sse/index.js'
import { knownFields, newFields, payloadPaths } from './drift-fields.mjs'

const root = new URL('../', import.meta.url)
// Each Ollama API the fixtures were recorded from, and the adapter that reads it.
const suites = [
  { dir: 'ollama', path: '/v1/chat/completions', provider: 'openai' },
  { dir: 'ollama-responses', path: '/v1/responses', provider: 'openai-responses' },
]
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

function check(events, expectEvents) {
  const problems = []
  const done = events.filter((e) => e.type === 'done')
  if (done.length !== 1 || events.at(-1)?.type !== 'done')
    problems.push('`done` is not once and last')
  const stop = done[0]?.stopReason
  if (stop === 'error' || stop === 'unknown') problems.push(`stopped with \`${stop}\``)
  const started = new Set()
  for (const e of events) {
    if (e.type === 'tool_call_start') started.add(e.index)
    if (e.type === 'tool_call_delta' && !started.has(e.index))
      problems.push(`\`tool_call_delta\` for Block ${e.index} before its start`)
    if (e.type === 'other') problems.push(`\`other\` event: \`${e.raw.data.slice(0, 200)}\``)
    if (e.type === 'error') problems.push(`\`error\` event: ${e.message}`)
  }
  const types = new Set(events.map((e) => e.type))
  for (const type of expectEvents ?? []) if (!types.has(type)) problems.push(`no \`${type}\` event`)
  return problems
}

// Per API: the fields of all its recorded fixtures, read once.
const knownBySuite = {}

async function run({ suite, request }) {
  const response = await fetch(`${baseUrl}${suite.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(600_000),
  })
  if (!response.ok) return [`HTTP ${response.status}: ${await response.text()}`]
  const [forEvents, forPaths] = response.body.tee()
  const fresh = payloadPaths(forPaths)
  const events = []
  for await (const event of streamLlm(forEvents, { provider: suite.provider })) events.push(event)
  const problems = check(events, request.expectEvents)

  knownBySuite[suite.dir] ??= knownFields(new URL(`test/fixtures/sse/${suite.dir}/`, root))
  const known = await knownBySuite[suite.dir]
  for (const path of newFields(await fresh, known)) problems.push(`new field \`${path}\``)
  return problems
}

const cases = []
for (const suite of suites) {
  const dir = new URL(`fixtures/requests/${suite.dir}/`, root)
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).toSorted()) {
    const request = JSON.parse(await readFile(new URL(file, dir), 'utf8'))
    const name = file.slice(0, -'.json'.length)
    if (request.save !== 'reply') cases.push({ suite, name, request })
  }
}

const version = await fetch(`${baseUrl}/api/version`).then((r) => r.json())
const report = [`Ollama ${version.version}`, '']
let failed = false
for (const c of cases) {
  const id = `${c.suite.dir}/${c.name}`
  const problems = await run(c).catch((error) => [`request failed: ${error.message}`])
  if (process.env.DRIFT_FORCE_FAILURE === 'true' && c === cases[0])
    problems.push('forced failure (`workflow_dispatch` input)')
  failed ||= problems.length > 0
  report.push(`- **${id}**: ${problems.length ? 'drift' : 'ok'}`)
  for (const problem of problems) report.push(`  - ${problem}`)
  console.log(`${problems.length ? 'drift' : 'ok   '} ${id}`)
  for (const problem of problems) console.log(`      ${problem}`)
}
await writeFile(new URL('drift-report.md', root), report.join('\n') + '\n')
if (failed) process.exitCode = 1
