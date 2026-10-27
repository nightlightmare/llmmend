import { classifyError } from 'llmmend/retry'
import { LlmmendHttpError } from '../../src/shared/errors'
import anthropicContext from '../../test/fixtures/errors/anthropic/context-length.json?raw'
import anthropicOverloaded from '../../test/fixtures/errors/anthropic/overloaded.json?raw'
import geminiAuth from '../../test/fixtures/errors/gemini/auth.json?raw'
import geminiRateLimit from '../../test/fixtures/errors/gemini/rate-limit.json?raw'
import openaiQuota from '../../test/fixtures/errors/openai/quota.json?raw'
import { block, h, json, type Tool } from './dom'

// The fixtures keep the body as the raw text; here it reads better as JSON.
function sample(text: string): string {
  const { status, headers, body } = JSON.parse(text) as {
    status: number
    headers: object
    body: string
  }
  return JSON.stringify({ status, headers, body: JSON.parse(body) as unknown }, null, 2)
}

const streamError = JSON.stringify(
  { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  null,
  2,
)

export const tool: Tool = {
  samples: {
    'gemini-rate-limit': sample(geminiRateLimit),
    'openai-quota': sample(openaiQuota),
    'anthropic-context': sample(anthropicContext),
    'gemini-auth': sample(geminiAuth),
    'anthropic-overloaded': sample(anthropicOverloaded),
    'stream-error': streamError,
  },
  render(input, _options, t) {
    let value: unknown
    try {
      value = JSON.parse(input)
    } catch {
      return h('p', { class: 'status failed' }, t.retry.invalid)
    }
    // `{ status, headers?, body }` is an HTTP response; anything else, a stream error event's payload.
    const response = value as { status?: unknown; headers?: unknown; body?: unknown }
    const http = typeof response.status === 'number' && 'body' in response
    const error = http
      ? new LlmmendHttpError(
          response.status as number,
          new Headers(response.headers as Record<string, string> | undefined),
          typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
        )
      : { type: 'error', message: '', raw: value }
    const c = classifyError(error)
    return h(
      'div',
      {},
      h(
        'p',
        { class: c.retryable ? 'status ok' : 'status failed' },
        `${c.kind}: ${c.retryable ? t.retry.retry : t.retry.dontRetry}`,
        c.retryAfter !== undefined && ` ${t.retry.after} ${c.retryAfter / 1000} s`,
      ),
      block(t.retry.result, json(c)),
      h('p', { class: 'note' }, http ? t.retry.httpNote : t.retry.streamNote),
    )
  },
}
