// The single recursive-descent JSON core. This is strict mode, matching JSON.parse;
// lenient (#5) and partial (#7) modes extend the same functions rather than forking them.
import { type Cursor, scanNumber, scanString, scanWord, skipWhitespace } from './scanner'

export type ParseError = 'unparseable' | 'max_depth'

export type ParseResult =
  | { ok: true; value: unknown; end: number }
  | { ok: false; error: ParseError; at: number }

export interface ParseOptions {
  /** Maximum nesting of objects and arrays. Deeper input fails with `max_depth`. */
  maxDepth?: number
}

/** Far beyond real data, and shallow enough for the call stack of every supported runtime. */
export const DEFAULT_MAX_DEPTH = 512

const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const QUOTE = 0x22
const COLON = 0x3a
const COMMA = 0x2c
const MINUS = 0x2d

// Thrown inside the descent and caught at the entry points. A plain object, not an Error:
// failing Candidates are common during Extraction and must not pay for a stack trace.
class Failure {
  readonly error: ParseError
  readonly at: number
  constructor(error: ParseError, at: number) {
    this.error = error
    this.at = at
  }
}

interface State extends Cursor {
  readonly maxDepth: number
}

function fail(s: State): never {
  throw new Failure('unparseable', s.pos)
}

function parseValue(s: State, depth: number): unknown {
  skipWhitespace(s)
  const ch = s.text.charCodeAt(s.pos)
  if (ch === OPEN_BRACE || ch === OPEN_BRACKET) {
    if (depth >= s.maxDepth) throw new Failure('max_depth', s.pos)
    return ch === OPEN_BRACE ? parseObject(s, depth + 1) : parseArray(s, depth + 1)
  }
  if (ch === QUOTE) return parseString(s)
  if (ch === MINUS || (ch >= 0x30 && ch <= 0x39)) {
    const n = scanNumber(s)
    return n === undefined ? fail(s) : n
  }
  if (scanWord(s, 'true')) return true
  if (scanWord(s, 'false')) return false
  if (scanWord(s, 'null')) return null
  return fail(s)
}

function parseString(s: State): string {
  const value = scanString(s)
  return value === undefined ? fail(s) : value
}

function parseObject(s: State, depth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  s.pos++
  skipWhitespace(s)
  if (s.text.charCodeAt(s.pos) === CLOSE_BRACE) {
    s.pos++
    return obj
  }
  for (;;) {
    skipWhitespace(s)
    if (s.text.charCodeAt(s.pos) !== QUOTE) fail(s)
    const key = parseString(s)
    skipWhitespace(s)
    if (s.text.charCodeAt(s.pos) !== COLON) fail(s)
    s.pos++
    const value = parseValue(s, depth)
    // An own `__proto__` property, as JSON.parse creates; plain assignment would set the prototype.
    if (key === '__proto__') {
      Object.defineProperty(obj, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    } else {
      obj[key] = value
    }
    skipWhitespace(s)
    const next = s.text.charCodeAt(s.pos)
    s.pos++
    if (next === CLOSE_BRACE) return obj
    if (next !== COMMA) {
      s.pos--
      fail(s)
    }
  }
}

function parseArray(s: State, depth: number): unknown[] {
  const arr: unknown[] = []
  s.pos++
  skipWhitespace(s)
  if (s.text.charCodeAt(s.pos) === CLOSE_BRACKET) {
    s.pos++
    return arr
  }
  for (;;) {
    arr.push(parseValue(s, depth))
    skipWhitespace(s)
    const next = s.text.charCodeAt(s.pos)
    s.pos++
    if (next === CLOSE_BRACKET) return arr
    if (next !== COMMA) {
      s.pos--
      fail(s)
    }
  }
}

/** Parses one value starting at `start` (leading whitespace allowed); `end` is just past it. */
export function parseValueAt(text: string, start: number, options: ParseOptions = {}): ParseResult {
  const s: State = { text, pos: start, maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH }
  try {
    const value = parseValue(s, 0)
    return { ok: true, value, end: s.pos }
  } catch (error) {
    if (error instanceof Failure) return { ok: false, error: error.error, at: error.at }
    throw error
  }
}

/** Parses the whole text as one JSON value; only whitespace may surround it. */
export function parseJson(text: string, options: ParseOptions = {}): ParseResult {
  const result = parseValueAt(text, 0, options)
  if (!result.ok) return result
  const c = { text, pos: result.end }
  skipWhitespace(c)
  return c.pos === text.length ? result : { ok: false, error: 'unparseable', at: c.pos }
}
