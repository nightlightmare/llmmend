import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { LlmEvent } from '../../src/sse/index'
import { openai } from '../../src/sse/providers/openai'
import { byteStream, collectEvents, expectInvariants, sseFixtures } from './fixtures'
import { splitAt } from './split'

// Every OpenAI-compatible Provider goes through the same adapter.
const fixtures = ['openai', 'openrouter', 'ollama'].flatMap((dir) =>
  sseFixtures(dir).map((f) => ({ ...f, name: `${dir}/${f.name}` })),
)
const byName = new Map(fixtures.map((f) => [f.name, f.bytes]))
const names = fixtures.map((f) => f.name)

function run(name: string): Promise<LlmEvent[]> {
  const bytes = byName.get(name)
  if (!bytes) throw new Error(`No fixture ${name}`)
  return collectEvents(byteStream([bytes]), { provider: 'openai' })
}

/** Feeds raw chunks to a fresh adapter. */
function map(...payloads: unknown[]): LlmEvent[] {
  const next = openai.create()
  return payloads.flatMap((p) =>
    next({ event: 'message', data: typeof p === 'string' ? p : JSON.stringify(p) }),
  )
}

const chunk = (delta: unknown, finish: string | null = null): unknown => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
})

/** The latest usage snapshot. */
const lastUsage = (events: LlmEvent[]): LlmEvent | undefined =>
  events.reduce<LlmEvent | undefined>((last, e) => (e.type === 'usage' ? e : last), undefined)

const join = (events: LlmEvent[], type: 'text' | 'reasoning'): string =>
  events.map((e) => (e.type === type ? e.text : '')).join('')

describe('openai adapter: fixtures', () => {
  it.each(names)('%s matches the snapshot', async (name) => {
    await expect(JSON.stringify(await run(name), null, 2) + '\n').toMatchFileSnapshot(
      `__snapshots__/${name}.json`,
    )
  })

  it.each(names)('%s keeps the stream invariants', async (name) => {
    expectInvariants(await run(name))
  })

  it.each(names)('%s gives the same events however it is split', async (name) => {
    const bytes = byName.get(name) as Uint8Array
    const whole = await run(name)
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { maxLength: 12 }), async (cuts) => {
        const events = await collectEvents(byteStream(splitAt(bytes, cuts)), { provider: 'openai' })
        expect(events).toEqual(whole)
      }),
      { numRuns: 20 },
    )
  })

  it('streams Ollama text with usage from the final chunk', async () => {
    const events = await run('ollama/text')
    expect(join(events, 'text').length).toBeGreaterThan(20)
    expect(events.every((e) => e.type !== 'text' || e.index === 0)).toBe(true)
    expect(lastUsage(events)).toEqual({
      type: 'usage',
      inputTokens: 46,
      outputTokens: 21,
      cacheReadTokens: 24,
    })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end', rawStopReason: 'stop' })
  })

  it('emits start and arguments together when a tool call arrives whole (Ollama)', async () => {
    const events = await run('ollama/tool-calls')
    expect(events.filter((e) => e.type.startsWith('tool_call'))).toEqual([
      { type: 'tool_call_start', index: 0, id: 'call_tccdrpuc', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"city":"Paris"}' },
      { type: 'tool_call_start', index: 1, id: 'call_6ytilnpo', name: 'get_weather' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{"city":"Tokyo"}' },
    ])
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'tool_use',
      rawStopReason: 'tool_calls',
    })
  })

  it('assembles tool call arguments streamed in pieces', async () => {
    const events = await run('openai/parallel-tool-calls')
    const args = (index: number): unknown =>
      JSON.parse(
        events
          .map((e) => (e.type === 'tool_call_delta' && e.index === index ? e.argsDelta : ''))
          .join(''),
      )
    expect(events.filter((e) => e.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', index: 0, id: 'call_Paris01', name: 'get_weather' },
      { type: 'tool_call_start', index: 1, id: 'call_Tokyo02', name: 'get_weather' },
    ])
    expect([args(0), args(1)]).toEqual([{ city: 'Paris' }, { city: 'Tokyo' }])
    expect(lastUsage(events)).toEqual({
      type: 'usage',
      inputTokens: 82,
      outputTokens: 151,
      cacheReadTokens: 0,
      reasoningTokens: 128,
    })
  })

  it.each([
    ['openai/reasoning-content', /^2\^31 - 1 is a Mersenne prime, proven by Euler\.$/],
    ['openrouter/reasoning', /^The user asks for 12 squared\.$/],
    ['ollama/reasoning', /^Okay, so I need to/],
  ])('reads reasoning from %s into its own Block before the text', async (name, reasoning) => {
    const events = await run(name)
    expect(join(events, 'reasoning')).toMatch(reasoning)
    expect(events.every((e) => e.type !== 'reasoning' || e.index === 0)).toBe(true)
    expect(events.every((e) => e.type !== 'text' || e.index === 1)).toBe(true)
  })

  it('keeps the stop reason when usage arrives on a later chunk (OpenRouter)', async () => {
    const events = await run('openrouter/reasoning')
    expect(join(events, 'text')).toBe('12 squared is 144.')
    expect(lastUsage(events)).toMatchObject({ inputTokens: 14, reasoningTokens: 31 })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end', rawStopReason: 'stop' })
  })

  it('stops at the length limit', async () => {
    expect((await run('ollama/reasoning')).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      rawStopReason: 'length',
    })
  })

  it('turns a mid-stream error payload into error, then done', async () => {
    expect((await run('openai/error-mid-stream')).slice(-2)).toEqual([
      {
        type: 'error',
        message: 'The server had an error while processing your request. Sorry about that!',
        raw: {
          error: {
            message: 'The server had an error while processing your request. Sorry about that!',
            type: 'server_error',
            param: null,
            code: null,
          },
        },
      },
      { type: 'done', stopReason: 'error' },
    ])
  })
})

describe('openai adapter: mapping', () => {
  it.each([
    ['stop', 'end'],
    ['length', 'max_tokens'],
    ['tool_calls', 'tool_use'],
    ['function_call', 'tool_use'],
    ['content_filter', 'refused'],
    ['something_new', 'unknown'],
  ])('maps the finish reason %s to %s', (raw, stopReason) => {
    expect(map(chunk({}, raw), '[DONE]')).toEqual([
      { type: 'done', stopReason, rawStopReason: raw },
    ])
  })

  it('ends with an unknown stop reason when no finish reason came', () => {
    expect(map('[DONE]')).toEqual([{ type: 'done', stopReason: 'unknown' }])
  })

  it('reads only the first choice', () => {
    expect(
      map({
        choices: [
          { index: 0, delta: { content: 'a' } },
          { index: 1, delta: { content: 'b' } },
        ],
      }),
    ).toEqual([{ type: 'text', index: 0, text: 'a' }])
  })

  it('numbers Blocks in order of first appearance', () => {
    expect(
      map(
        chunk({ content: 'Let me check.' }),
        chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }),
        chunk({ content: ' Done.' }),
      ),
    ).toEqual([
      { type: 'text', index: 0, text: 'Let me check.' },
      { type: 'tool_call_start', index: 1, id: 'a', name: 'f' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{' },
      { type: 'tool_call_delta', index: 1, argsDelta: '}' },
      { type: 'text', index: 0, text: ' Done.' },
    ])
  })

  it('falls back to the array position and empty strings for incomplete tool calls', () => {
    expect(map(chunk({ tool_calls: [{}, { function: {} }] }))).toEqual([
      { type: 'tool_call_start', index: 0, id: '', name: '' },
      { type: 'tool_call_start', index: 1, id: '', name: '' },
    ])
  })

  it('drops empty and null deltas', () => {
    expect(
      map(
        chunk({ role: 'assistant', content: '', reasoning: null, reasoning_content: '' }),
        chunk({ content: null, tool_calls: null }),
        { choices: [{ index: 0 }] },
        { choices: [] },
        { choices: [], usage: null },
      ),
    ).toEqual([])
  })

  it('reports usage counts only when present', () => {
    expect(map({ choices: [], usage: {} })).toEqual([{ type: 'usage' }])
    expect(
      map({
        choices: [],
        usage: { prompt_tokens: 5, prompt_tokens_details: null, completion_tokens_details: null },
      }),
    ).toEqual([{ type: 'usage', inputTokens: 5 }])
  })

  it('emits unknown payloads as other', () => {
    const payloads = ['not json', '42', { object: 'something.else' }]
    expect(map(...payloads).map((e) => e.type)).toEqual(['other', 'other', 'other'])
  })

  it('uses a placeholder message for an error without one', () => {
    expect(map({ error: {} })).toEqual([
      { type: 'error', message: 'Provider error', raw: { error: {} } },
    ])
  })

  it('keeps separate state per stream', () => {
    const a = openai.create()
    const b = openai.create()
    a({ event: 'message', data: JSON.stringify(chunk({ content: 'x' })) })
    const tool = JSON.stringify(
      chunk({ tool_calls: [{ index: 0, id: 't', function: { name: 'f' } }] }),
    )
    expect(a({ event: 'message', data: tool })).toMatchObject([{ index: 1 }])
    expect(b({ event: 'message', data: tool })).toMatchObject([{ index: 0 }])
  })
})
