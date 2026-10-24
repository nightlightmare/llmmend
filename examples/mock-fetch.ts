// A stand-in for the provider APIs, so the examples' checks run in CI without keys or network.
// It answers a streaming request with `reply`, split into small deltas in the format of the
// provider the URL points to, the way the real APIs stream it.

export interface MockProvider {
  fetch: typeof fetch
  /** Every request the example sent, in order. */
  requests: Request[]
}

const sse = (events: unknown[]) =>
  events.map((data) => `data: ${JSON.stringify(data)}\n\n`).join('')

/** `reply` in pieces of a few characters, like a model's output tokens. */
const pieces = (reply: string) => reply.match(/[\s\S]{1,7}/g) ?? []

function anthropic(reply: string): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 1 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    ...pieces(reply).map(
      (text) =>
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
    ),
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ].join('')
}

const chatChunk = (delta: object, finish: string | null = null) => ({
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta, finish_reason: finish }],
})

function openai(reply: string): string {
  return (
    sse([
      chatChunk({ role: 'assistant', content: '' }),
      ...pieces(reply).map((content) => chatChunk({ content })),
      chatChunk({}, 'stop'),
    ]) + 'data: [DONE]\n\n'
  )
}

function gemini(reply: string): string {
  const parts = pieces(reply)
  return sse(
    parts.map((text, i) => ({
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          ...(i === parts.length - 1 ? { finishReason: 'STOP' } : {}),
        },
      ],
    })),
  )
}

/** Answers Anthropic Messages, Chat Completions and Gemini streaming requests with `reply`. */
export function mockProvider(reply: string): MockProvider {
  const requests: Request[] = []
  const mock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    requests.push(request.clone())
    const { pathname } = new URL(request.url)
    const body = pathname.endsWith('/messages')
      ? anthropic(reply)
      : pathname.endsWith('/chat/completions')
        ? openai(reply)
        : pathname.endsWith(':streamGenerateContent')
          ? gemini(reply)
          : undefined
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetch: mock as typeof fetch, requests }
}
