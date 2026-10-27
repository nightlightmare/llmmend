import { LlmmendError } from '../shared/errors'
import { type Coerced, coerceAsync, coerceSync } from './coerce'
import type { ExtractError, Issue } from './issue'
import { type Candidate, locate } from './locate'
import { type PartialCandidate, PartialScan } from './partial-scan'
import { jsonError } from './position'
import type { StandardSchemaV1 } from './schema'

export interface ExtractOptions<T> {
  /** Any Standard Schema: zod ≥ 3.24, valibot ≥ 1, arktype. */
  schema?: StandardSchemaV1<unknown, T>
  /** Which Candidate to use when the Reply has several. Default `'last'`. */
  pick?: 'first' | 'last' | 'largest'
  /**
   * `'full'` (default) fixes syntax and closes a Truncation; `'syntax'` fixes syntax but returns
   * `error: 'truncated'` for a cut-off value; `'none'` parses strictly, leaving only Extraction.
   */
  repair?: 'full' | 'syntax' | 'none'
  /** Only consider objects or arrays. Default `'any'` (either). */
  expect?: 'object' | 'array' | 'any'
  /**
   * With a schema: when it rejects the value, try the type slips models make (`"42"` ↔ `42`,
   * `"true"` ↔ `true`, `"null"` → `null`) at the paths it names, keeping a change only when the
   * issue at that path goes away. Each change kept is an Issue `coerced`. Default `false`.
   */
  coerce?: boolean
}

export type ExtractResult<T> =
  | { ok: true; value: T; repaired: boolean; issues: Issue[]; raw: string }
  | {
      ok: false
      error: 'schema_mismatch'
      issues: Issue[]
      schemaIssues: readonly StandardSchemaV1.Issue[]
      value: unknown
    }
  | {
      ok: false
      error: Exclude<ExtractError, 'schema_mismatch'>
      issues: Issue[]
      /** Where parsing failed in the Reply, for `unparseable` and `truncated`. */
      at?: number
    }

type Failure = Extract<ExtractResult<never>, { ok: false }>
type Selected = { ok: true; candidate: Candidate; issues: Issue[]; raw: string }

const FENCE = '```'

function isWordChar(ch: number): boolean {
  return (
    (ch >= 0x61 && ch <= 0x7a) ||
    (ch >= 0x41 && ch <= 0x5a) ||
    (ch >= 0x30 && ch <= 0x39) ||
    ch === 0x2d ||
    ch === 0x5f
  )
}

/** Describes the text around the Candidate, or returns undefined if there is none. */
function wrapperDetail(text: string, c: Candidate): string | undefined {
  let before = text.slice(0, c.start).trimEnd()
  let after = text.slice(c.end).trimStart()
  let fence = false
  const open = before.lastIndexOf(FENCE)
  if (open !== -1) {
    let i = open + FENCE.length
    while (i < before.length && isWordChar(before.charCodeAt(i))) i++
    if (i === before.length) {
      fence = true
      before = before.slice(0, open).trimEnd()
    }
  }
  if (after.startsWith(FENCE)) {
    fence = true
    after = after.slice(FENCE.length).trimStart()
  }
  const parts: string[] = []
  if (fence) parts.push('code fence')
  if (before) parts.push('text before')
  if (after) parts.push('text after')
  return parts.length ? parts.join(', ') : undefined
}

function matches(value: unknown, expect: ExtractOptions<unknown>['expect']): boolean {
  if (expect === 'object') return !Array.isArray(value)
  if (expect === 'array') return Array.isArray(value)
  return true
}

/** The Candidate `pick` chooses; `wanted` must not be empty. */
function choose<C extends { start: number; end: number }>(
  wanted: C[],
  pick: ExtractOptions<unknown>['pick'] = 'last',
): C {
  let candidate = pick === 'first' ? wanted[0]! : wanted[wanted.length - 1]!
  if (pick === 'largest') {
    for (const c of wanted) if (c.end - c.start > candidate.end - candidate.start) candidate = c
  }
  return candidate
}

const size = (c: PartialCandidate): number => c.end - c.start

/**
 * Follows a Reply that arrives in pieces. After each piece, returns the Candidate `pick` would
 * choose from the text so far, parsed the way `parsePartialJson` parses; `undefined` while no
 * object or array (of the `expect`ed kind) has started. `streamJson` shows it as `partial`.
 */
export function followPartial(
  opts: Pick<ExtractOptions<unknown>, 'pick' | 'expect'>,
): (piece: string) => PartialCandidate | undefined {
  const scan = new PartialScan()
  let seen = 0
  // Among the complete Candidates that match, the ones some `pick` chooses: `choose` over these
  // and the open Candidate gives what it would give over all of them.
  let first: PartialCandidate | undefined
  let largest: PartialCandidate | undefined
  let last: PartialCandidate | undefined
  return (piece) => {
    scan.push(piece)
    for (; seen < scan.complete.length; seen++) {
      const c = scan.complete[seen]!
      if (!matches(c.value, opts.expect)) continue
      first ??= c
      if (!largest || size(c) > size(largest)) largest = c
      last = c
    }
    const open = scan.open && matches(scan.open.value, opts.expect) ? scan.open : undefined
    const wanted = [first, largest, last, open].filter(
      (c, k, all): c is PartialCandidate => c !== undefined && all.indexOf(c) === k,
    )
    return wanted.length ? choose(wanted, opts.pick) : undefined
  }
}

function select(text: string, opts: ExtractOptions<unknown>): Selected | Failure {
  const { candidates, failure } = locate(text, opts.repair ?? 'full')
  // A value the Reply cuts off after the last Candidate is the real answer, cut short: never
  // fall back to an earlier Candidate (often a format example from the preamble).
  if (failure?.error === 'truncated')
    return { ok: false, error: 'truncated', issues: failure.issues, at: failure.at }
  const wanted = candidates.filter((c) => matches(c.value, opts.expect))
  if (!wanted.length) {
    if (failure?.error === 'unparseable' && !candidates.length)
      return { ok: false, error: 'unparseable', issues: failure.issues, at: failure.at }
    if (failure && !candidates.length)
      return { ok: false, error: failure.error, issues: failure.issues }
    return { ok: false, error: 'not_found', issues: [] }
  }
  const candidate = choose(wanted, opts.pick)
  const detail = wrapperDetail(text, candidate)
  const issues: Issue[] = detail
    ? [{ code: 'stripped_wrapper', detail }, ...candidate.issues]
    : candidate.issues
  return { ok: true, candidate, issues, raw: text.slice(candidate.start, candidate.end) }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
}

function asyncSchemaError(result: PromiseLike<unknown>): LlmmendError {
  // The validation still runs; keep its rejection from surfacing as an unhandled one.
  Promise.resolve(result).catch(() => {})
  return new LlmmendError(
    'async_schema',
    'The schema validates asynchronously: use extractJsonAsync',
  )
}

function finish<T>(
  selected: Selected,
  validated?: StandardSchemaV1.Result<T>,
  coerced?: Coerced,
): ExtractResult<T> {
  const { candidate, raw } = selected
  const issues = coerced ? [...selected.issues, ...coerced.issues] : selected.issues
  if (validated?.issues) {
    return {
      ok: false,
      error: 'schema_mismatch',
      issues,
      schemaIssues: validated.issues,
      value: coerced ? coerced.value : candidate.value,
    }
  }
  const value = validated ? validated.value : (candidate.value as T)
  return {
    ok: true,
    value,
    repaired: issues.some((i) => i.code !== 'stripped_wrapper'),
    issues,
    raw,
  }
}

/**
 * Finds the JSON in a model Reply, repairs it and optionally validates it against a schema.
 * Never throws for bad input; throws `LlmmendError('async_schema')` if the schema is async.
 */
export function extractJson<T = unknown>(
  text: string,
  opts: ExtractOptions<T> = {},
): ExtractResult<T> {
  const selected = select(text, opts)
  if (!selected.ok || !opts.schema) return selected.ok ? finish<T>(selected) : selected
  const validate = syncValidator(opts.schema)
  const { value } = selected.candidate
  const validated = validate(value)
  if (!validated.issues || !opts.coerce) return finish(selected, validated)
  const coerced = coerceSync(value, validated, validate)
  return finish(selected, coerced.result as StandardSchemaV1.Result<T>, coerced)
}

/** The schema's `validate`, throwing `async_schema` if it answers with a promise. */
function syncValidator<T>(
  schema: StandardSchemaV1<unknown, T>,
): (value: unknown) => StandardSchemaV1.Result<T> {
  return (value) => {
    const validated = schema['~standard'].validate(value)
    if (isThenable(validated)) throw asyncSchemaError(validated)
    return validated
  }
}

/** `extractJson` for schemas that validate asynchronously (and any other schema). */
export async function extractJsonAsync<T = unknown>(
  text: string,
  opts: ExtractOptions<T> = {},
): Promise<ExtractResult<T>> {
  const selected = select(text, opts)
  if (!selected.ok || !opts.schema) return selected.ok ? finish<T>(selected) : selected
  const { validate } = opts.schema['~standard']
  const { value } = selected.candidate
  const validated = await validate(value)
  if (!validated.issues || !opts.coerce) return finish(selected, validated)
  const coerced = await coerceAsync(value, validated, validate)
  return finish(selected, coerced.result as StandardSchemaV1.Result<T>, coerced)
}

const CANNOT_EXTRACT = 'Cannot extract JSON'

/** `extractJson` that returns the value or throws `LlmmendJsonError` (its `code` says why). */
export function extractJsonOrThrow<T = unknown>(text: string, opts: ExtractOptions<T> = {}): T {
  const result = extractJson(text, opts)
  if (result.ok) return result.value
  if (result.error === 'schema_mismatch') {
    throw jsonError(
      result.error,
      CANNOT_EXTRACT,
      text,
      result.issues,
      undefined,
      result.schemaIssues,
    )
  }
  throw jsonError(result.error, CANNOT_EXTRACT, text, result.issues, result.at)
}

/**
 * Every Candidate in the Reply, in order. With a schema, only the values that pass it (as the
 * schema outputs them).
 */
export function extractAllJson(
  text: string,
  opts: Omit<ExtractOptions<unknown>, 'pick'> = {},
): unknown[] {
  const values = locate(text, opts.repair ?? 'full')
    .candidates.map((c) => c.value)
    .filter((v) => matches(v, opts.expect))
  const { schema } = opts
  if (!schema) return values
  const validate = syncValidator(schema)
  const out: unknown[] = []
  for (const value of values) {
    let validated = validate(value)
    if (validated.issues && opts.coerce) validated = coerceSync(value, validated, validate).result
    if (!validated.issues) out.push(validated.value)
  }
  return out
}
