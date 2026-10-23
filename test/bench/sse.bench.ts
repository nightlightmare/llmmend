import { createParser } from 'eventsource-parser'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { parseSSE } from 'llmmend/sse'
import { compare } from './compare'

const encoder = new TextEncoder()
const event = (i: number): string =>
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"piece ${i} 🌊"}}\n\n`
const sse = encoder.encode(Array.from({ length: 10_000 }, (_, i) => event(i)).join(''))
const chunks = Array.from({ length: Math.ceil(sse.length / 1024) }, (_, i) =>
  sse.subarray(i * 1024, (i + 1) * 1024),
)

const stream = (): ReadableStream<Uint8Array<ArrayBuffer>> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

const title = `parse ${(sse.length / 1024).toFixed(0)} kB of SSE in 1 kB chunks`

async function ours(): Promise<void> {
  let count = 0
  for await (const _ of parseSSE(stream())) count++
  if (count !== 10_000) throw new Error(`got ${count} events`)
}

// The same shape as parseSSE: a byte stream in, an async iterable of events out.
compare(
  `${title}, as a stream`,
  ['llmmend parseSSE', ours],
  [
    'eventsource-parser/stream',
    async () => {
      let count = 0
      const events = stream()
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
      for await (const _ of events) count++
      if (count !== 10_000) throw new Error(`got ${count} events`)
    },
  ],
)

// For reference only: a callback per event skips the promise an async iterator needs per event,
// which no async-iterable API can match.
compare(
  `${title}, against callbacks`,
  ['llmmend parseSSE', ours],
  [
    'eventsource-parser (callbacks)',
    async () => {
      let count = 0
      const parser = createParser({ onEvent: () => count++ })
      const decoder = new TextDecoder()
      const reader = stream().getReader()
      for (let r = await reader.read(); !r.done; r = await reader.read())
        parser.feed(decoder.decode(r.value, { stream: true }))
      if (count !== 10_000) throw new Error(`got ${count} events`)
    },
  ],
  Number.POSITIVE_INFINITY,
)
