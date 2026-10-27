// Measures how far `estimateTokens` is from real tokenizers on the calibration corpus, each with
// its own preset, for the README table. Run by a human after `pnpm build`; both token counting
// APIs are free (see token-apis.mjs):
//   node scripts/measure-tokenizers.mjs     (Claude through Bedrock: AWS CLI login)
import { readFile } from 'node:fs/promises'
import { getEncoding } from 'js-tiktoken'
import { estimateTokens } from '../dist/chunk/index.js'
import { claude, gemini } from './token-apis.mjs'

const root = new URL('../', import.meta.url)
const prose = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
const read = (path) => readFile(new URL(path, root), 'utf8')
const samples = {
  English: prose(await read('docs/api.md')),
  Russian: prose(await read('docs/api.ru.md')),
  Chinese: prose(await read('docs/api.zh-CN.md')),
  Japanese: await read('test/fixtures/chunk/corpus/ja.txt'),
  Korean: await read('test/fixtures/chunk/corpus/ko.txt'),
  Code: await read('src/json/parser.ts'),
  'Chat with emoji': await read('test/fixtures/chunk/corpus/chat.txt'),
}

const o200k = getEncoding('o200k_base')

const percent = (estimate, real) => {
  const p = Math.round(((estimate - real) / real) * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`
}
console.log('| Text | `o200k` | `gemini` | `claude` |')
console.log('|---|---|---|---|')
for (const [name, text] of Object.entries(samples)) {
  const [g, c] = [await gemini(text), await claude(text)]
  const o = o200k.encode(text).length
  const off = (tokenizer, real) => percent(estimateTokens(text, { tokenizer }), real)
  console.log(`| ${name} | ${off('o200k', o)} | ${off('gemini', g)} | ${off('claude', c)} |`)
}
