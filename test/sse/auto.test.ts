import { describe, expect, it } from 'vitest'
import { LlmmendError, type Provider, streamLlm } from '../../src/sse/index'
import { byteStream, collectEvents, sseFixtures } from './fixtures'

const encoder = new TextEncoder()

// Every recorded and synthetic stream, with the Provider it was written for.
const providers: Record<string, Provider> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openai',
  ollama: 'openai',
  gemini: 'gemini',
  'openai-responses': 'openai-responses',
  'ollama-responses': 'openai-responses',
}
const fixtures = Object.entries(providers).flatMap(([dir, provider]) =>
  sseFixtures(dir).map((f) => ({ name: `${dir}/${f.name}`, provider, bytes: f.bytes })),
)

const sse = (...events: string[]): ReadableStream<Uint8Array> =>
  byteStream([encoder.encode(events.map((e) => `${e}\n\n`).join(''))])
const data = (payload: unknown): string => `data: ${JSON.stringify(payload)}`

describe("provider: 'auto'", () => {
  it('covers every fixture directory', () => {
    expect(new Set(fixtures.map((f) => f.name.split('/')[0]))).toEqual(
      new Set(Object.keys(providers)),
    )
  })

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s gives the same events as the explicit Provider',
    async (_, { provider, bytes }) => {
      const explicit = await collectEvents(byteStream([bytes]), { provider })
      expect(await collectEvents(byteStream([bytes]), { provider: 'auto' })).toEqual(explicit)
    },
  )

  it('is the default', async () => {
    const bytes = fixtures.find((f) => f.name === 'gemini/text')?.bytes as Uint8Array
    const events: unknown[] = []
    for await (const event of streamLlm(byteStream([bytes]))) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end' })
  })

  it('buffers undecided events and replays them through the detected adapter', async () => {
    const events = await collectEvents(
      sse(
        'event: ping\ndata: {"type": "ping"}',
        'data: not json',
        data({ type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 1 } } }),
        data({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        data({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        data({ type: 'message_stop' }),
      ),
      {},
    )
    expect(events).toEqual([
      { type: 'other', raw: { event: 'message', data: 'not json' } },
      { type: 'usage', inputTokens: 3, outputTokens: 1 },
      { type: 'text', index: 0, text: 'Hi' },
      { type: 'done', stopReason: 'end', rawStopReason: 'end_turn' },
    ])
  })

  it.each([
    ['Anthropic', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
    ['OpenAI or Gemini', { error: { message: 'Overloaded', code: 503 } }],
    ['OpenAI Responses', { type: 'error', code: 'server_error', message: 'Overloaded' }],
  ])('reports an error before the answer in the %s shape', async (_, payload) => {
    expect(await collectEvents(sse(data(payload)), {})).toEqual([
      { type: 'error', message: 'Overloaded', raw: payload },
      { type: 'done', stopReason: 'error' },
    ])
  })

  it('uses a placeholder message for an error without one', async () => {
    expect((await collectEvents(sse(data({ error: {} })), {}))[0]).toMatchObject({
      message: 'Provider error',
    })
  })

  it('ends a stream that never shows its format with an unknown stop reason', async () => {
    expect(await collectEvents(sse('data: {"type": "ping"}', 'data: [DONE]'), {})).toEqual([
      { type: 'done', stopReason: 'unknown' },
    ])
  })

  it('gives up after 20 undecided events', async () => {
    const pings = Array.from({ length: 20 }, () => 'data: {"type": "ping"}')
    const error = await collectEvents(sse(...pings), {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmmendError)
    expect(error).toMatchObject({ code: 'unknown_provider' })
    expect(await collectEvents(sse(...pings.slice(1)), {})).toEqual([
      { type: 'done', stopReason: 'unknown' },
    ])
  })
})
