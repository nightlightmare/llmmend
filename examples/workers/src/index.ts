import { streamText } from 'llmmend/sse'

export interface Env {
  /** The provider's streaming endpoint, e.g. https://api.anthropic.com/v1/messages. */
  UPSTREAM_URL: string
  /** The API key (a secret: `wrangler secret put API_KEY`). */
  API_KEY: string
  /** The header the provider expects the key in: `authorization` (default), `x-api-key`, `x-goog-api-key`. */
  AUTH_HEADER?: string
}

/** Headers of the client's request that the provider gets as they are (`anthropic-version`, …). */
const FORWARDED = /^(content-type|anthropic-.*|openai-.*)$/

// A proxy that keeps the key on the server and streams back only the text of the reply, as
// plain text. The provider is detected from its stream ('auto', the default), so the same
// Worker serves Anthropic, OpenAI-compatible APIs and Gemini: point UPSTREAM_URL elsewhere.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('POST a provider request body', { status: 405 })

    const headers = new Headers()
    for (const [name, value] of request.headers) if (FORWARDED.test(name)) headers.set(name, value)
    const auth = env.AUTH_HEADER ?? 'authorization'
    headers.set(auth, auth === 'authorization' ? `Bearer ${env.API_KEY}` : env.API_KEY)

    // The request is small: read it whole rather than stream it (Node's fetch would need `duplex`).
    const body = await request.arrayBuffer()
    const upstream = await fetch(env.UPSTREAM_URL, { method: 'POST', headers, body })
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status })

    const text = streamText(upstream)[Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await text.next()
        if (done) controller.close()
        else controller.enqueue(encoder.encode(value))
      },
      // The client went away: stop reading from the provider too.
      async cancel() {
        await text.return?.()
      },
    })
    return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  },
}
