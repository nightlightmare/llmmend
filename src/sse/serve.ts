// Serving server-sent events, the other direction of `parseSSE`: a server streaming to a browser,
// for example a proxy in front of a Provider (`sseResponse(streamLlm(upstream))`).

/** One event to send. A `data` that is not a string goes through `JSON.stringify`. */
export interface SSEMessage {
  data: unknown
  event?: string
  id?: string
  /** The reconnection time the client should use, in milliseconds. */
  retry?: number
}

export interface SSEStreamOptions {
  /**
   * After this many milliseconds without an event, send a `:` comment, so that proxies do not
   * drop a quiet connection. Off by default.
   */
  keepAlive?: number
}

const FIELDS = new Set(['data', 'event', 'id', 'retry'])
const KEEP_ALIVE = ':\n\n'

/** An event object: `data` and no keys but `event`, `id` and `retry`. Anything else is a value. */
function isMessage(value: unknown): value is SSEMessage {
  if (typeof value !== 'object' || value === null || !('data' in value)) return false
  return Object.keys(value).every((key) => FIELDS.has(key))
}

/** A field whose value must stay on one line, or the event would break apart. */
function field(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new TypeError(`An SSE ${name} cannot contain a line break`)
  return `${name}: ${value}\n`
}

/** The wire form of one event; multi-line data becomes several `data:` lines. */
function encode(value: unknown): string {
  const message = isMessage(value) ? value : { data: value }
  let out = ''
  if (message.event !== undefined) out += field('event', message.event)
  if (message.id !== undefined) out += field('id', message.id)
  if (message.retry !== undefined) {
    if (!Number.isInteger(message.retry) || message.retry < 0) {
      throw new TypeError('An SSE retry must be a whole number of milliseconds')
    }
    out += `retry: ${message.retry}\n`
  }
  const data =
    typeof message.data === 'string' ? message.data : (JSON.stringify(message.data) ?? '')
  for (const line of data.split(/\r\n|\r|\n/)) out += `data: ${line}\n`
  return `${out}\n`
}

/**
 * Turns an async iterable into an SSE byte stream. Each item is an event (`{ data, event?, id?,
 * retry? }`) or a plain value sent as `data`. When the client goes away, the stream calls
 * `return()` on the source, so a source that reads from upstream (such as `streamLlm`) stops too.
 * An error from the source errors the stream.
 */
export function createSSEStream(
  source: AsyncIterable<unknown>,
  options: SSEStreamOptions = {},
): ReadableStream<Uint8Array> {
  const { keepAlive } = options
  const encoder = new TextEncoder()
  const iterator = source[Symbol.asyncIterator]()
  let timer: ReturnType<typeof setTimeout> | undefined
  let send: (text: string) => void = () => {}

  const quiet = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  // Each event restarts the wait, so a comment goes out only after `keepAlive` of silence.
  const wait = (): void => {
    quiet()
    if (keepAlive) timer = setTimeout(() => send(KEEP_ALIVE), keepAlive)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      send = (text) => {
        controller.enqueue(encoder.encode(text))
        wait()
      }
      wait()
    },
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          quiet()
          controller.close()
        } else {
          send(encode(next.value))
        }
      } catch (error) {
        quiet()
        throw error
      }
    },
    cancel(reason) {
      quiet()
      // Not awaited: a source waiting on a quiet upstream finishes its `return()` only later.
      void iterator.return?.(reason)?.catch(() => {})
    },
  })
}

const HEADERS: [string, string][] = [
  ['content-type', 'text/event-stream'],
  ['cache-control', 'no-cache'],
  // nginx buffers responses unless told not to, which would hold events back.
  ['x-accel-buffering', 'no'],
]

/**
 * A `Response` that streams `source` as server-sent events (see `createSSEStream`), with
 * `content-type: text/event-stream`, `cache-control: no-cache` and `x-accel-buffering: no` unless
 * `init` sets them.
 */
export function sseResponse(
  source: AsyncIterable<unknown>,
  init: ResponseInit & SSEStreamOptions = {},
): Response {
  const { keepAlive, ...responseInit } = init
  const headers = new Headers(responseInit.headers)
  for (const [name, value] of HEADERS) if (!headers.has(name)) headers.set(name, value)
  const stream = createSSEStream(source, keepAlive === undefined ? {} : { keepAlive })
  return new Response(stream, { ...responseInit, headers })
}
