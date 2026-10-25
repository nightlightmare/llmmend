import { describe, expect, it, vi } from 'vitest'
import {
  collectText,
  LlmmendError,
  LlmmendHttpError,
  type LlmEvent,
  type ProviderAdapter,
  streamLlm,
  streamText,
} from '../../src/sse/index'
import { byteStream, collectEvents, sseFixtures } from './fixtures'

const encoder = new TextEncoder()
const sse = (...lines: string[]): ReadableStream<Uint8Array> =>
  byteStream([encoder.encode(lines.join('\n') + '\n')])
const text = sseFixtures('anthropic').find((f) => f.name === 'text')?.bytes as Uint8Array

/** An adapter that turns every event's data into the LLM events it encodes as JSON. */
const echo: ProviderAdapter = {
  name: 'echo',
  create: () => (event) => JSON.parse(event.data) as LlmEvent[],
}
const data = (...events: unknown[]): string => `data: ${JSON.stringify(events)}\n`

describe('streamLlm', () => {
  it('reads a Response body', async () => {
    const events = await collectEvents(new Response(byteStream([text])), { provider: 'anthropic' })
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end' })
  })

  it('throws LlmmendHttpError with the body before streaming on a non-2xx Response', async () => {
    const response = new Response('{"error":"rate limited"}', {
      status: 429,
      headers: { 'retry-after': '7' },
    })
    const error = await collectEvents(response, { provider: 'anthropic' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmmendHttpError)
    expect(error).toMatchObject({
      name: 'LlmmendHttpError',
      code: 'http_error',
      status: 429,
      body: '{"error":"rate limited"}',
    })
    expect((error as LlmmendHttpError).headers.get('retry-after')).toBe('7')
  })

  it('reports an empty body when the error body cannot be read', async () => {
    const response = new Response(null, { status: 500 })
    vi.spyOn(response, 'text').mockRejectedValue(new Error('gone'))
    await expect(collectEvents(response, { provider: 'anthropic' })).rejects.toMatchObject({
      status: 500,
      body: '',
    })
  })

  it('ends a Response without a body with an unknown stop reason', async () => {
    expect(await collectEvents(new Response(null), { provider: 'anthropic' })).toEqual([
      { type: 'done', stopReason: 'unknown' },
    ])
  })

  it('ends a stream cut off before the final event with an unknown stop reason', async () => {
    const cut = text.subarray(0, text.length / 2)
    const events = await collectEvents(byteStream([cut]), { provider: 'anthropic' })
    expect(events.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', stopReason: 'unknown' },
    ])
    expect(events.at(-1)?.type).toBe('done')
  })

  it('rejects an unknown Provider', async () => {
    const error = await collectEvents(sse(), { provider: 'nope' as 'anthropic' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(LlmmendError)
    expect(error).toMatchObject({ code: 'unknown_provider', message: 'Unknown provider: nope' })
  })

  it('stops after done and ignores the rest of the stream', async () => {
    const events = await collectEvents(
      sse(
        data(
          { type: 'text', index: 0, text: 'a' },
          { type: 'done', stopReason: 'end' },
          { type: 'text', index: 0, text: 'b' },
        ),
        '',
        data({ type: 'text', index: 0, text: 'c' }),
        '',
      ),
      { provider: echo },
    )
    expect(events).toEqual([
      { type: 'text', index: 0, text: 'a' },
      { type: 'done', stopReason: 'end' },
    ])
  })

  it('follows an error with done and stops', async () => {
    const events = await collectEvents(
      sse(
        data({ type: 'error', message: 'boom', raw: null }, { type: 'done', stopReason: 'end' }),
        '',
      ),
      { provider: echo },
    )
    expect(events).toEqual([
      { type: 'error', message: 'boom', raw: null },
      { type: 'done', stopReason: 'error' },
    ])
  })

  it('creates a fresh adapter state per stream', async () => {
    const create = vi.fn<ProviderAdapter['create']>(() => () => [])
    const adapter: ProviderAdapter = { name: 'spy', create }
    await collectEvents(sse(), { provider: adapter })
    await collectEvents(sse(), { provider: adapter })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('throws AbortError at once when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      collectEvents(sse(), { provider: 'anthropic', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('throws AbortError mid-stream and releases the reader', async () => {
    const cancel = vi.fn<(reason: unknown) => void>()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(data({ type: 'text', index: 0, text: 'a' }) + '\n'))
      },
      cancel,
    })
    const controller = new AbortController()
    const seen: LlmEvent[] = []
    const run = (async () => {
      for await (const event of streamLlm(source, { provider: echo, signal: controller.signal })) {
        seen.push(event)
        controller.abort()
      }
    })()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual([{ type: 'text', index: 0, text: 'a' }])
    expect(cancel).toHaveBeenCalledOnce()
    expect(source.locked).toBe(false)
  })

  it('cancels the source when the consumer stops early', async () => {
    const cancel = vi.fn<(reason: unknown) => void>()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(data({ type: 'text', index: 0, text: 'a' }) + '\n'))
      },
      cancel,
    })
    for await (const event of streamLlm(source, { provider: echo })) {
      expect(event.type).toBe('text')
      break
    }
    expect(cancel).toHaveBeenCalledOnce()
    expect(source.locked).toBe(false)
  })
})

describe('streamText and collectText', () => {
  const sentence =
    'The sea stretches endlessly, its waves whispering secrets to the shore 🌊. Sailors have long called it by many names, but my favorite is the Russian word «море».'

  it('streamText yields only the text', async () => {
    const pieces: string[] = []
    for await (const piece of streamText(byteStream([text]), { provider: 'anthropic' }))
      pieces.push(piece)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(sentence)
  })

  it('collectText returns the text, Stop reason and last usage', async () => {
    expect(await collectText(byteStream([text]), { provider: 'anthropic' })).toEqual({
      text: sentence,
      stopReason: 'end',
      usage: {
        inputTokens: 36,
        outputTokens: 57,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      toolCalls: [],
    })
  })

  it('collectText leaves usage out when the Provider sent none', async () => {
    expect(await collectText(new Response(null), { provider: 'anthropic' })).toEqual({
      text: '',
      stopReason: 'unknown',
      toolCalls: [],
    })
  })
})
