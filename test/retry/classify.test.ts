import { describe, expect, it } from 'vitest'
import { classifyError, type ErrorKind } from '../../src/retry/index'
import { LlmmendHttpError } from '../../src/shared/errors'
import { streamLlm } from '../../src/sse/index'
import { fixtureDir } from '../fixtures'

// Every error fixture and the kind it must get; a new fixture fails until it is listed here.
const expected: Record<string, ErrorKind> = {
  'anthropic/auth': 'auth',
  'anthropic/billing': 'quota',
  'anthropic/context-length': 'context_length',
  'anthropic/overloaded': 'overloaded',
  'anthropic/rate-limit': 'rate_limit',
  'anthropic/request-too-large': 'context_length',
  'anthropic/server': 'server',
  'anthropic/unknown-model': 'invalid_request',
  'gemini/auth': 'auth',
  'gemini/context-length': 'context_length',
  'gemini/overloaded': 'overloaded',
  'gemini/quota': 'quota',
  'gemini/rate-limit': 'rate_limit',
  'gemini/server': 'server',
  'gemini/timeout': 'timeout',
  'gemini/unknown-model': 'invalid_request',
  'openai/auth': 'auth',
  'openai/context-length': 'context_length',
  'openai/quota': 'quota',
  'openai/rate-limit': 'rate_limit',
  'openai/server': 'server',
}

interface Recorded {
  status: number
  headers: Record<string, string>
  body: string
}

// Through Vite, not node:fs, so the suite also runs in WebKit.
const responses = new Map<string, Recorded>()
for (const provider of ['anthropic', 'gemini', 'openai'])
  for (const [name, text] of fixtureDir(`errors/${provider}`))
    if (!name.endsWith('.meta.json'))
      responses.set(`${provider}/${name.slice(0, -'.json'.length)}`, JSON.parse(text) as Recorded)
// A local array (toSorted is newer than the ES2022 target).
// oxlint-disable-next-line unicorn/no-array-sort
const fixtures = [...responses.keys()].sort()
const load = (id: string) => responses.get(id)!

const http = (id: string) => {
  const { status, headers, body } = load(id)
  return classifyError(new LlmmendHttpError(status, new Headers(headers), body))
}

async function firstError(dir: string, name: string, provider: 'anthropic' | 'openai' | 'gemini') {
  const body = new Blob([fixtureDir(`sse/${dir}`).get(`${name}.sse`)!]).stream()
  for await (const event of streamLlm(body, { provider })) if (event.type === 'error') return event
  throw new Error('no error event')
}

describe('classifyError on recorded and documented error responses', () => {
  it('has an expected kind for every fixture', () => {
    // oxlint-disable-next-line unicorn/no-array-sort
    expect(fixtures).toEqual(Object.keys(expected).sort())
  })

  it.each(fixtures)('%s', (id) => {
    const { status, headers, body } = load(id)
    const c = classifyError(new LlmmendHttpError(status, new Headers(headers), body))
    expect(c.kind).toBe(expected[id])
    expect(c.status).toBe(status)
    expect(c.retryable).toBe(
      ['rate_limit', 'overloaded', 'server', 'timeout', 'network'].includes(c.kind),
    )
    // The Provider's message, never the bare "HTTP 429".
    expect(c.message).not.toMatch(/^HTTP \d+$/)
  })
})

describe('retryAfter', () => {
  it('prefers retry-after-ms, then retry-after in seconds', () => {
    expect(http('openai/rate-limit').retryAfter).toBe(1500)
    expect(http('anthropic/rate-limit').retryAfter).toBe(20_000)
  })

  it('reads Gemini’s RetryInfo from the body', () => {
    expect(http('gemini/rate-limit').retryAfter).toBe(8000)
  })

  it('reads retry-after as an HTTP date', () => {
    const at = new Date(Date.now() + 30_000).toUTCString()
    const c = classifyError(new LlmmendHttpError(503, new Headers({ 'retry-after': at }), ''))
    expect(c.retryAfter).toBeGreaterThan(25_000)
    expect(c.retryAfter).toBeLessThanOrEqual(30_000)
  })

  it('is absent without a hint, and for kinds not worth retrying', () => {
    expect(http('anthropic/overloaded')).not.toHaveProperty('retryAfter')
    const quota = new LlmmendHttpError(
      429,
      new Headers({ 'retry-after': '60' }),
      load('openai/quota').body,
    )
    expect(classifyError(quota)).toEqual(
      expect.objectContaining({ kind: 'quota', retryable: false }),
    )
    expect(classifyError(quota)).not.toHaveProperty('retryAfter')
  })
})

describe('classifyError on stream error events', () => {
  it.each([
    ['anthropic', 'overloaded-mid-stream', 'overloaded', 'Overloaded'],
    [
      'gemini',
      'error-mid-stream',
      'overloaded',
      'The model is overloaded. Please try again later.',
    ],
    [
      'openai',
      'error-mid-stream',
      'server',
      'The server had an error while processing your request. Sorry about that!',
    ],
  ] as const)('%s/%s', async (provider, name, kind, message) => {
    const c = classifyError(await firstError(provider, name, provider))
    expect(c).toEqual({ kind, retryable: true, message })
  })

  it('reads an OpenAI Responses response.failed event', () => {
    const raw = {
      type: 'response.failed',
      response: { error: { code: 'rate_limit_exceeded', message: 'Slow down' } },
    }
    expect(classifyError({ type: 'error', message: 'Slow down', raw })).toEqual({
      kind: 'rate_limit',
      retryable: true,
      message: 'Slow down',
    })
    const context = { type: 'error', code: 'context_length_exceeded', message: 'Too long' }
    expect(classifyError({ type: 'error', message: 'Too long', raw: context }).kind).toBe(
      'context_length',
    )
  })
})

describe('classifyError on SDK errors, by shape', () => {
  it('reads the Anthropic SDK’s APIError: status, headers, parsed body in `error`', () => {
    const error = Object.assign(new Error('529 {"type":"error",…}'), {
      name: 'InternalServerError',
      status: 529,
      headers: new Headers(),
      error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    })
    expect(classifyError(error)).toEqual({
      kind: 'overloaded',
      retryable: true,
      status: 529,
      message: 'Overloaded',
    })
  })

  it('reads the OpenAI SDK’s APIError: the inner error object, headers as a record', () => {
    const error = Object.assign(new Error('429 You exceeded your current quota'), {
      name: 'RateLimitError',
      status: 429,
      headers: { 'Retry-After': '5' },
      error: {
        message: 'You exceeded your current quota',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    })
    expect(classifyError(error)).toMatchObject({ kind: 'quota', retryable: false, status: 429 })
  })

  it('reads the Google Gen AI SDK’s ApiError: the body as JSON in `message`', () => {
    const { body } = load('gemini/rate-limit')
    const error = Object.assign(new Error(body), { name: 'ApiError', status: 429 })
    expect(classifyError(error)).toMatchObject({
      kind: 'rate_limit',
      retryAfter: 8000,
      status: 429,
    })
  })

  it('reads connection errors by name', () => {
    expect(
      classifyError(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }))
        .kind,
    ).toBe('network')
    expect(
      classifyError(
        Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }),
      ).kind,
    ).toBe('timeout')
  })
})

describe('classifyError on fetch errors and anything else', () => {
  it('reads fetch and signal errors', () => {
    expect(classifyError(new TypeError('fetch failed'))).toEqual({
      kind: 'network',
      retryable: true,
      message: 'fetch failed',
    })
    expect(classifyError(new DOMException('The operation was aborted.', 'AbortError')).kind).toBe(
      'aborted',
    )
    expect(classifyError(new DOMException('The operation timed out.', 'TimeoutError')).kind).toBe(
      'timeout',
    )
  })

  it('never throws', () => {
    for (const value of [undefined, null, 42, 'boom', {}, [], new Error('x'), { status: 'x' }])
      expect(classifyError(value)).toMatchObject({ kind: 'unknown', retryable: false })
    expect(classifyError('boom').message).toBe('boom')
    expect(classifyError(new LlmmendHttpError(418, new Headers(), 'not json')).kind).toBe(
      'invalid_request',
    )
  })
})
