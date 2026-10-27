// The single recursive-descent JSON core. Repair levels are flags on the same functions, not
// separate parsers: 'none' matches JSON.parse, 'syntax' fixes what models get wrong, 'full' also
// closes a Truncation. Partial mode (#7) extends the same functions.
import type { Issue } from './issue'
import {
  type Cursor,
  scanNumber,
  scanString,
  scanWord,
  skipComment,
  skipWhitespace,
  type StringProgress,
} from './scanner'

/**
 * How much Repair the parser may do: none (strict JSON), syntax fixes, or also Truncation.
 * `'partial'` is `'full'` for JSON still arriving: a number or literal that touches the end of
 * the text is left out, because more text may still change it (`1` → `12`, `tru` → `true`).
 */
export type Repair = 'none' | 'syntax' | 'full' | 'partial'

export type ParseError = 'unparseable' | 'truncated' | 'max_depth'

/**
 * Where a partial parse the end of the text cut off can go on once more text arrives: one per
 * container or string still open there. Everything before `resumeAt` is final: values that
 * ended are never parsed again. A container in phase `value` reads no text of its own; its open
 * member is the next Checkpoint.
 */
export type Checkpoint =
  | ({ kind: 'string'; start: number; quote: number } & StringProgress)
  | {
      kind: 'object' | 'array'
      start: number
      /** The container as it was returned; resuming copies it before changing it. */
      value: Record<string, unknown> | unknown[]
      /** `member`: before a member, `value`: inside its value, `after`: after its value. */
      phase: 'member' | 'value' | 'after'
      resumeAt: number
      first: boolean
      commaAt: number
      /** The key (an array's index) of the member whose value is open, in phase `value`. */
      key: string | number
    }

export type ParseResult =
  | {
      ok: true
      value: unknown
      end: number
      issues: Issue[]
      /** Partial mode only, when the end of the text cut the value off: outermost first. */
      checkpoints?: Checkpoint[]
    }
  | {
      ok: false
      error: ParseError
      at: number
      issues: Issue[]
      /** Starts of the objects and arrays still open where parsing failed, outermost first. */
      open: number[]
    }

export interface ParseOptions {
  /** Default `'none'`. */
  repair?: Repair
  /** Maximum nesting of objects and arrays. Deeper input fails with `max_depth`. */
  maxDepth?: number
  /**
   * Partial mode: go on from the Checkpoints of a parse of a shorter text that this text extends,
   * instead of parsing from the start. The result is the same, but `issues` only holds what the
   * text after the Checkpoints adds.
   */
  resume?: Checkpoint[]
}

/** Far beyond real data, and shallow enough for the call stack of every supported runtime. */
export const DEFAULT_MAX_DEPTH = 512

const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const QUOTE = 0x22
const APOS = 0x27
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

/** A value the text ended before (only returned under `repair: 'full'`). */
const MISSING: unique symbol = Symbol('missing')

interface State extends Cursor {
  readonly maxDepth: number
  readonly lenient: boolean
  readonly closeTruncated: boolean
  readonly partial: boolean
  readonly issues: Issue[]
  /** Characters appended so far to close a Truncation, innermost first. */
  closed: string
  truncated: boolean
  /** Starts of the containers being parsed, outermost first. */
  readonly open: number[]
  /** Partial mode: where to go on later, innermost first (pushed as a Truncation unwinds). */
  readonly checkpoints: Checkpoint[] | undefined
  /** What `resume` still has to go on from. */
  readonly resume: Checkpoint[]
  resumed: number
}

const WORDS = ['true', 'false', 'null']
const LENIENT_WORDS = [...WORDS, 'True', 'False', 'None', 'NaN', 'Infinity', '-Infinity']
const PYTHON_LITERALS: [string, boolean | null][] = [
  ['True', true],
  ['False', false],
  ['None', null],
]
const NON_FINITE = ['NaN', 'Infinity', '-Infinity']

function fail(s: State): never {
  throw new Failure('unparseable', s.pos)
}

const atEnd = (s: State): boolean => s.pos >= s.text.length
const code = (s: State): number => s.text.charCodeAt(s.pos)

/** The text ended mid-value: a failure, unless Truncation may be closed. */
function truncate(s: State): void {
  s.pos = s.text.length
  if (!s.closeTruncated) throw new Failure('truncated', s.pos)
  s.truncated = true
}

function close<T>(s: State, value: T, closer: string): T {
  truncate(s)
  s.closed += closer
  return value
}

/** `close` for a container, noting where a partial parse goes on from. */
function cut<T>(s: State, value: T, closer: string, checkpoint: Checkpoint): T {
  s.checkpoints?.push(checkpoint)
  return close(s, value, closer)
}

/** Skips whitespace and, when lenient, comments. */
function skip(s: State): void {
  skipWhitespace(s)
  if (!s.lenient) return
  for (;;) {
    const at = s.pos
    if (!skipComment(s)) return
    s.issues.push({ code: 'comment_removed', at })
    skipWhitespace(s)
  }
}

/** A JSON value, or MISSING. (`unknown` already includes the symbol, so the type cannot say so.) */
function parseValue(s: State, depth: number): unknown {
  skip(s)
  if (atEnd(s)) {
    truncate(s)
    return MISSING
  }
  const ch = code(s)
  if (ch === OPEN_BRACE || ch === OPEN_BRACKET) {
    if (depth >= s.maxDepth) throw new Failure('max_depth', s.pos)
    // Not popped when parsing throws, so a failure knows which containers it is inside.
    s.open.push(s.pos)
    const value = parseContainer(s, depth + 1, ch === OPEN_BRACE)
    s.open.pop()
    return value
  }
  if (ch === QUOTE || (s.lenient && ch === APOS)) return parseString(s)
  const value = parseScalar(s, ch)
  if (s.partial && value !== MISSING && atEnd(s)) {
    truncate(s)
    return MISSING
  }
  return value
}

/** `parseValue` for the open value of the next Checkpoint; reads no text before its `resumeAt`. */
function resumeValue(s: State, depth: number): unknown {
  const from = s.resume[s.resumed++]!
  if (from.kind === 'string') return parseString(s, from)
  s.open.push(from.start)
  const value = parseContainer(s, depth + 1, from.kind === 'object', from)
  s.open.pop()
  return value
}

/** A number or literal (true, false, null and, when lenient, Python literals, NaN, Infinity). */
function parseScalar(s: State, ch: number): unknown {
  // T(rue) F(alse) N(one, NaN) I(nfinity) -(Infinity): checked only when the first char can match.
  if (s.lenient && (ch === 0x54 || ch === 0x46 || ch === 0x4e || ch === 0x49 || ch === MINUS)) {
    const at = s.pos
    for (const [word, value] of PYTHON_LITERALS) {
      if (scanWord(s, word)) {
        s.issues.push({ code: 'python_literal', at })
        return value
      }
    }
    for (const word of NON_FINITE) {
      if (scanWord(s, word)) {
        s.issues.push({ code: 'non_finite_number', at })
        return null
      }
    }
  }
  // A literal the text cuts off (`tru`, `-Inf`) is a Truncation, not a syntax error. Checked
  // before numbers, so that `-Inf` does not fail as one.
  const rest = s.text.length - s.pos < 10 ? s.text.slice(s.pos) : ''
  const words = s.lenient ? LENIENT_WORDS : WORDS
  if (rest && words.some((w) => w.length > rest.length && w.startsWith(rest))) {
    truncate(s)
    return MISSING
  }
  if (ch === MINUS || (ch >= 0x30 && ch <= 0x39)) return parseNumber(s)
  if (scanWord(s, 'true')) return true
  if (scanWord(s, 'false')) return false
  if (scanWord(s, 'null')) return null
  return fail(s)
}

function parseNumber(s: State): number | typeof MISSING {
  const start = s.pos
  const n = scanNumber(s)
  if (n !== undefined) return n
  if (!atEnd(s)) return fail(s)
  // Cut off mid-number (`1.`, `1e+`, `-`): keep the longest prefix that is a number.
  truncate(s)
  let end = s.text.length
  while (end > start && '.eE+-'.includes(s.text.charAt(end - 1))) end--
  return end === start ? MISSING : Number(s.text.slice(start, end))
}

function parseString(s: State, from?: StringCheckpoint): string {
  const at = from ? from.start : s.pos
  const quote = from ? from.quote : code(s)
  if (quote === APOS && !from) s.issues.push({ code: 'single_quotes', at })
  const scanned = scanString(s, quote, s.lenient, from)
  if (!scanned) return fail(s)
  if (scanned.controlAt >= 0 && !(from && from.controlAt >= 0))
    s.issues.push({ code: 'unescaped_control_char', at: scanned.controlAt })
  if (!scanned.terminated) {
    const { value, resumeAt = s.pos, controlAt } = scanned
    s.checkpoints?.push({ kind: 'string', start: at, quote, value, resumeAt, controlAt })
    truncate(s)
    s.closed += '"'
  }
  return scanned.value
}

export const isKeyChar = (ch: number): boolean =>
  (ch >= 0x61 && ch <= 0x7a) || // a-z
  (ch >= 0x41 && ch <= 0x5a) || // A-Z
  (ch >= 0x30 && ch <= 0x39) || // 0-9
  ch === 0x5f || // _
  ch === 0x24 || // $
  ch === MINUS ||
  ch >= 0x80

/** An object key; MISSING when the text cuts the key off (the dangling key is dropped). */
function parseKey(s: State): string | typeof MISSING {
  const ch = code(s)
  if (ch === QUOTE || (s.lenient && ch === APOS)) {
    if (ch === APOS) s.issues.push({ code: 'single_quotes', at: s.pos })
    const scanned = scanString(s, ch, s.lenient)
    if (!scanned) return fail(s)
    if (scanned.controlAt >= 0) {
      s.issues.push({ code: 'unescaped_control_char', at: scanned.controlAt })
    }
    if (!scanned.terminated) {
      truncate(s)
      return MISSING
    }
    return scanned.value
  }
  if (s.lenient && isKeyChar(ch)) {
    const at = s.pos
    let i = at
    while (i < s.text.length && isKeyChar(s.text.charCodeAt(i))) i++
    s.issues.push({ code: 'unquoted_key', at })
    s.pos = i
    return s.text.slice(at, i)
  }
  return fail(s)
}

/** An object or array, indexed by key or index. */
type Container = Record<string | number, unknown>

const copyArray = (array: Container): Container => (array as unknown as unknown[]).slice() as never

function setKey(container: Container, key: string | number, value: unknown): void {
  // An own `__proto__` property, as JSON.parse creates; plain assignment would set the prototype.
  if (key === '__proto__') {
    Object.defineProperty(container, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  } else {
    container[key] = value
  }
}

/** After a comma: true if a closing `closer` follows (a trailing comma, fixed when lenient). */
function trailingComma(s: State, closer: number, commaAt: number): boolean {
  if (code(s) !== closer) return false
  if (!s.lenient) fail(s)
  s.issues.push({ code: 'trailing_comma', at: commaAt })
  s.pos++
  return true
}

type StringCheckpoint = Extract<Checkpoint, { kind: 'string' }>
type ContainerCheckpoint = Exclude<Checkpoint, StringCheckpoint>

/** Where a container is in its loop. */
type Progress = Pick<ContainerCheckpoint, 'phase' | 'first' | 'commaAt' | 'key'>

/** A new container: before its first member. */
const FRESH: Progress = { phase: 'member', first: true, commaAt: -1, key: '' }

/**
 * An object or array. The loop goes through three phases: `member` (just after the opening
 * bracket or a comma), `value` and `after` (after a value); an array's key is the index. The
 * end of the text breaks out of the loop into one `cut`, and resuming from a Checkpoint
 * re-enters the loop at its phase. A resumed container is copied before its first change and
 * returned as it was if nothing changed, so values returned earlier never change and an
 * unchanged value is cheap to recognise.
 */
function parseContainer(
  s: State,
  depth: number,
  object: boolean,
  from?: ContainerCheckpoint,
): Container {
  const closer = object ? CLOSE_BRACE : CLOSE_BRACKET
  const start = from ? from.start : s.pos
  let container = (from ? from.value : object ? {} : []) as Container
  let owned = !from
  let { phase, first, commaAt, key }: Progress = from ?? FRESH
  s.pos = from ? from.resumeAt : s.pos + 1
  let resumeAt: number
  for (;;) {
    resumeAt = s.pos
    if (phase === 'member') {
      skip(s)
      if (atEnd(s)) break
      if (first && code(s) === closer) {
        s.pos++
        return container
      }
      if (!first && trailingComma(s, closer, commaAt)) return container
      if (object) {
        const parsed = parseKey(s)
        if (parsed === MISSING) break
        key = parsed
        skip(s)
        if (atEnd(s)) break
        if (code(s) !== COLON) fail(s)
        s.pos++
      } else {
        key = (container as unknown as unknown[]).length
      }
    }
    if (phase !== 'after') {
      const value = phase === 'value' ? resumeValue(s, depth) : parseValue(s, depth)
      if (value === MISSING) break
      if (owned || container[key] !== value) {
        if (!owned) container = object ? { ...container } : copyArray(container)
        owned = true
        setKey(container, key, value)
      }
      if (s.truncated) {
        phase = 'value'
        break
      }
      resumeAt = s.pos
    }
    phase = 'after'
    skip(s)
    if (atEnd(s)) break
    const next = code(s)
    if (next === closer) {
      s.pos++
      return container
    }
    if (next !== COMMA) fail(s)
    commaAt = s.pos
    s.pos++
    first = false
    phase = 'member'
  }
  const kind = object ? 'object' : 'array'
  const checkpoint = {
    kind,
    start,
    value: container,
    phase,
    resumeAt,
    first,
    commaAt,
    key,
  } as const
  return cut(s, container, object ? '}' : ']', checkpoint)
}

function run(text: string, start: number, options: ParseOptions, whole: boolean): ParseResult {
  const repair = options.repair ?? 'none'
  const s: State = {
    text,
    pos: start,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    lenient: repair !== 'none',
    closeTruncated: repair === 'full' || repair === 'partial',
    partial: repair === 'partial',
    issues: [],
    closed: '',
    truncated: false,
    open: [],
    checkpoints: repair === 'partial' ? [] : undefined,
    resume: options.resume ?? [],
    resumed: 0,
  }
  try {
    const value = options.resume ? resumeValue(s, 0) : parseValue(s, 0)
    if (value === MISSING) {
      return { ok: false, error: 'truncated', at: s.pos, issues: s.issues, open: [] }
    }
    if (s.truncated) s.issues.push({ code: 'truncated_closed', closed: s.closed })
    const end = s.pos
    if (whole) {
      skip(s)
      if (!atEnd(s))
        return { ok: false, error: 'unparseable', at: s.pos, issues: s.issues, open: [] }
    }
    if (s.truncated && s.checkpoints) {
      return { ok: true, value, end, issues: s.issues, checkpoints: s.checkpoints.reverse() }
    }
    return { ok: true, value, end, issues: s.issues }
  } catch (error) {
    if (error instanceof Failure) {
      return { ok: false, error: error.error, at: error.at, issues: s.issues, open: s.open }
    }
    throw error
  }
}

/** Parses one value starting at `start` (leading whitespace allowed); `end` is just past it. */
export function parseValueAt(text: string, start: number, options: ParseOptions = {}): ParseResult {
  return run(text, start, options, false)
}

/** Parses the whole text as one value; only whitespace (and, when lenient, comments) may surround it. */
export function parseJson(text: string, options: ParseOptions = {}): ParseResult {
  return run(text, 0, options, true)
}
