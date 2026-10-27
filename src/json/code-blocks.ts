/** A fenced code block in a Reply. `start` and `end` span it from the opening fence line to the closing one. */
export interface CodeBlock {
  /** The first word of the info string, in lower case; `''` without one. */
  lang: string
  /** The whole info string after the opening fence, e.g. `ts title="app.ts"`. */
  info: string
  /** The content as written, without the line breaks next to the fences. */
  code: string
  start: number
  end: number
  /** False for a block the Reply ends inside, usually at `max_tokens`. */
  complete: boolean
}

export interface ExtractCodeBlocksOptions {
  /** Only blocks in this language; common aliases match (`ts` and `typescript`, `sh` and `bash`). */
  lang?: string
}

// An opening fence: up to three spaces, then three or more backticks or tildes, then the info
// string, which for backticks may not contain a backtick (```inline``` on one line is not a fence).
const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

const ALIASES: string[][] = [
  ['ts', 'typescript'],
  ['js', 'javascript'],
  ['py', 'python'],
  ['sh', 'bash', 'shell', 'zsh'],
  ['yml', 'yaml'],
  ['md', 'markdown'],
]
const canonical = (lang: string): string =>
  ALIASES.find((names) => names.includes(lang))?.[0] ?? lang

/**
 * Every fenced code block (``` or ~~~), in order. A fence closes only with the same character
 * and at least as long a run; a block left open runs to the end of the text. `extractTag` skips
 * these blocks, so both agree on what code is.
 */
export function fencedBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let open: { marker: string; info: string; start: number; body: number } | undefined
  let at = 0
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!open) {
      const m = OPEN.exec(line)
      if (m && !(m[1]![0] === '`' && m[2]!.includes('`')))
        open = { marker: m[1]!, info: m[2]!.trim(), start: at, body: at + raw.length + 1 }
    } else {
      const m = CLOSE.exec(line)
      if (m && m[1]![0] === open.marker[0] && m[1]!.length >= open.marker.length) {
        blocks.push(block(text, open, Math.max(open.body, at - 1), at + raw.length, true))
        open = undefined
      }
    }
    at += raw.length + 1
  }
  if (open) blocks.push(block(text, open, text.length, text.length, false))
  return blocks
}

function block(
  text: string,
  open: { info: string; start: number; body: number },
  codeEnd: number,
  end: number,
  complete: boolean,
): CodeBlock {
  const code = text.slice(Math.min(open.body, codeEnd), codeEnd).replace(/\r$/, '')
  return {
    // split always returns at least one string, '' for an empty info string.
    lang: open.info.split(/\s/, 1)[0]!.toLowerCase(),
    info: open.info,
    code,
    start: open.start,
    end,
    complete,
  }
}

/**
 * Every fenced code block in a Reply, in order: language, info string, content and position.
 * A block the Reply ends inside comes with `complete: false`. Indented code blocks don't count:
 * in model replies they are usually nested lists.
 */
export function extractCodeBlocks(
  text: string,
  options: ExtractCodeBlocksOptions = {},
): CodeBlock[] {
  const blocks = fencedBlocks(text)
  if (options.lang === undefined) return blocks
  const wanted = canonical(options.lang.toLowerCase())
  return blocks.filter((b) => canonical(b.lang) === wanted)
}
