import { createLineDecoder } from './decoder'

/** One dispatched server-sent event. */
export interface SSEEvent {
  /** The `event` field, or `message` when the event has none. */
  event: string
  /** The `data` lines joined with `\n`. */
  data: string
  /** The last event ID seen on the stream, if any; it persists across events. */
  id?: string
  /** The last valid `retry` value seen on the stream, in milliseconds; it persists across events. */
  retry?: number
}

export interface ParseSSEOptions {
  /** Aborting cancels the source and makes iteration throw the signal's reason (an `AbortError`). */
  signal?: AbortSignal
}

const COLON = 0x3a
const SPACE = 0x20

/** Builds events from lines, following the WHATWG "interpret an event stream" rules. */
function createEventBuilder(): (line: string) => SSEEvent | undefined {
  // The data lines so far, joined with `\n`; `undefined` until the event has a data line.
  let data: string | undefined
  let type = ''
  let lastId = ''
  let retry: number | undefined

  return (line) => {
    if (line === '') {
      // A block without data dispatches nothing but still resets the event type.
      const event: SSEEvent | undefined =
        data === undefined ? undefined : { event: type || 'message', data }
      data = undefined
      type = ''
      if (!event) return undefined
      if (lastId !== '') event.id = lastId
      if (retry !== undefined) event.retry = retry
      return event
    }
    if (line.charCodeAt(0) === COLON) return undefined
    const colon = line.indexOf(':')
    // Fields are matched by length and prefix, so no field name string is sliced out.
    const length = colon === -1 ? line.length : colon
    const value =
      colon === -1 ? '' : line.slice(colon + (line.charCodeAt(colon + 1) === SPACE ? 2 : 1))
    if (length === 4 && line.startsWith('data'))
      data = data === undefined ? value : `${data}\n${value}`
    else if (length === 5 && line.startsWith('event')) type = value
    else if (length === 2 && line.startsWith('id')) {
      if (!value.includes('\0')) lastId = value
    } else if (length === 5 && line.startsWith('retry') && isDigits(value)) retry = Number(value)
    return undefined
  }
}

function isDigits(value: string): boolean {
  if (value === '') return false
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    if (ch < 0x30 || ch > 0x39) return false
  }
  return true
}

/** Settles with `promise`, or rejects with the signal's reason as soon as it aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function* readStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  let finished = false
  try {
    for (;;) {
      const result = await raceAbort(reader.read(), signal)
      if (result.done) {
        finished = true
        return
      }
      yield result.value
    }
  } finally {
    // Aborted, failed or abandoned by the consumer: cancel the source so it stops producing.
    // Cancelling also settles a read still pending after an abort.
    if (!finished) await reader.cancel(signal?.reason).catch(() => {})
    reader.releaseLock()
  }
}

async function* readIterable(
  iterable: AsyncIterable<Uint8Array | string>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array | string> {
  const iterator = iterable[Symbol.asyncIterator]()
  let finished = false
  try {
    for (;;) {
      const result = await raceAbort(iterator.next(), signal)
      if (result.done) {
        finished = true
        return
      }
      yield result.value
    }
  } finally {
    // Not awaited: an async generator queues `return` behind a pending `next`.
    if (!finished) Promise.resolve(iterator.return?.()).catch(() => {})
  }
}

/**
 * Parses a server-sent event stream into events, per the WHATWG spec. Chunks may split lines and
 * UTF-8 characters anywhere. An event still incomplete when the stream ends is not dispatched.
 */
export async function* parseSSE(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
  options: ParseSSEOptions = {},
): AsyncIterable<SSEEvent> {
  const { signal } = options
  signal?.throwIfAborted()
  const decoder = createLineDecoder()
  const build = createEventBuilder()
  // Checked by shape, not `instanceof`: streams from another realm or polyfill must work too.
  const chunks = 'getReader' in source ? readStream(source, signal) : readIterable(source, signal)
  for await (const chunk of chunks) {
    for (const line of decoder.push(chunk)) {
      const event = build(line)
      if (event) yield event
    }
  }
}
