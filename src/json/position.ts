// Where in a text a JSON error happened, for a person reading a log: line, column and a snippet.
import { LlmmendJsonError } from '../shared/errors'
import type { ExtractError, Issue } from './issue'
import type { StandardSchemaV1 } from './schema'

const LF = 0x0a
const CR = 0x0d
/** Characters shown on each side of the position. */
const SIDE = 20

/** Characters (code points) in `text`, so an emoji counts once. */
const length = (text: string): number => [...text].length

/** Line and column of `at`, both from 1; `\n`, `\r\n` and `\r` end a line, columns count characters. */
export function lineAndColumn(text: string, at: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < at; i++) {
    const ch = text.charCodeAt(i)
    if (ch === LF || (ch === CR && text.charCodeAt(i + 1) !== LF)) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: length(text.slice(lineStart, at)) + 1 }
}

/** One line of text around `at` (newlines as `⏎`, tabs as spaces), and a `^` under `at`. */
export function snippet(text: string, at: number): string {
  // Twice SIDE code units hold at least SIDE characters; one cut in half at the far edge falls
  // outside the SIDE kept.
  const before = Array.from(text.slice(Math.max(0, at - 2 * SIDE), at))
    .slice(-SIDE)
    .join('')
  const after = Array.from(text.slice(at, at + 2 * SIDE))
    .slice(0, SIDE)
    .join('')
  const show = (part: string): string => part.replace(/\r\n|\r|\n/g, '⏎').replace(/\t/g, ' ')
  const head = (before.length < at ? '…' : '') + show(before)
  const tail = show(after) + (at + after.length < text.length ? '…' : '')
  return `${head}${tail}\n${' '.repeat(length(head))}^`
}

/** `LlmmendJsonError` for `text`; with `at`, the message says where, with a snippet. */
export function jsonError(
  code: ExtractError,
  what: string,
  text: string,
  issues: readonly Issue[],
  at?: number,
  schemaIssues?: readonly StandardSchemaV1.Issue[],
): LlmmendJsonError {
  if (at === undefined) return new LlmmendJsonError(code, `${what}: ${code}`, issues, schemaIssues)
  const { line, column } = lineAndColumn(text, at)
  const message = `${what}: ${code} at line ${line}, column ${column}\n${snippet(text, at)}`
  return new LlmmendJsonError(code, message, issues, schemaIssues, { at, line, column })
}
