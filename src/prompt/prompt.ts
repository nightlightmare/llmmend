// The input side of `extractTag`: text going into a prompt can't close or forge the prompt's own
// tags. Only the tag names the prompt uses are touched, so code and `a < b` reach the model as
// written.

/** Text `safePrompt` inserts as is, made by `trusted`. */
export interface Trusted {
  readonly trusted: string
}

/** Marks text to insert into `safePrompt` without escaping, e.g. a prompt built by `safePrompt`. */
export const trusted = (text: string): Trusted => ({ trusted: text })

const isTrusted = (value: unknown): value is Trusted =>
  typeof value === 'object' && value !== null && typeof (value as Trusted).trusted === 'string'

// Every tag name in the template, complete or cut off by a substitution.
const NAME = /<\/?([A-Za-z][\w.:-]*)/g
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Turns the `<` of every tag named in `names` into `&lt;`: opening, closing and self-closing,
 * in any case, with attributes, and also cut off (`</document` with no `>`), since a model may
 * read that as the tag too. Other text is unchanged.
 */
export function escapeTags(text: string, names: Iterable<string>): string {
  const list = [...new Set(names)]
  if (!list.length) return text
  // The name must end there: `<documents>` is not `<document>`.
  const tag = new RegExp(`<(?=/?(?:${list.map(escapeRegExp).join('|')})(?![\\w.:-]))`, 'gi')
  return text.replace(tag, '&lt;')
}

function stringify(value: unknown, position: number): string {
  if (value === null || value === undefined)
    throw new TypeError(`safePrompt: substitution ${position} is ${value}`)
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/**
 * Removes the indentation the template's lines share, and a blank first and last line. Only
 * lines that begin in the template count: substituted text keeps its own whitespace.
 */
function dedent(strings: readonly string[]): string[] {
  const parts = [...strings]
  const last = parts.length - 1
  parts[0] = parts[0]!.replace(/^[ \t]*\r?\n/, '')
  parts[last] = parts[last]!.replace(/\r?\n[ \t]*$/, '')
  let common = Infinity
  parts.forEach((part, i) => {
    const lines = part.split('\n')
    lines.forEach((line, j) => {
      // A part's first line after a substitution continues that substitution's line.
      if (i > 0 && j === 0) return
      // A line of only whitespace counts when a substitution follows on it (`    ${doc}`).
      const substitutionFollows = j === lines.length - 1 && i < last
      if (line.trim() || substitutionFollows)
        common = Math.min(common, /^[ \t]*/.exec(line)![0].length)
    })
  })
  if (common === Infinity || !common) return parts
  const indent = new RegExp(`\\n[ \\t]{0,${common}}`, 'g')
  parts[0] = parts[0]!.replace(new RegExp(`^[ \\t]{0,${common}}`), '')
  return parts.map((part) => part.replace(indent, '\n'))
}

/**
 * A template tag for prompts. Each substitution is escaped for the tag names the template uses
 * (`escapeTags`), so user text can't close `<document>` or open `<instructions>`. Objects and
 * arrays go in as indented JSON; `null` and `undefined` throw. The indentation the template's
 * lines share is removed, along with a blank first and last line.
 */
export function safePrompt(strings: TemplateStringsArray, ...values: unknown[]): string {
  const names = new Set<string>()
  for (const part of strings) for (const m of part.matchAll(NAME)) names.add(m[1]!)
  const parts = dedent(strings)
  let out = parts[0]!
  values.forEach((value, i) => {
    out += isTrusted(value) ? value.trusted : escapeTags(stringify(value, i + 1), names)
    out += parts[i + 1]!
  })
  return out
}
