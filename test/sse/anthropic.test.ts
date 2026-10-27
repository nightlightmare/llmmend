import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { LlmEvent, SSEEvent } from '../../src/sse/index'
import { anthropic } from '../../src/sse/providers/anthropic'
import { byteStream, collectEvents, expectInvariants, sseFixtures } from './fixtures'
import { splitAt } from './split'

const fixtures = sseFixtures('anthropic')
const byName = new Map(fixtures.map((f) => [f.name, f.bytes]))

function run(name: string): Promise<LlmEvent[]> {
  const bytes = byName.get(name)
  if (!bytes) throw new Error(`No fixture ${name}`)
  return collectEvents(byteStream([bytes]), { provider: 'anthropic' })
}

/** Feeds raw Messages API payloads to a fresh adapter. */
function map(...payloads: unknown[]): LlmEvent[] {
  const next = anthropic.create()
  return payloads.flatMap((p) =>
    next({ event: 'message', data: typeof p === 'string' ? p : JSON.stringify(p) }),
  )
}

/** The latest usage snapshot. */
const lastUsage = (events: LlmEvent[]): LlmEvent | undefined =>
  events.reduce<LlmEvent | undefined>((last, e) => (e.type === 'usage' ? e : last), undefined)

const join = (events: LlmEvent[], type: 'text' | 'reasoning'): string =>
  events.map((e) => (e.type === type ? e.text : '')).join('')

describe('anthropic adapter: fixtures', () => {
  it.each(fixtures.map((f) => f.name))('%s matches the snapshot', async (name) => {
    await expect(JSON.stringify(await run(name), null, 2) + '\n').toMatchFileSnapshot(
      `__snapshots__/anthropic/${name}.json`,
    )
  })

  it.each(fixtures.map((f) => f.name))('%s keeps the stream invariants', async (name) => {
    expectInvariants(await run(name))
  })

  it.each(fixtures.map((f) => f.name))(
    '%s gives the same events however it is split',
    async (name) => {
      const bytes = byName.get(name) as Uint8Array
      const whole = await run(name)
      await fc.assert(
        fc.asyncProperty(fc.array(fc.nat(), { maxLength: 12 }), async (cuts) => {
          const events = await collectEvents(byteStream(splitAt(bytes, cuts)), {
            provider: 'anthropic',
          })
          expect(events).toEqual(whole)
        }),
        { numRuns: 20 },
      )
    },
  )

  it('streams text and ends the turn', async () => {
    const events = await run('text')
    expect(join(events, 'text')).toBe(
      'The sea stretches endlessly, its waves whispering secrets to the shore 🌊. Sailors have long called it by many names, but my favorite is the Russian word «море».',
    )
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'end',
      rawStopReason: 'end_turn',
      responseId: 'msg_bdrk_27og4ulziruevcs3sxlfj4zahaw22mpqytohxml5vczbpu6pndda',
    })
    expect(lastUsage(events)).toEqual({
      type: 'usage',
      inputTokens: 36,
      outputTokens: 57,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
  })

  it('streams summarized thinking with its signature before the text', async () => {
    const events = await run('thinking-summarized')
    expect(join(events, 'reasoning').length).toBeGreaterThan(100)
    const signature = events.find((e) => e.type === 'reasoning_signature')
    expect(signature).toMatchObject({ index: 0, signature: expect.stringMatching(/^\S{40,}$/) })
    const firstText = events.findIndex((e) => e.type === 'text')
    expect(events.findIndex((e) => e.type === 'reasoning_signature')).toBeLessThan(firstText)
    expect(events.find((e) => e.type === 'text')).toMatchObject({ index: 1 })
  })

  it('keeps the signature of omitted thinking', async () => {
    const events = await run('thinking-omitted')
    expect(events.filter((e) => e.type === 'reasoning')).toEqual([])
    expect(events.filter((e) => e.type === 'reasoning_signature')).toHaveLength(1)
  })

  it('passes redacted thinking through', async () => {
    const events = await run('redacted-thinking')
    expect(events[1]).toEqual({
      type: 'reasoning',
      index: 0,
      text: '',
      redacted: expect.stringMatching(/^EmwK/),
    })
    // message_delta repeats only output_tokens; the input counts carry over from message_start.
    expect(lastUsage(events)).toEqual({
      type: 'usage',
      inputTokens: 52,
      outputTokens: 41,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('splits parallel tool calls into start and argument deltas per Block', async () => {
    const events = await run('tool-use-parallel')
    const starts = events.filter((e) => e.type === 'tool_call_start')
    expect(starts).toEqual([
      {
        type: 'tool_call_start',
        index: 0,
        id: 'toolu_bdrk_015GWRtT4ZesppvbtnYQA77H',
        name: 'get_weather',
      },
      {
        type: 'tool_call_start',
        index: 1,
        id: 'toolu_bdrk_01HycGuweaMSyopJuXC8tCdt',
        name: 'get_weather',
      },
    ])
    const args = (index: number): unknown =>
      JSON.parse(
        events
          .map((e) => (e.type === 'tool_call_delta' && e.index === index ? e.argsDelta : ''))
          .join(''),
      )
    expect([args(0), args(1)]).toEqual([{ city: 'Paris' }, { city: 'Tokyo' }])
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'tool_use',
      rawStopReason: 'tool_use',
      responseId: 'msg_bdrk_dphddwqp6msats2llmo7cklrax34wxzp5uknl7ummrkc4hldy6uq',
    })
  })

  it('stops at max_tokens', async () => {
    const events = await run('max-tokens')
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      rawStopReason: 'max_tokens',
      responseId: 'msg_bdrk_6zhwtkhva7beo22itzg577mybtu6pd3lk7kre33gdkkxklbljn4a',
    })
  })

  it('counts cached tokens into inputTokens', async () => {
    const write = lastUsage(await run('cache-1-write'))
    const read = lastUsage(await run('cache-2-read'))
    expect(write).toMatchObject({ cacheWriteTokens: 6771, cacheReadTokens: 0 })
    expect(read).toMatchObject({ cacheReadTokens: 6771, cacheWriteTokens: 0 })
    for (const usage of [write, read]) {
      if (usage?.type !== 'usage') throw new Error('no usage')
      expect(usage.inputTokens).toBeGreaterThan(6771)
    }
  })

  it('turns a mid-stream Provider error into error, then done', async () => {
    const events = await run('overloaded-mid-stream')
    expect(events.slice(-3)).toEqual([
      { type: 'text', index: 0, text: 'The sea is' },
      {
        type: 'error',
        message: 'Overloaded',
        raw: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      },
      { type: 'done', stopReason: 'error' },
    ])
  })
})

describe('anthropic adapter: mapping', () => {
  it.each([
    ['end_turn', 'end'],
    ['max_tokens', 'max_tokens'],
    ['model_context_window_exceeded', 'max_tokens'],
    ['tool_use', 'tool_use'],
    ['stop_sequence', 'stop_sequence'],
    ['refusal', 'refused'],
    ['pause_turn', 'paused'],
    ['something_new', 'unknown'],
  ])('maps the stop reason %s to %s', (raw, stopReason) => {
    expect(
      map({ type: 'message_delta', delta: { stop_reason: raw } }, { type: 'message_stop' }).at(-1),
    ).toEqual({ type: 'done', stopReason, rawStopReason: raw })
  })

  it('ends with an unknown stop reason when message_delta never came', () => {
    expect(map({ type: 'message_stop' })).toEqual([{ type: 'done', stopReason: 'unknown' }])
  })

  it('drops housekeeping events and empty deltas', () => {
    expect(
      map(
        { type: 'ping' },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: '' },
        },
        { type: 'message_start', message: {} },
        { type: 'message_delta', delta: {} },
      ),
    ).toEqual([])
  })

  it('emits text and thinking that arrive in content_block_start', () => {
    expect(
      map(
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: 'Hm', signature: 'sig' },
        },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'Hi' } },
      ),
    ).toEqual([
      { type: 'reasoning', index: 0, text: 'Hm' },
      { type: 'reasoning_signature', index: 0, signature: 'sig' },
      { type: 'text', index: 1, text: 'Hi' },
    ])
  })

  it('fills missing tool call fields and redacted data with empty strings', () => {
    expect(
      map(
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '' },
        },
      ),
    ).toEqual([
      { type: 'tool_call_start', index: 0, id: '', name: '' },
      { type: 'reasoning', index: 1, text: '', redacted: '' },
    ])
  })

  it('emits unknown events, blocks, deltas and server tool arguments as other', () => {
    const payloads = [
      { type: 'brand_new_event' },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'server_tool_use', id: 's', name: 'web_search' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_delta', index: 1, delta: { type: 'citations_delta' } },
      { type: 'content_block_start' },
      { type: 'content_block_delta' },
      'not json',
      'null',
      '42',
    ]
    const events = map(...payloads)
    expect(events.map((e) => e.type)).toEqual(payloads.map(() => 'other'))
    const raw = events.map((e) => (e.type === 'other' ? e.raw : undefined))
    expect(raw[6]).toEqual({ event: 'message', data: 'not json' } satisfies SSEEvent)
  })

  it('uses a placeholder message for an error without one', () => {
    expect(map({ type: 'error', error: { type: 'api_error' } })).toEqual([
      {
        type: 'error',
        message: 'Provider error',
        raw: { type: 'error', error: { type: 'api_error' } },
      },
    ])
  })

  it('defaults a missing Block index to 0', () => {
    expect(map({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } })).toEqual([
      { type: 'text', index: 0, text: 'x' },
    ])
  })

  it('keeps separate state per stream', () => {
    const a = anthropic.create()
    const b = anthropic.create()
    const start = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 't', name: 'f' },
    }
    const delta = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{' },
    }
    a({ event: 'message', data: JSON.stringify(start) })
    expect(a({ event: 'message', data: JSON.stringify(delta) })[0]?.type).toBe('tool_call_delta')
    expect(b({ event: 'message', data: JSON.stringify(delta) })[0]?.type).toBe('other')
  })
})
