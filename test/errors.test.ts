import { describe, expect, it } from 'vitest'
import { LlmmendError, LlmmendHttpError, LlmmendJsonError } from '../src/index'

describe('LlmmendError', () => {
  it('carries a code and keeps the cause', () => {
    const cause = new Error('inner')
    const err = new LlmmendError('async_schema', 'use extractJsonAsync', { cause })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LlmmendError')
    expect(err.code).toBe('async_schema')
    expect(err.message).toBe('use extractJsonAsync')
    expect(err.cause).toBe(cause)
  })
})

describe('LlmmendJsonError', () => {
  it('is an LlmmendError with its own name and the issues', () => {
    const issues = [{ code: 'trailing_comma', at: 3 }] as const
    const err = new LlmmendJsonError('unparseable', 'no JSON', issues)
    expect(err).toBeInstanceOf(LlmmendError)
    expect(err.name).toBe('LlmmendJsonError')
    expect(err.code).toBe('unparseable')
    expect(err.issues).toEqual(issues)
  })
})

describe('LlmmendHttpError', () => {
  it('is an LlmmendError with status, headers and body', () => {
    const headers = new Headers({ 'retry-after': '5' })
    const err = new LlmmendHttpError(429, headers, '{"error":"rate_limited"}')
    expect(err).toBeInstanceOf(LlmmendError)
    expect(err.name).toBe('LlmmendHttpError')
    expect(err.code).toBe('http_error')
    expect(err.message).toBe('HTTP 429')
    expect(err.status).toBe(429)
    expect(err.headers.get('retry-after')).toBe('5')
    expect(err.body).toBe('{"error":"rate_limited"}')
  })
})

it('gives every error class a unique name', () => {
  const names = [
    new LlmmendError('unknown_provider', ''),
    new LlmmendJsonError('not_found', '', []),
    new LlmmendHttpError(500, new Headers(), ''),
  ].map((e) => e.name)
  expect(new Set(names).size).toBe(names.length)
})
