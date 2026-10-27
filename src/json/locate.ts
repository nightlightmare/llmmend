// Finding JSON in a Reply: every `{` or `[` is a possible start, tried in order with the parser
// core. A start that parses becomes a Candidate and the scan resumes after it, so values nested
// inside a Candidate are never Candidates themselves.
import type { Issue } from './issue'
import { isKeyChar, type ParseError, parseValueAt, type Repair } from './parser'

export interface Candidate {
  start: number
  end: number
  value: unknown
  issues: Issue[]
}

export interface Located {
  candidates: Candidate[]
  /** Why the most informative failed start failed; `truncated` and `max_depth` end the scan. */
  failure?: { error: ParseError; at: number; issues: Issue[] }
}

/**
 * How many characters failed starts may scan in total, per character of the Reply. Real Replies
 * never come close; it bounds pathological input whose failing starts overlap.
 */
export const FAILED_SCAN_BUDGET = 8

export const OPEN_BRACE = 0x7b
export const OPEN_BRACKET = 0x5b

/** What the start check says: a value may start, cannot, or may only because the text ends. */
export const MAY = 1
export const CANNOT = 2
export const AT_END = 3
type Start = typeof MAY | typeof CANNOT | typeof AT_END

/**
 * A cheap look at what follows a `{` or `[`, to skip most prose without running the parser:
 * an object needs a key or `}`, an array a value or `]`. The end of the text always passes,
 * so a cut-off start is still reported.
 */
function mayStart(text: string, i: number, lenient: boolean): Start {
  const j = nextSignificant(text, i)
  const ch = text.charCodeAt(j)
  if (j >= text.length) return AT_END
  if (lenient && (ch === 0x2f || ch === 0x27)) return MAY // `/`, `'`
  return looksLikeValue(text.charCodeAt(i), ch, lenient) ? MAY : CANNOT
}

function looksLikeValue(opener: number, ch: number, lenient: boolean): boolean {
  if (opener === OPEN_BRACE) {
    return ch === 0x22 || ch === 0x7d || (lenient && isKeyChar(ch)) // `"`, `}`, bare key
  }
  return (
    ch === 0x5d || // ]
    ch === OPEN_BRACE ||
    ch === OPEN_BRACKET ||
    ch === 0x22 || // "
    ch === 0x2d || // -
    (ch >= 0x30 && ch <= 0x39) ||
    ch === 0x74 || // t(rue)
    ch === 0x66 || // f(alse)
    ch === 0x6e || // n(ull)
    (lenient && (ch === 0x54 || ch === 0x46 || ch === 0x4e || ch === 0x49)) // T F N I
  )
}

/** Index of the first non-whitespace character after `i`. */
function nextSignificant(text: string, i: number): number {
  let j = i + 1
  let ch = text.charCodeAt(j)
  while (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09) ch = text.charCodeAt(++j)
  return j
}

const isOpener = (ch: number): boolean => ch === OPEN_BRACE || ch === OPEN_BRACKET

/**
 * `mayStart` for every start, memoised. An array whose first element is another container can
 * start only if that container can, so a run like `[[[[{{` is settled by one walk along it
 * instead of a parse attempt per bracket.
 */
export function createStartCheck(text: string, lenient: boolean): (i: number) => Start {
  const memo = new Uint8Array(text.length) // 0 unknown, else a Start
  return (i) => {
    const chain: number[] = []
    let j = i
    let result: Start
    for (;;) {
      if (memo[j]) {
        result = memo[j] as Start
        break
      }
      chain.push(j)
      const next = nextSignificant(text, j)
      if (text.charCodeAt(j) === OPEN_BRACKET && isOpener(text.charCodeAt(next))) {
        j = next
        continue
      }
      result = mayStart(text, j, lenient)
      break
    }
    for (const k of chain) memo[k] = result
    return result
  }
}

/** With `first`, stops at the first Candidate. */
export function locate(text: string, repair: Repair, first = false): Located {
  const lenient = repair !== 'none'
  const mayStartAt = createStartCheck(text, lenient)
  const candidates: Candidate[] = []
  let failure: Located['failure']
  let budget = FAILED_SCAN_BUDGET * text.length + 4096
  // Starts known to fail: a container parses the same wherever its parse began, so one that was
  // still open when an earlier attempt failed will fail again in the same place.
  const doomed = new Set<number>()
  let i = 0
  while (i < text.length && budget > 0) {
    const ch = text.charCodeAt(i)
    if ((ch !== OPEN_BRACE && ch !== OPEN_BRACKET) || doomed.has(i) || mayStartAt(i) === CANNOT) {
      i++
      continue
    }
    const result = parseValueAt(text, i, { repair })
    if (result.ok) {
      candidates.push({ start: i, end: result.end, value: result.value, issues: result.issues })
      if (first) break
      i = result.end
      continue
    }
    // Everything after a start the text cuts off is inside that value: stop looking. Nesting
    // deep enough for max_depth is pathological: stop too.
    if (result.error !== 'unparseable') return { candidates, failure: result }
    failure ??= result
    for (const start of result.open) doomed.add(start)
    budget -= result.at - i + 1
    i++
  }
  return failure ? { candidates, failure } : { candidates }
}
