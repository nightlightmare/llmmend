// Which kind of failure a model call hit, and whether to retry it. Generic retry libraries see a
// status code; this reads the Provider's error body too: a 429 that means "out of credit", a 400
// that means "prompt too long", Gemini's retry delay inside the body.

/**
 * A failed call's kind, provider-neutral. Closed union: adding a kind is a minor release
 * (ADR 0002).
 */
export type ErrorKind =
  | 'rate_limit'
  | 'quota'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'network'
  | 'context_length'
  | 'auth'
  | 'invalid_request'
  | 'aborted'
  | 'unknown'

export interface ErrorClass {
  kind: ErrorKind
  /** Whether the same request may succeed later: rate limits, overload, server errors, timeouts, network. */
  retryable: boolean
  /** Milliseconds to wait, when the Provider said so (retryable kinds only). */
  retryAfter?: number
  /** The HTTP status, when there was a response. */
  status?: number
  /** The Provider's own message, else the error's. */
  message: string
}

const RETRYABLE = new Set<ErrorKind>(['rate_limit', 'overloaded', 'server', 'timeout', 'network'])

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null
const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** The fields of an error body every Provider format reduces to. */
interface Body {
  /** Anthropic's `error.type`, OpenAI's `error.type`. */
  type?: string
  /** OpenAI's `error.code`, a Responses `code`. */
  code?: string
  /** Gemini's `error.status` (`RESOURCE_EXHAUSTED`) and numeric `error.code`. */
  gStatus?: string
  gCode?: number
  details?: unknown[]
  message?: string
}

function readBody(raw: unknown): Body {
  let value = parse(raw)
  // Gemini sometimes wraps its error in an array.
  if (Array.isArray(value)) value = value[0]
  if (!isObj(value)) return {}
  // Anthropic `{ type: 'error', error }`, OpenAI and Gemini `{ error }`, Responses
  // `{ response: { error } }`; the OpenAI SDK and Responses `error` events give the inner object.
  const inner = isObj(value.error)
    ? value.error
    : isObj(value.response) && isObj(value.response.error)
      ? value.response.error
      : value
  const body: Body = {}
  const type = str(inner.type)
  if (type && type !== 'error') body.type = type
  if (typeof inner.code === 'number') body.gCode = inner.code
  else if (str(inner.code)) body.code = str(inner.code)!
  if (str(inner.status)) body.gStatus = str(inner.status)!
  if (Array.isArray(inner.details)) body.details = inner.details
  if (str(inner.message)) body.message = str(inner.message)!
  return body
}

/** Gemini's `details` entries of one `@type` (the part after the last dot). */
const details = (body: Body, type: string): Obj[] =>
  (body.details ?? []).filter(
    (d): d is Obj => isObj(d) && str(d['@type'])?.endsWith(`.${type}`) === true,
  )

function header(headers: unknown, name: string): string | undefined {
  if (!isObj(headers)) return undefined
  if (typeof headers.get === 'function')
    return (headers as unknown as Headers).get(name) ?? undefined
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === name) return Array.isArray(value) ? str(value[0]) : str(value)
  return undefined
}

function retryAfter(headers: unknown, body: Body): number | undefined {
  const ms = Number(header(headers, 'retry-after-ms'))
  if (header(headers, 'retry-after-ms') && Number.isFinite(ms) && ms >= 0) return ms
  const after = header(headers, 'retry-after')
  if (after) {
    const seconds = Number(after)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const date = Date.parse(after)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }
  // Gemini: `{ "@type": "…RetryInfo", "retryDelay": "8s" }`.
  const delay = str(details(body, 'RetryInfo')[0]?.retryDelay)
  const seconds = delay && /^(\d+(?:\.\d+)?)s$/.exec(delay)?.[1]
  return seconds ? Number(seconds) * 1000 : undefined
}

const CONTEXT =
  /prompt is too long|maximum context length|exceeds the maximum number of tokens|context[ _]length|context window/i

function kindOf(status: number | undefined, body: Body): ErrorKind | undefined {
  const { type, code, gStatus, message = '' } = body
  const s = status ?? body.gCode
  const reason = (name: string) => details(body, 'ErrorInfo').some((d) => d.reason === name)
  if (code === 'context_length_exceeded' || type === 'request_too_large' || s === 413)
    return 'context_length'
  if (CONTEXT.test(message) && (s === undefined || s === 400)) return 'context_length'
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return 'quota'
  if (type === 'billing_error' || s === 402) return 'quota'
  // Gemini says "exceeded your current quota" for per-minute limits too: the quota id tells.
  const perDay = details(body, 'QuotaFailure').some(
    (d) =>
      Array.isArray(d.violations) &&
      d.violations.some((v) => /PerDay/i.test(str(isObj(v) ? v.quotaId : undefined) ?? '')),
  )
  if (gStatus === 'RESOURCE_EXHAUSTED' && perDay) return 'quota'
  // Stream errors have no status: OpenAI's codes and Anthropic's types stand in for it.
  if (s === 429 || type === 'rate_limit_error' || code === 'rate_limit_exceeded')
    return 'rate_limit'
  if (gStatus === 'RESOURCE_EXHAUSTED') return 'rate_limit'
  if (s === 529 || s === 503 || type === 'overloaded_error' || gStatus === 'UNAVAILABLE')
    return 'overloaded'
  if (s === 408 || s === 504 || gStatus === 'DEADLINE_EXCEEDED') return 'timeout'
  if (
    s === 401 ||
    s === 403 ||
    type === 'authentication_error' ||
    type === 'permission_error' ||
    code === 'invalid_api_key' ||
    gStatus === 'UNAUTHENTICATED' ||
    gStatus === 'PERMISSION_DENIED' ||
    reason('API_KEY_INVALID')
  )
    return 'auth'
  if ((s !== undefined && s >= 500) || type === 'api_error' || type === 'server_error')
    return 'server'
  if (code === 'server_error') return 'server'
  if (gStatus === 'INTERNAL') return 'server'
  if (
    (s !== undefined && s >= 400 && s < 500) ||
    type === 'invalid_request_error' ||
    type === 'not_found_error' ||
    gStatus === 'INVALID_ARGUMENT' ||
    gStatus === 'NOT_FOUND' ||
    gStatus === 'FAILED_PRECONDITION'
  )
    return 'invalid_request'
  return undefined
}

function result(kind: ErrorKind, message: string, status?: number, after?: number): ErrorClass {
  const out: ErrorClass = { kind, retryable: RETRYABLE.has(kind), message }
  if (out.retryable && after !== undefined) out.retryAfter = after
  if (status !== undefined) out.status = status
  return out
}

/**
 * Classifies a failed model call: an `LlmmendHttpError`, a stream `error` event, a `fetch` error,
 * or an official SDK's API error (Anthropic, OpenAI, Google Gen AI), recognised by its shape.
 * Never throws: anything else is `unknown`.
 */
export function classifyError(error: unknown): ErrorClass {
  if (!isObj(error)) return result('unknown', String(error))
  const name = str(error.name) ?? ''
  const own = str(error.message) ?? String(error)
  if (name === 'AbortError') return result('aborted', own)
  if (name === 'TimeoutError' || /Timeout/.test(name)) return result('timeout', own)

  // A stream `error` event: the Provider's payload is in `raw`, there is no HTTP status.
  if (error.type === 'error' && 'raw' in error) {
    const body = readBody(error.raw)
    const message = body.message ?? own
    return result(
      kindOf(undefined, body) ?? 'unknown',
      message,
      undefined,
      retryAfter(undefined, body),
    )
  }

  const status = typeof error.status === 'number' ? error.status : undefined
  if (status === undefined) {
    // `fetch` rejects with a TypeError when the connection fails; the SDKs wrap it in
    // APIConnectionError.
    if (name === 'TypeError' || /Connection/.test(name)) return result('network', own)
    return result('unknown', own)
  }
  // LlmmendHttpError has the text in `body`; the SDKs have the parsed body in `error` (Anthropic,
  // OpenAI) or a JSON message (Google Gen AI).
  let body = readBody(error.body ?? error.error)
  if (!body.message && !body.type && !body.gStatus) body = { ...readBody(own), ...body }
  return result(
    kindOf(status, body) ?? 'unknown',
    body.message ?? own,
    status,
    retryAfter(error.headers, body),
  )
}
