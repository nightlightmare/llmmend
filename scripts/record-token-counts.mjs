// Records exact Claude and Gemini token counts for the accuracy corpus: every whole text and every
// window test/chunk/accuracy.test.ts checks, into test/fixtures/chunk/counts/<tokenizer>.json.
// Rerun after changing the corpus; both APIs are free:
//   node scripts/record-token-counts.mjs [claude] [gemini]     (Claude: AWS CLI login)
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { CLAUDE_MODEL, claude, GEMINI_MODEL, gemini, pool } from './token-apis.mjs'

const fixtures = new URL('../test/fixtures/chunk/', import.meta.url)

/** The corpus as the accuracy test names it. */
async function corpus() {
  const texts = new Map()
  for (const [dir, name] of [
    ['repo', (file) => file.replaceAll('__', '/').replace(/\.txt$/, '')],
    ['corpus', (file) => `corpus/${file}`],
  ]) {
    for (const file of (await readdir(new URL(`${dir}/`, fixtures))).toSorted()) {
      texts.set(name(file), await readFile(new URL(`${dir}/${file}`, fixtures), 'utf8'))
    }
  }
  return texts
}

/** Overlapping windows of `size` characters, every `size / 2`: as in the accuracy test. */
function windows(text, size) {
  const out = []
  for (let i = 0; i + size <= text.length; i += size / 2) out.push(text.slice(i, i + size))
  return out
}

const tokenizers = { claude: [CLAUDE_MODEL, claude], gemini: [GEMINI_MODEL, gemini] }
const chosen = process.argv.slice(2)
const texts = await corpus()

for (const [tokenizer, [model, count]] of Object.entries(tokenizers)) {
  if (chosen.length && !chosen.includes(tokenizer)) continue
  const record = { model, texts: {} }
  for (const [name, text] of texts) {
    const [whole, w1000, w600] = await Promise.all([
      count(text),
      pool(windows(text, 1000), 8, count),
      pool(windows(text, 600), 8, count),
    ])
    record.texts[name] = { whole, 1000: w1000, 600: w600 }
    console.log(`${tokenizer}: ${name}`)
  }
  await writeFile(
    new URL(`counts/${tokenizer}.json`, fixtures),
    JSON.stringify(record, null, 1) + '\n',
  )
}
