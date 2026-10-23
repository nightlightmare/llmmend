import { LlmmendError, LlmmendHttpError } from '../shared/errors'
import type { LlmEvent, LlmUsage, Provider, ProviderAdapter, StopReason } from './events'
import { parseSSE } from './parse'
import { anthropic } from './providers/anthropic'
import { openai } from './providers/openai'

/** A `fetch` response, or its body. */
export type StreamSource = Response | ReadableStream<Uint8Array>

export interface StreamLlmOptions {
  /** Which Provider produced the stream: a built-in name or a custom adapter. */
  provider: Provider
  /** Aborting cancels the source and makes iteration throw the signal's reason (an `AbortError`). */
  signal?: AbortSignal
}

/** What `collectText` returns. */
export interface CollectedText {
  text: string
  stopReason: StopReason
  /** The last usage snapshot, if the Provider sent one. */
  usage?: LlmUsage
}

const PROVIDERS = new Map<string, ProviderAdapter>([
  ['anthropic', anthropic],
  ['openai', openai],
])

/**
 * Turns a Provider's server-sent event stream into LLM events. A non-2xx `Response` throws
 * `LlmmendHttpError` before streaming. `done` arrives exactly once and always last: after a
 * Provider error it follows the `error` event with `stopReason: 'error'`, and a stream that ends
 * without a final event gets `stopReason: 'unknown'`.
 */
export async function* streamLlm(
  source: StreamSource,
  options: StreamLlmOptions,
): AsyncIterable<LlmEvent> {
  const { provider, signal } = options
  signal?.throwIfAborted()
  const adapter = typeof provider === 'string' ? PROVIDERS.get(provider) : provider
  if (!adapter) throw new LlmmendError('unknown_provider', `Unknown provider: ${String(provider)}`)
  let body: ReadableStream<Uint8Array> | null = null
  if ('getReader' in source) body = source
  else if (source.ok) body = source.body
  else {
    const text = await source.text().catch(() => '')
    throw new LlmmendHttpError(source.status, source.headers, text)
  }
  const map = adapter.create()
  if (body) {
    for await (const sse of parseSSE(body, signal ? { signal } : {})) {
      for (const event of map(sse)) {
        yield event
        if (event.type === 'done') return
        if (event.type === 'error') {
          yield { type: 'done', stopReason: 'error' }
          return
        }
      }
    }
  }
  yield { type: 'done', stopReason: 'unknown' }
}

/** Yields only the answer's text. Use `streamLlm` or `collectText` to learn why it stopped. */
export async function* streamText(
  source: StreamSource,
  options: StreamLlmOptions,
): AsyncIterable<string> {
  for await (const event of streamLlm(source, options)) {
    if (event.type === 'text') yield event.text
  }
}

/** Reads the whole stream and returns the answer's text, Stop reason and last usage. */
export async function collectText(
  source: StreamSource,
  options: StreamLlmOptions,
): Promise<CollectedText> {
  const result: CollectedText = { text: '', stopReason: 'unknown' }
  for await (const event of streamLlm(source, options)) {
    if (event.type === 'text') result.text += event.text
    else if (event.type === 'done') result.stopReason = event.stopReason
    else if (event.type === 'usage') {
      const { type: _, ...usage } = event
      result.usage = usage
    }
  }
  return result
}
