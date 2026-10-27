import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  collectText,
  type LlmEvent,
  type ProviderAdapter,
  streamToolCalls,
  type StreamToolCallsItem,
} from '../../src/sse/index'
import { byteStream, sseFixtures } from './fixtures'

const encoder = new TextEncoder()
const fixtureBytes = (dir: string, name: string): Uint8Array =>
  sseFixtures(dir).find((f) => f.name === name)?.bytes as Uint8Array

/** An adapter that turns every event's data into the LLM events it encodes as JSON. */
const echo: ProviderAdapter = {
  name: 'echo',
  create: () => (event) => JSON.parse(event.data) as LlmEvent[],
}
const stream = (...events: LlmEvent[]): ReadableStream<Uint8Array> =>
  byteStream(events.map((e) => encoder.encode(`data: ${JSON.stringify([e])}\n\n`)))
const start = (index: number, name = 'show_gauge'): LlmEvent => ({
  type: 'tool_call_start',
  index,
  id: `call_${index}`,
  name,
})
const delta = (index: number, argsDelta: string): LlmEvent => ({
  type: 'tool_call_delta',
  index,
  argsDelta,
})
const done: LlmEvent = { type: 'done', stopReason: 'tool_use' }

type CallItem = Extract<StreamToolCallsItem, { type: 'tool_call' }>
const isCall = (item: StreamToolCallsItem): item is CallItem =>
  !item.done && item.type === 'tool_call'
const partialsOf = (all: StreamToolCallsItem[]): unknown[] =>
  all.filter(isCall).map((i) => i.partial)

async function items<T extends Parameters<typeof streamToolCalls>[1]>(
  source: ReadableStream<Uint8Array>,
  options?: T,
): Promise<StreamToolCallsItem[]> {
  const out: StreamToolCallsItem[] = []
  for await (const item of streamToolCalls(source, options)) out.push(item as StreamToolCallsItem)
  return out
}

describe('streamToolCalls on recorded streams', () => {
  it.each([
    ['anthropic', 'tool-use-parallel'],
    ['openai', 'parallel-tool-calls'],
    ['ollama', 'tool-calls'],
    ['ollama-responses', 'tool-calls'],
    ['gemini', 'tool-calls-parallel'],
  ])('%s %s: Partial values grow, and the last item is collectText', async (dir, name) => {
    const bytes = fixtureBytes(dir, name)
    const all = await items(byteStream([bytes]))
    const last = all.at(-1)
    expect(last).toEqual({ done: true, ...(await collectText(byteStream([bytes]))) })
    // Every one of these Providers sent a response id.
    expect(last).toHaveProperty('responseId', expect.stringMatching(/./))

    // Each call's last Partial value is its final arguments.
    const partials = all.filter(isCall)
    for (const call of last?.done ? last.toolCalls : []) {
      const mine = partials.filter((p) => p.index === call.index)
      expect(mine.at(-1)?.partial).toEqual(call.ok && !call.custom ? call.args : undefined)
    }
    expect(partials.length).toBeGreaterThanOrEqual(2)
  })

  it('yields the text of an answer without tool calls, piece by piece', async () => {
    const bytes = fixtureBytes('anthropic', 'text')
    const all = await items(byteStream([bytes]))
    const pieces = all.filter((i) => !i.done && i.type === 'text')
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.map((p) => (p.done === false && p.type === 'text' ? p.text : '')).join('')).toBe(
      (await collectText(byteStream([bytes]))).text,
    )
    expect(all.at(-1)).toMatchObject({ done: true, toolCalls: [] })
  })

  it('yields a custom tool input as text so far', async () => {
    const all = await items(byteStream([fixtureBytes('openai-responses', 'custom-tool')]))
    const calls = all.filter(isCall)
    expect(calls[calls.length - 1]).toMatchObject({
      custom: true,
      partial: 'SELECT count(*) FROM users',
    })
    expect(all.at(-1)).toMatchObject({ done: true, toolCalls: [{ ok: true, custom: true }] })
  })
})

describe('streamToolCalls Partial values', () => {
  it('never shows an unfinished number', async () => {
    const source = stream(
      start(0),
      delta(0, '{"value": 7'),
      delta(0, '2, "max": 1'),
      delta(0, '00}'),
      done,
    )
    expect(partialsOf(await items(source, { provider: echo }))).toEqual([
      {},
      { value: 72 },
      { value: 72, max: 100 },
    ])
  })

  it('does not repeat an unchanged value', async () => {
    const source = stream(
      start(0),
      delta(0, '{"a": '),
      delta(0, ' '),
      delta(0, '"x"'),
      delta(0, '}'),
      done,
    )
    expect(partialsOf(await items(source, { provider: echo }))).toEqual([{}, { a: 'x' }])
  })

  it('interleaves text and calls in stream order', async () => {
    const source = stream(
      { type: 'text', index: 0, text: 'Checking.' },
      start(1),
      delta(1, '{"value": 1}'),
      done,
    )
    const kinds = (await items(source, { provider: echo })).map((i) => (i.done ? 'done' : i.type))
    expect(kinds).toEqual(['text', 'tool_call', 'done'])
  })

  it('yields nothing for a tool missing from tools, which then ends as unknown_tool', async () => {
    const tools = { show_gauge: z.object({ value: z.number(), max: z.number() }) }
    const source = stream(start(0, 'rm_rf'), delta(0, '{"path": "/"}'), done)
    const all = await items(source, { provider: echo, tools })
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ done: true, toolCalls: [{ ok: false, error: 'unknown_tool' }] })
  })

  it('types partial as the schema input, deep partial, by tool name', async () => {
    const tools = {
      show_gauge: z.object({ value: z.number(), max: z.number().default(100) }),
      plot: z.object({ points: z.array(z.object({ x: z.number(), y: z.number() })) }),
    }
    const seen: unknown[] = []
    for await (const item of streamToolCalls(stream(done), { provider: echo, tools })) {
      seen.push(item)
      if (!item.done && item.type === 'tool_call' && item.name === 'show_gauge')
        expectTypeOf(item.partial).toEqualTypeOf<{ value?: number; max?: number | undefined }>()
      if (!item.done && item.type === 'tool_call' && item.name === 'plot')
        expectTypeOf(item.partial).toEqualTypeOf<{ points?: { x?: number; y?: number }[] }>()
    }
    for await (const item of streamToolCalls(stream(done), { provider: echo }))
      if (!item.done && item.type === 'tool_call')
        expectTypeOf(item.partial).toEqualTypeOf<unknown>()
    expect(seen).toEqual([{ done: true, text: '', stopReason: 'tool_use', toolCalls: [] }])
  })
})
