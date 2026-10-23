// Type-checks every TypeScript example in the English docs against the source. The translations
// carry the same code (scripts/check-i18n.mjs), so checking English covers them.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseMarkdown } from './markdown.mjs'

const root = new URL('../', import.meta.url)
const out = new URL('.examples/', root)
const docs = ['README.md', 'docs/api.md']

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
let count = 0
for (const doc of docs) {
  const { blocks } = parseMarkdown(readFileSync(new URL(doc, root), 'utf8'))
  for (const block of blocks) {
    if (block.lang !== 'ts') continue
    // Named after the doc and line, so tsc errors point at the example. `export {}` makes each
    // example a module of its own, with top-level await.
    const name = `${doc.replace(/\W/g, '_')}_L${block.line}.ts`
    writeFileSync(new URL(name, out), `${block.code}\nexport {}\n`)
    count++
  }
}
// Examples may print with `process.stdout`; the package itself has no Node types.
writeFileSync(
  new URL('globals.d.ts', out),
  'declare const process: {\n  env: Record<string, string | undefined>\n  stdout: { write(text: string): void }\n}\n',
)
writeFileSync(
  new URL('tsconfig.json', out),
  JSON.stringify({ extends: '../tsconfig.json', include: ['*.ts'] }, null, 2),
)

const result = spawnSync('tsc -p .examples', {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
  shell: true,
})
if (result.status !== 0) {
  console.error('Examples failed to type-check; the generated files are in .examples/')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
console.log(`examples ok: ${count} TypeScript blocks type-check`)
