// Checks that the translations of each user-facing doc stay in step with the English source
// (ADR 0003): the same headings in the same order, and the same code blocks once comments,
// which are translated, are stripped. Also checks that the READMEs use only absolute links,
// because npm does not resolve relative ones.
//
//   node scripts/check-i18n.mjs              the docs of this repo
//   node scripts/check-i18n.mjs a.md ...     English files given by hand (each with .zh-CN, .ru)
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseMarkdown } from './markdown.mjs'

const LANGUAGES = ['zh-CN', 'ru']
const root = new URL('../', import.meta.url)

/** Code without comments and blank lines, so translated comments compare equal. */
function stripComments(code, lang) {
  const stripped =
    lang === 'bash' || lang === 'sh'
      ? code.replace(/(^|\s)#.*$/gm, '')
      : // `//` after a colon is a URL, not a comment.
        code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  return stripped
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .join('\n')
}

/** Inline code in a heading names an API and must not be translated. */
const codeSpans = (text) => (text.match(/`[^`]+`/g) ?? []).join(' ')

function compareHeadings(a, b, sourceName, translationName) {
  const count = Math.max(a.length, b.length)
  for (let i = 0; i < count; i++) {
    const [x, y] = [a[i], b[i]]
    if (x?.level !== y?.level || codeSpans(x?.text ?? '') !== codeSpans(y?.text ?? '')) {
      return [
        `${translationName}:${y?.line ?? 'end'}: heading "${y?.text ?? '(missing)'}" does not ` +
          `match ${sourceName}:${x?.line ?? 'end'} "${x?.text ?? '(missing)'}"`,
      ]
    }
  }
  return []
}

function compareBlocks(a, b, sourceName, translationName) {
  if (a.length !== b.length)
    return [`${translationName}: ${b.length} code blocks, ${sourceName} has ${a.length}`]
  const problems = []
  a.forEach((x, i) => {
    const y = b[i]
    if (x.lang !== y.lang || stripComments(x.code, x.lang) !== stripComments(y.code, y.lang)) {
      problems.push(
        `${translationName}:${y.line}: code block differs from ${sourceName}:${x.line} ` +
          '(comments aside)',
      )
    }
  })
  return problems
}

function relativeLinks(text, name) {
  const problems = []
  text.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!/^(https?:|mailto:|#)/.test(match[1]))
        problems.push(`${name}:${i + 1}: relative link ${match[1]} (npm needs absolute URLs)`)
    }
  })
  return problems
}

const given = process.argv.slice(2)
const docs = given.length
  ? given.map((f) => pathToFileURL(f))
  : [new URL('README.md', root), new URL('docs/api.md', root)]

const problems = []
for (const doc of docs) {
  const name = doc.pathname.split('/').pop()
  const source = readFileSync(doc, 'utf8')
  const parsed = parseMarkdown(source)
  const isReadme = name.startsWith('README')
  if (isReadme) problems.push(...relativeLinks(source, name))
  for (const lang of LANGUAGES) {
    const file = new URL(doc.href.replace(/\.md$/, `.${lang}.md`))
    const translationName = file.pathname.split('/').pop()
    let translation
    try {
      translation = readFileSync(file, 'utf8')
    } catch {
      problems.push(`${translationName}: missing`)
      continue
    }
    const other = parseMarkdown(translation)
    problems.push(...compareHeadings(parsed.headings, other.headings, name, translationName))
    problems.push(...compareBlocks(parsed.blocks, other.blocks, name, translationName))
    if (isReadme) problems.push(...relativeLinks(translation, translationName))
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log(`i18n ok: ${docs.length} docs × ${LANGUAGES.length + 1} languages`)
