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

/** Thrown by `extractJsonOrThrow` and `repairJson` when no usable value was found. */
export class LlmmendJsonError extends LlmmendError {
  override name: string = 'LlmmendJsonError'
  declare readonly code: ExtractError
  readonly issues: readonly Issue[]
  /** What the schema rejected, when `code` is `schema_mismatch`. */
  readonly schemaIssues?: readonly StandardSchemaV1.Issue[]

  constructor(
    code: ExtractError,
    message: string,
    issues: readonly Issue[],
    schemaIssues?: readonly StandardSchemaV1.Issue[],
    options?: ErrorOptions,
  ) {
    super(code, message, options)
    this.issues = issues
    if (schemaIssues) this.schemaIssues = schemaIssues
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
