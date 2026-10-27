import type { ExtractError, Issue } from '../json/issue'
import type { StandardSchemaV1 } from '../json/schema'

/** Every code an `LlmmendError` can carry. Closed union: adding a code is a minor release (ADR 0002). */
export type LlmmendErrorCode = ExtractError | 'http_error' | 'async_schema' | 'unknown_provider'

/**
 * Base class of every error llmmend throws. Each class has a unique `name`, so errors can be
 * recognised without `instanceof` when two copies of the package are loaded (e.g. CJS and ESM).
 */
export class LlmmendError extends Error {
  override name: string = 'LlmmendError'
  readonly code: LlmmendErrorCode

  constructor(code: LlmmendErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** Where in the text a JSON error happened: `at` is the position, `line` and `column` count from 1. */
export interface JsonErrorPosition {
  at: number
  line: number
  column: number
}

/** Thrown by `extractJsonOrThrow` and `repairJson` when no usable value was found. */
export class LlmmendJsonError extends LlmmendError {
  override name: string = 'LlmmendJsonError'
  declare readonly code: ExtractError
  readonly issues: readonly Issue[]
  /** What the schema rejected, when `code` is `schema_mismatch`. */
  readonly schemaIssues?: readonly StandardSchemaV1.Issue[]
  // `declare`: no own property at all when there is no position.
  /** Where parsing failed: for `unparseable` and `truncated`, and for `max_depth` from `repairJson`. */
  declare readonly at?: number
  declare readonly line?: number
  declare readonly column?: number

  constructor(
    code: ExtractError,
    message: string,
    issues: readonly Issue[],
    schemaIssues?: readonly StandardSchemaV1.Issue[],
    options?: ErrorOptions & Partial<JsonErrorPosition>,
  ) {
    super(code, message, options)
    this.issues = issues
    if (schemaIssues) this.schemaIssues = schemaIssues
    if (options?.at !== undefined) {
      this.at = options.at
      this.line = options.line!
      this.column = options.column!
    } else {
      // JavaScriptCore gives every Error its own `line` and `column`: where it was thrown.
      Reflect.deleteProperty(this, 'line')
      Reflect.deleteProperty(this, 'column')
    }
  }
}

/** Thrown by `streamLlm` and its wrappers when the response status is not 2xx, before streaming. */
export class LlmmendHttpError extends LlmmendError {
  override name: string = 'LlmmendHttpError'
  declare readonly code: 'http_error'
  readonly status: number
  readonly headers: Headers
  readonly body: string

  constructor(status: number, headers: Headers, body: string, options?: ErrorOptions) {
    super('http_error', `HTTP ${status}`, options)
    this.status = status
    this.headers = headers
    this.body = body
  }
}
