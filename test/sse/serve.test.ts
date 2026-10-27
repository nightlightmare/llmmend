import * as fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSSEStream,
  type LlmEvent,
  parseSSE,
  type SSEMessage,
  sseResponse,
  streamLlm,
} from '../../src/sse/index'

async function* from<T>(...items: T[]): AsyncIterable<T> {
  yield* items
}

const decoder = new TextDecoder()

/** Everything the stream sends, as text. */
async function wire(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = ''
  for await (const chunk of stream) out += decoder.decode(chunk, { stream: true })
  return out
}

async function parsed(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of parseSSE(stream)) events.push(event)
  return events
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createSSEStream', () => {
  it('writes events and plain values', async () => {
    const stream = createSSEStream(
      from<unknown>(
        { data: 'hi', event: 'greeting', id: '1', retry: 3000 },
        'plain text',
        { type: 'text', index: 0, text: 'x' },
        [1, 2],
      ),
    )
    expect(await wire(stream)).toBe(
      'event: greeting\nid: 1\nretry: 3000\ndata: hi\n\n' +
        'data: plain text\n\n' +
        'data: {"type":"text","index":0,"text":"x"}\n\n' +
        'data: [1,2]\n\n',
    )
  })

  it('splits multi-line data into data lines', async () => {
    expect(await wire(createSSEStream(from({ data: 'a\nb\r\nc\rd' })))).toBe(
      'data: a\ndata: b\ndata: c\ndata: d\n\n',
    )
  })

  it('reads back through parseSSE as it was sent', async () => {
    const message = fc.record(
      {
        data: fc.oneof(fc.string(), fc.jsonValue()),
        event: fc.stringMatching(/^[^\r\n]+$/),
        id: fc.stringMatching(/^[^\r\n\0]+$/),
        retry: fc.nat(),
      },
      { requiredKeys: ['data'] },
    )
    await fc.assert(
      fc.asyncProperty(fc.array(message, { maxLength: 10 }), async (messages) => {
        const events = await parsed(createSSEStream(from<SSEMessage>(...messages)))
        expect(events.map((e) => e.data)).toEqual(
          messages.map((m) =>
            typeof m.data === 'string'
              ? m.data.replace(/\r\n|\r/g, '\n')
              : (JSON.stringify(m.data) ?? ''),
          ),
        )
        expect(events.map((e) => e.event)).toEqual(messages.map((m) => m.event ?? 'message'))
      }),
    )
  })

  it('refuses an event name or id that would break the event apart', async () => {
    await expect(wire(createSSEStream(from({ data: 1, event: 'a\nb' })))).rejects.toThrow(TypeError)
    await expect(wire(createSSEStream(from({ data: 1, id: 'a\rb' })))).rejects.toThrow(TypeError)
    await expect(wire(createSSEStream(from({ data: 1, retry: 1.5 })))).rejects.toThrow(TypeError)
  })

  it('errors the stream when the source throws', async () => {
    async function* failing(): AsyncIterable<unknown> {
      yield 'first'
      throw new Error('upstream failed')
    }
    await expect(wire(createSSEStream(failing()))).rejects.toThrow('upstream failed')
  })

  it('sends a comment after keepAlive milliseconds of quiet, and only then', async () => {
    vi.useFakeTimers()
    let release: (value: string) => void = () => {}
    const later = new Promise<string>((resolve) => (release = resolve))
    async function* slow(): AsyncIterable<string> {
      yield 'first'
      yield await later
      // Then nothing more, for as long as the client stays.
      await new Promise(() => {})
    }
    const reader = createSSEStream(slow(), { keepAlive: 1000 }).getReader()
    const read = async () => decoder.decode((await reader.read()).value)

    expect(await read()).toBe('data: first\n\n')
    const pending = read()
    await vi.advanceTimersByTimeAsync(999)
    release('second')
    // The event came before the wait ran out: no comment.
    expect(await pending).toBe('data: second\n\n')
    const quiet = read()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await quiet).toBe(':\n\n')
    await reader.cancel()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('calls return() on the source when the client goes away', async () => {
    const returned = vi.fn<(reason?: unknown) => Promise<IteratorReturnResult<undefined>>>(
      async () => ({ done: true, value: undefined }),
    )
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 'tick' }),
        return: returned,
      }),
    }
    const reader = createSSEStream(source).getReader()
    await reader.read()
    await reader.cancel('gone')
    expect(returned).toHaveBeenCalledWith('gone')
  })

  it('stops the upstream request of streamLlm once its next chunk arrives', async () => {
    const encoder = new TextEncoder()
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const cancelled = vi.fn<() => void>()
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => void (upstream = controller),
      cancel: cancelled,
    })
    const delta = (text: string) =>
      encoder.encode(
        `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
      )
    const reader = createSSEStream(streamLlm(body, { provider: 'anthropic' })).getReader()
    upstream.enqueue(delta('Hi'))
    const first = JSON.parse(decoder.decode((await reader.read()).value).slice(6)) as LlmEvent
    expect(first).toEqual({ type: 'text', index: 0, text: 'Hi' })

    await reader.cancel()
    // streamLlm waits on upstream; the next chunk lets it see the return() and cancel the body.
    upstream.enqueue(delta('there'))
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
  })
})

describe('sseResponse', () => {
  it('serves the stream with the SSE headers', async () => {
    const response = sseResponse(from({ data: 'hi' }))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(await parsed(response.body!)).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('keeps the status and headers it is given', () => {
    const response = sseResponse(from(), {
      status: 201,
      headers: { 'cache-control': 'no-store', 'x-request-id': 'r1' },
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBe('r1')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
  })

  it('proxies streamLlm to a client that reads it with parseSSE', async () => {
    const reply = [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'message_stop' },
    ]
    const upstream = new Response(reply.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))
    const response = sseResponse(streamLlm(upstream, { provider: 'anthropic' }))
    const events = (await parsed(response.body!)).map((e) => JSON.parse(e.data) as LlmEvent)
    expect(events).toEqual([
      { type: 'text', index: 0, text: 'Hi' },
      { type: 'done', stopReason: 'unknown' },
    ])
  })
})
