import { LlmmendError, LlmmendJsonError } from '../shared/errors'
import type { ExtractError, Issue } from './issue'
import { type Candidate, locate } from './locate'
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
  | { ok: false; error: Exclude<ExtractError, 'schema_mismatch'>; issues: Issue[] }

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

function select(text: string, opts: ExtractOptions<unknown>): Selected | Failure {
  const { candidates, failure } = locate(text, opts.repair ?? 'full')
  // A value the Reply cuts off after the last Candidate is the real answer, cut short: never
  // fall back to an earlier Candidate (often a format example from the preamble).
  if (failure?.error === 'truncated')
    return { ok: false, error: 'truncated', issues: failure.issues }
  const wanted = candidates.filter((c) => matches(c.value, opts.expect))
  if (!wanted.length) {
    if (!candidates.length && failure)
      return { ok: false, error: failure.error, issues: failure.issues }
    return { ok: false, error: 'not_found', issues: [] }
  }
  const pick = opts.pick ?? 'last'
  let candidate = pick === 'first' ? wanted[0]! : wanted[wanted.length - 1]!
  if (pick === 'largest') {
    for (const c of wanted) if (c.end - c.start > candidate.end - candidate.start) candidate = c
  }
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

function finish<T>(selected: Selected, validated?: StandardSchemaV1.Result<T>): ExtractResult<T> {
  const { candidate, issues, raw } = selected
  if (validated?.issues) {
    return {
      ok: false,
      error: 'schema_mismatch',
      issues,
      schemaIssues: validated.issues,
      value: candidate.value,
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
  const validated = opts.schema['~standard'].validate(selected.candidate.value)
  if (isThenable(validated)) throw asyncSchemaError(validated)
  return finish(selected, validated)
}

/** `extractJson` for schemas that validate asynchronously (and any other schema). */
export async function extractJsonAsync<T = unknown>(
  text: string,
  opts: ExtractOptions<T> = {},
): Promise<ExtractResult<T>> {
  const selected = select(text, opts)
  if (!selected.ok || !opts.schema) return selected.ok ? finish<T>(selected) : selected
  return finish(selected, await opts.schema['~standard'].validate(selected.candidate.value))
}

/** `extractJson` that returns the value or throws `LlmmendJsonError` (its `code` says why). */
export function extractJsonOrThrow<T = unknown>(text: string, opts: ExtractOptions<T> = {}): T {
  const result = extractJson(text, opts)
  if (result.ok) return result.value
  const schemaIssues = result.error === 'schema_mismatch' ? result.schemaIssues : undefined
  const message = `Cannot extract JSON: ${result.error}`
  throw new LlmmendJsonError(result.error, message, result.issues, schemaIssues)
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
  const out: unknown[] = []
  for (const value of values) {
    const validated = schema['~standard'].validate(value)
    if (isThenable(validated)) throw asyncSchemaError(validated)
    if (!validated.issues) out.push(validated.value)
  }
  return out
}
