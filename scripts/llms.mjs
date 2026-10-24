// Writes llms.txt (a short index for AI coding assistants, https://llmstxt.org) and
// llms-full.txt (the whole English API reference) from docs/api.md, so they never drift from it.
// Both ship in the npm package, where assistants find them in node_modules.
//
//   node scripts/llms.mjs           write both files
//   node scripts/llms.mjs --check   fail if either is stale (part of `pnpm check:docs`)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseMarkdown } from './markdown.mjs'

const root = new URL('../', import.meta.url)
const repo = 'https://github.com/nightlightmare/llmmend'
const api = readFileSync(new URL('docs/api.md', root), 'utf8')

// The language switcher only makes sense on GitHub.
const reference = api.replace(/^\*\*English\*\*.*\n+/, '')

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-')

/** The first sentence of the first paragraph after each heading, skipping code, tables and lists. */
function sections(text) {
  const { headings } = parseMarkdown(text)
  const lines = text.split('\n')
  return headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => {
      let fence = false
      let summary = ''
      for (const line of lines.slice(h.line)) {
        if (/^#{1,3} /.test(line)) break
        if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence
        else if (!fence && line.trim() && !/^\s*[-|>*]/.test(line)) {
          summary = line.match(/^.*?\.(?=\s|$)/)?.[0] ?? line.replace(/:$/, '')
          break
        }
      }
      return { ...h, summary }
    })
}

const index = [
  '# llmmend',
  '',
  '> Fix what your LLM returns: extract and repair JSON from model replies, turn streaming responses from Anthropic, OpenAI (Chat Completions and Responses), Gemini and OpenAI-compatible servers into one event format, and split text into token-sized chunks. Zero dependencies; Node 20+, Bun, Deno, browsers and edge runtimes.',
  '',
  'Install with `npm i llmmend`. Import from `llmmend/json`, `llmmend/sse` or `llmmend/chunk`, or from the root: both are tree-shakeable. `extractJson` never throws on bad input: check `res.ok`, then read `res.value` or `res.error`. Streams take a `fetch` `Response` and detect the Provider by default.',
]
for (const s of sections(reference)) {
  const module = s.level === 2 && s.text.startsWith('llmmend/')
  // A module becomes a group of links; the sections after them (Errors, Versioning) share one.
  if (module) index.push('', `## ${s.text}`, '')
  else if (s.level === 2 && !index.includes('## Reference')) index.push('', '## Reference', '')
  if (!module)
    index.push(`- [${s.text}](${repo}/blob/main/docs/api.md#${anchor(s.text)}): ${s.summary}`)
}
index.push(
  '',
  '## Optional',
  '',
  `- [Full API reference in one file](${repo}/blob/main/llms-full.txt): the same as docs/api.md, without links to translations`,
  `- [README](${repo}#readme): overview, token estimate accuracy, comparison with other packages`,
  `- [Changelog](${repo}/blob/main/CHANGELOG.md)`,
  '',
)

const files = { 'llms.txt': index.join('\n'), 'llms-full.txt': reference }
const check = process.argv.includes('--check')
const stale = []
for (const [name, content] of Object.entries(files)) {
  const url = new URL(name, root)
  if (!check) writeFileSync(url, content)
  else if (!existsSync(url) || readFileSync(url, 'utf8') !== content) stale.push(name)
}
if (stale.length) {
  console.error(`${stale.join(', ')} out of date: run node scripts/llms.mjs`)
  process.exit(1)
}
console.log(
  check ? 'llms ok: llms.txt and llms-full.txt match docs/api.md' : 'wrote llms.txt, llms-full.txt',
)
