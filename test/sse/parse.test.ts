import * as fc from 'fast-check'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { parseSSE, type SSEEvent } from '../../src/sse/index'
import { splitAt } from './split'

const encoder = new TextEncoder()

async function collect(
  source: Parameters<typeof parseSSE>[0],
  options?: Parameters<typeof parseSSE>[1],
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = []
  for await (const event of parseSSE(source, options)) events.push(event)
  return events
}

async function* strings(...chunks: string[]): AsyncGenerator<string> {
  yield* chunks
}

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

const parse = (text: string): Promise<SSEEvent[]> => collect(strings(text))

describe('parseSSE: WHATWG examples', () => {
  it('joins multi-line data', async () => {
    expect(await parse('data: YHOO\ndata: +2\ndata: 10\n\n')).toEqual([
      { event: 'message', data: 'YHOO\n+2\n10' },
    ])
  })

  it('handles comments, ids and the optional space after the colon', async () => {
    const stream =
      ': test stream\n\ndata: first event\nid: 1\n\ndata:second event\nid\n\ndata:  third event\n\n'
    expect(await parse(stream)).toEqual([
      { event: 'message', data: 'first event', id: '1' },
      { event: 'message', data: 'second event' },
      { event: 'message', data: ' third event' },
    ])
  })

  it('dispatches empty data, and drops an event cut off by the end of the stream', async () => {
    expect(await parse('data\n\ndata\ndata\n\ndata:')).toEqual([
      { event: 'message', data: '' },
      { event: 'message', data: '\n' },
    ])
  })

  it('treats "data:test" and "data: test" alike', async () => {
    expect(await parse('data:test\n\ndata: test\n\n')).toEqual([
      { event: 'message', data: 'test' },
      { event: 'message', data: 'test' },
    ])
  })
})

describe('parseSSE: fields', () => {
  it('reads the event type and resets it after each event', async () => {
    expect(await parse('event: add\ndata: 1\n\ndata: 2\n\n')).toEqual([
      { event: 'add', data: '1' },
      { event: 'message', data: '2' },
    ])
  })

  it('resets the event type after a block without data', async () => {
    expect(await parse('event: x\n\ndata: y\n\n')).toEqual([{ event: 'message', data: 'y' }])
  })

  it('treats a field without a colon as an empty value', async () => {
    expect(await parse('data: a\nevent\n\n')).toEqual([{ event: 'message', data: 'a' }])
  })

  it('keeps the last id across events and ignores ids containing NUL', async () => {
    expect(await parse('id: 7\ndata: a\n\ndata: b\n\nid: x\0y\ndata: c\n\n')).toEqual([
      { event: 'message', data: 'a', id: '7' },
      { event: 'message', data: 'b', id: '7' },
      { event: 'message', data: 'c', id: '7' },
    ])
  })

  it('keeps the last valid retry and ignores invalid ones', async () => {
    expect(
      await parse('retry: 1500\ndata: a\n\nretry: 1.5\nretry:\nretry: x\ndata: b\n\n'),
    ).toEqual([
      { event: 'message', data: 'a', retry: 1500 },
      { event: 'message', data: 'b', retry: 1500 },
    ])
  })

  it('ignores unknown fields', async () => {
    expect(await parse('foo: bar\ndata: a\n\n')).toEqual([{ event: 'message', data: 'a' }])
  })

  it('handles CRLF and CR line endings', async () => {
    expect(await parse('data: a\r\n\r\ndata: b\r\rdata: c\n\n')).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
      { event: 'message', data: 'c' },
    ])
  })
})

describe('parseSSE: sources', () => {
  const text = 'event: delta\ndata: {"text":"Привет 🌊"}\n\ndata: [DONE]\n\n'
  const expected = [
    { event: 'delta', data: '{"text":"Привет 🌊"}' },
    { event: 'message', data: '[DONE]' },
  ]

  it('reads a ReadableStream of bytes', async () => {
    expect(await collect(byteStream([encoder.encode(text)]))).toEqual(expected)
  })

  it('reads an async iterable of strings and of bytes', async () => {
    expect(await collect(strings(text))).toEqual(expected)
    async function* asBytes(): AsyncGenerator<Uint8Array> {
      yield encoder.encode(text)
    }
    expect(await collect(asBytes())).toEqual(expected)
  })

  it('yields the same events however the bytes are split', async () => {
    const data = encoder.encode(
      'event: a\ndata: Кириллица\r\ndata: 🌊 emoji 中文\n\n: comment\r\nid: 3\rdata: x\n\n',
    )
    const whole = await collect(byteStream([data]))
    expect(whole).toHaveLength(2)
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { maxLength: 40 }), async (cuts) => {
        expect(await collect(byteStream(splitAt(data, cuts)))).toEqual(whole)
      }),
    )
  })
})

/** A stream that sends one event and then never closes, with a spy on its cancel. */
function hangingStream(): { stream: ReadableStream<Uint8Array>; cancel: Mock<() => void> } {
  const cancel = vi.fn<() => void>()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: first\n\n'))
    },
    cancel,
  })
  return { stream, cancel }
}

async function* failing(): AsyncGenerator<string> {
  yield 'data: a\n\n'
  throw new Error('boom')
}

describe('parseSSE: abort and cleanup', () => {
  it('throws AbortError at once when already aborted', async () => {
    await expect(
      collect(strings('data: a\n\n'), { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('aborts a pending read, cancels the stream and releases the reader', async () => {
    const { stream, cancel } = hangingStream()
    const controller = new AbortController()
    const seen: string[] = []
    const run = (async () => {
      for await (const event of parseSSE(stream, { signal: controller.signal })) {
        seen.push(event.data)
        controller.abort()
      }
    })()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual(['first'])
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
  })

  it('cancels the stream when the consumer stops early', async () => {
    const { stream, cancel } = hangingStream()
    for await (const event of parseSSE(stream)) {
      expect(event.data).toBe('first')
      break
    }
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
  })

  it('aborts a pending async iterable and asks it to return', async () => {
    const returned = vi.fn<() => void>()
    const controller = new AbortController()
    const iterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: () => {
          returned()
          return Promise.resolve({ done: true, value: undefined })
        },
      }),
    }
    const run = collect(iterable, { signal: controller.signal })
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(returned).toHaveBeenCalledOnce()
  })

  it('passes through errors from the source', async () => {
    await expect(collect(failing(), { signal: new AbortController().signal })).rejects.toThrow(
      'boom',
    )
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('broken'))
      },
    })
    await expect(collect(stream)).rejects.toThrow('broken')
  })
})
