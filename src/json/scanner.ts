// Character-level scanners for the JSON parser core. No regexes: every loop is a single
// forward pass over char codes, so time is linear in the input and ReDoS is impossible.

/** Position in the text being scanned; scanners advance `pos` past what they consume. */
export interface Cursor {
  readonly text: string
  pos: number
}

const TAB = 0x09
const LF = 0x0a
const CR = 0x0d
const SPACE = 0x20
const QUOTE = 0x22
const APOS = 0x27
const STAR = 0x2a
const PLUS = 0x2b
const MINUS = 0x2d
const DOT = 0x2e
const SLASH = 0x2f
const ZERO = 0x30
const NINE = 0x39
const BACKSLASH = 0x5c

const isDigit = (ch: number): boolean => ch >= ZERO && ch <= NINE

/** Skips JSON whitespace (space, tab, LF, CR). */
export function skipWhitespace(c: Cursor): void {
  const { text } = c
  let i = c.pos
  while (i < text.length) {
    const ch = text.charCodeAt(i)
    if (ch !== SPACE && ch !== LF && ch !== CR && ch !== TAB) break
    i++
  }
  c.pos = i
}

/**
 * Skips one `//` or `/* *\/` comment at the cursor and returns true, or returns false and leaves
 * the cursor alone. An unterminated block comment, or a `/` that is the last character, runs to
 * the end of the text (a Truncation).
 */
export function skipComment(c: Cursor): boolean {
  const { text, pos } = c
  if (text.charCodeAt(pos) !== SLASH) return false
  if (pos + 1 === text.length) {
    c.pos = text.length
    return true
  }
  const next = text.charCodeAt(pos + 1)
  if (next === SLASH) {
    let i = pos + 2
    while (i < text.length && text.charCodeAt(i) !== LF && text.charCodeAt(i) !== CR) i++
    c.pos = i
    return true
  }
  if (next === STAR) {
    const close = text.indexOf('*/', pos + 2)
    c.pos = close === -1 ? text.length : close + 2
    return true
  }
  return false
}

function hexDigit(ch: number): number {
  if (ch >= ZERO && ch <= NINE) return ch - ZERO
  const lower = ch | 0x20
  if (lower >= 0x61 && lower <= 0x66) return lower - 0x61 + 10
  return -1
}

function hex4(text: string, i: number): number {
  let value = 0
  for (let k = 0; k < 4; k++) {
    const d = hexDigit(text.charCodeAt(i + k))
    if (d < 0) return -1
    value = value * 16 + d
  }
  return value
}

const ESCAPES: Record<number, string> = {
  [QUOTE]: '"',
  [BACKSLASH]: '\\',
  [SLASH]: '/',
  0x62: '\b',
  0x66: '\f',
  0x6e: '\n',
  0x72: '\r',
  0x74: '\t',
}

export interface ScannedString {
  value: string
  /** False when the text ended before the closing quote; `value` then holds what was there. */
  terminated: boolean
  /** Position of the first raw control character (lenient only), or -1. */
  controlAt: number
  /**
   * Only when cut off: where scanning goes on once more text arrives (for a cut-off escape, its
   * backslash). `value` is the string up to there.
   */
  resumeAt?: number
}

/** A cut-off string to go on with: what it holds up to `resumeAt`. */
export interface StringProgress {
  value: string
  resumeAt: number
  controlAt: number
}

/** True if every character from `i` to the end of the text is a hex digit. */
function hexToEnd(text: string, i: number): boolean {
  for (let k = i; k < text.length; k++) if (hexDigit(text.charCodeAt(k)) < 0) return false
  return true
}

/**
 * Scans a quoted string starting at the opening `quote` and returns its value. Returns
 * `undefined` with the cursor at the offending position on an invalid escape, or on a raw
 * control character unless `lenient`. A string the text cuts off (even mid-escape) comes back
 * with `terminated: false` and the cursor at the end. `\'` is a valid escape inside `'…'`.
 * With `from`, goes on with a string an earlier scan of a shorter text cut off.
 */
export function scanString(
  c: Cursor,
  quote: number = QUOTE,
  lenient = false,
  from?: StringProgress,
): ScannedString | undefined {
  const { text } = c
  const end = text.length
  let i = from ? from.resumeAt : c.pos + 1
  let chunk = i
  let out = from ? from.value : ''
  let controlAt = from ? from.controlAt : -1
  let resumeAt = end
  while (i < end) {
    const ch = text.charCodeAt(i)
    if (ch === quote) {
      c.pos = i + 1
      return { value: out + text.slice(chunk, i), terminated: true, controlAt }
    }
    if (ch === BACKSLASH) {
      out += text.slice(chunk, i)
      const esc = text.charCodeAt(i + 1)
      const simple = ESCAPES[esc] ?? (quote === APOS && esc === APOS ? "'" : undefined)
      if (simple !== undefined) {
        out += simple
        i += 2
      } else if (esc === 0x75) {
        const code = hex4(text, i + 2)
        if (code < 0) {
          if (!hexToEnd(text, i + 2)) {
            c.pos = i
            return undefined
          }
          resumeAt = i
          i = end // cut off inside \uXXXX: drop the partial escape
        } else {
          // Lone surrogates are kept as-is, like JSON.parse does.
          out += String.fromCharCode(code)
          i += 6
        }
      } else if (i + 1 >= end) {
        resumeAt = i
        i = end // cut off right after the backslash
      } else {
        c.pos = i
        return undefined
      }
      chunk = i
      continue
    }
    if (ch < SPACE) {
      if (!lenient) {
        c.pos = i
        return undefined
      }
      if (controlAt < 0) controlAt = i
    }
    i++
  }
  c.pos = end
  return { value: out + text.slice(chunk, end), terminated: false, controlAt, resumeAt }
}

/**
 * Scans a JSON number (`-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`) and returns its value, or
 * `undefined` with the cursor at the first character that breaks the grammar.
 */
export function scanNumber(c: Cursor): number | undefined {
  const { text } = c
  const start = c.pos
  let i = start
  if (text.charCodeAt(i) === MINUS) i++
  const first = text.charCodeAt(i)
  if (first === ZERO) {
    i++
  } else if (isDigit(first)) {
    while (isDigit(text.charCodeAt(i))) i++
  } else {
    c.pos = i
    return undefined
  }
  if (text.charCodeAt(i) === DOT) {
    i++
    if (!isDigit(text.charCodeAt(i))) {
      c.pos = i
      return undefined
    }
    while (isDigit(text.charCodeAt(i))) i++
  }
  if ((text.charCodeAt(i) | 0x20) === 0x65) {
    i++
    const sign = text.charCodeAt(i)
    if (sign === PLUS || sign === MINUS) i++
    if (!isDigit(text.charCodeAt(i))) {
      c.pos = i
      return undefined
    }
    while (isDigit(text.charCodeAt(i))) i++
  }
  c.pos = i
  return Number(text.slice(start, i))
}

/** Consumes `word` if the text continues with it at the cursor. */
export function scanWord(c: Cursor, word: string): boolean {
  if (!c.text.startsWith(word, c.pos)) return false
  c.pos += word.length
  return true
}
