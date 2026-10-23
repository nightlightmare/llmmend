import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { LlmEvent } from '../../src/sse/index'
import { openaiResponses } from '../../src/sse/providers/openai-responses'
import { byteStream, collectEvents, expectInvariants, sseFixtures } from './fixtures'
import { splitAt } from './split'

// Synthetic OpenAI streams from the API reference, and Ollama's real /v1/responses streams.
const fixtures = ['openai-responses', 'ollama-responses'].flatMap((dir) =>
  sseFixtures(dir).map((f) => ({ ...f, name: `${dir}/${f.name}` })),
)
const byName = new Map(fixtures.map((f) => [f.name, f.bytes]))
const names = fixtures.map((f) => f.name)

function run(name: string): Promise<LlmEvent[]> {
  const bytes = byName.get(name)
  if (!bytes) throw new Error(`No fixture ${name}`)
  return collectEvents(byteStream([bytes]), { provider: 'openai-responses' })
}

/** Feeds raw events to a fresh adapter. */
function map(...payloads: unknown[]): LlmEvent[] {
  const next = openaiResponses.create()
  return payloads.flatMap((p) =>
    next({ event: 'message', data: typeof p === 'string' ? p : JSON.stringify(p) }),
  )
}

/** The latest usage snapshot. */
const lastUsage = (events: LlmEvent[]): LlmEvent | undefined =>
  events.reduce<LlmEvent | undefined>((last, e) => (e.type === 'usage' ? e : last), undefined)

const join = (events: LlmEvent[], type: 'text' | 'reasoning'): string =>
  events.map((e) => (e.type === type ? e.text : '')).join('')

const args = (events: LlmEvent[], index: number): string =>
  events.map((e) => (e.type === 'tool_call_delta' && e.index === index ? e.argsDelta : '')).join('')

describe('openai-responses adapter: fixtures', () => {
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
        const events = await collectEvents(byteStream(splitAt(bytes, cuts)), {
          provider: 'openai-responses',
        })
        expect(events).toEqual(whole)
      }),
      { numRuns: 20 },
    )
  })

  it('streams Ollama text with usage from response.completed', async () => {
    const events = await run('ollama-responses/text')
    expect(join(events, 'text')).toContain('🌞')
    expect(events.every((e) => !('index' in e) || e.index === 0)).toBe(true)
    expect(lastUsage(events)).toEqual({
      type: 'usage',
      inputTokens: 46,
      outputTokens: 26,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end', rawStopReason: 'completed' })
  })

  it('numbers tool calls by output_index and ends with tool_use', async () => {
    const events = await run('ollama-responses/tool-calls')
    expect(events.filter((e) => e.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', index: 0, id: 'call_trir5kan', name: 'get_weather' },
      { type: 'tool_call_start', index: 1, id: 'call_r5g1vw49', name: 'get_weather' },
    ])
    expect([args(events, 0), args(events, 1)]).toEqual(['{"city":"Paris"}', '{"city":"Tokyo"}'])
    expect(events.at(-1)).toMatchObject({ stopReason: 'tool_use' })
  })

  it('joins summary parts into one reasoning Block and passes encrypted content back', async () => {
    const events = await run('openai-responses/reasoning-encrypted')
    expect(join(events, 'reasoning')).toBe('The user asks for 12 squared.\n\n12 × 12 = 144.')
    expect(events.find((e) => e.type === 'reasoning_signature')).toEqual({
      type: 'reasoning_signature',
      index: 0,
      signature: 'gAAAAABpSYNTHETICencryptedReasoningContent==',
    })
    expect(events.every((e) => e.type !== 'text' || e.index === 1)).toBe(true)
    expect(lastUsage(events)).toMatchObject({ outputTokens: 96, reasoningTokens: 64 })
  })

  it('shows a refusal as text and ends as refused', async () => {
    const events = await run('openai-responses/refusal')
    expect(join(events, 'text')).toBe("I'm sorry, but I can't help with that.")
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'refused',
      rawStopReason: 'completed',
    })
  })

  it('maps response.incomplete to max_tokens', async () => {
    expect((await run('openai-responses/incomplete')).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      rawStopReason: 'max_output_tokens',
    })
  })

  it('keeps built-in tools as other, without taking the next Block number', async () => {
    const events = await run('openai-responses/web-search')
    expect(events.filter((e) => e.type === 'other').length).toBeGreaterThanOrEqual(4)
    expect(events.filter((e) => e.type.startsWith('tool_call'))).toEqual([])
    expect(events.every((e) => e.type !== 'text' || e.index === 1)).toBe(true)
    expect(lastUsage(events)).toMatchObject({ inputTokens: 310, cacheReadTokens: 128 })
    expect(events.at(-1)).toMatchObject({ stopReason: 'end' })
  })

  it('streams a custom tool’s free-form input as argument deltas', async () => {
    const events = await run('openai-responses/custom-tool')
    expect(events[0]).toEqual({
      type: 'tool_call_start',
      index: 0,
      id: 'call_custom1',
      name: 'run_sql',
    })
    expect(args(events, 0)).toBe('SELECT count(*) FROM users')
    expect(events.at(-1)).toMatchObject({ stopReason: 'tool_use' })
  })

  it('turns response.failed into error, then done', async () => {
    expect((await run('openai-responses/failed')).slice(-2)).toMatchObject([
      { type: 'error', message: 'The server had an error while processing your request.' },
      { type: 'done', stopReason: 'error' },
    ])
  })
})

describe('openai-responses adapter: mapping', () => {
  const completed = { type: 'response.completed', response: {} }

  it.each([
    ['max_output_tokens', 'max_tokens'],
    ['content_filter', 'refused'],
    ['something_new', 'unknown'],
  ])('maps the incomplete reason %s to %s', (reason, stopReason) => {
    expect(
      map({ type: 'response.incomplete', response: { incomplete_details: { reason } } }),
    ).toEqual([{ type: 'done', stopReason, rawStopReason: reason }])
  })

  it('reports incomplete without a reason as unknown', () => {
    expect(map({ type: 'response.incomplete', response: {} })).toEqual([
      { type: 'done', stopReason: 'unknown', rawStopReason: 'incomplete' },
    ])
  })

  it('reads raw reasoning text as reasoning', () => {
    expect(map({ type: 'response.reasoning_text.delta', output_index: 2, delta: 'hm' })).toEqual([
      { type: 'reasoning', index: 2, text: 'hm' },
    ])
  })

  it('drops lifecycle events, done repeats and empty deltas', () => {
    expect(
      map(
        { type: 'response.created' },
        { type: 'response.output_text.done', text: 'x' },
        { type: 'response.output_text.delta', delta: '' },
        { type: 'response.reasoning_summary_text.delta', delta: '' },
        { type: 'response.refusal.delta', delta: '' },
        { type: 'response.output_item.added', item: { type: 'message' } },
        { type: 'response.output_item.done', item: { type: 'reasoning' } },
      ),
    ).toEqual([])
  })

  it('emits argument deltas for unknown items as other', () => {
    expect(map({ type: 'response.function_call_arguments.delta', delta: '{' })[0]?.type).toBe(
      'other',
    )
  })

  it('fills a tool call without call_id or name', () => {
    expect(
      map(
        { type: 'response.output_item.added', item: { type: 'function_call' } },
        { type: 'response.function_call_arguments.delta', delta: '' },
      ),
    ).toEqual([{ type: 'tool_call_start', index: 0, id: '', name: '' }])
  })

  it('reports usage counts only when present', () => {
    expect(map({ ...completed, response: { usage: {} } })).toEqual([
      { type: 'usage' },
      { type: 'done', stopReason: 'end', rawStopReason: 'completed' },
    ])
    expect(map(completed)).toEqual([
      { type: 'done', stopReason: 'end', rawStopReason: 'completed' },
    ])
  })

  it('reads the event type from the SSE event name when the data has none', () => {
    const next = openaiResponses.create()
    expect(next({ event: 'response.output_text.delta', data: '{"delta":"x"}' })).toEqual([
      { type: 'text', index: 0, text: 'x' },
    ])
  })

  it('uses placeholder messages for errors without one', () => {
    expect(
      map({ type: 'error' }, { type: 'response.failed' }).map(
        (e) => e.type === 'error' && e.message,
      ),
    ).toEqual(['Provider error', 'Provider error'])
  })

  it('emits unknown and non-JSON events as other', () => {
    expect(map('nope', { type: 'response.something_new' }).map((e) => e.type)).toEqual([
      'other',
      'other',
    ])
  })
})
