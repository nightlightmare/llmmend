import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { StandardSchemaV1 } from '../../src/json/index'
import { collectText, type LlmEvent, type ProviderAdapter } from '../../src/sse/index'
import { byteStream, sseFixtures } from './fixtures'

const encoder = new TextEncoder()
const fixture = (dir: string, name: string): ReadableStream<Uint8Array> =>
  byteStream([sseFixtures(dir).find((f) => f.name === name)?.bytes as Uint8Array])

/** An adapter that turns every event's data into the LLM events it encodes as JSON. */
const echo: ProviderAdapter = {
  name: 'echo',
  create: () => (event) => JSON.parse(event.data) as LlmEvent[],
}
const stream = (...events: LlmEvent[]): ReadableStream<Uint8Array> =>
  byteStream(events.map((e) => encoder.encode(`data: ${JSON.stringify([e])}\n\n`)))
const start = (index: number, name = 'get_weather', id = `call_${index}`): LlmEvent => ({
  type: 'tool_call_start',
  index,
  id,
  name,
})
const delta = (index: number, argsDelta: string): LlmEvent => ({
  type: 'tool_call_delta',
  index,
  argsDelta,
})
const done = (stopReason: 'tool_use' | 'max_tokens' = 'tool_use'): LlmEvent => ({
  type: 'done',
  stopReason,
})

describe('collectText: tool calls from recorded streams', () => {
  it.each([
    ['anthropic', 'tool-use-parallel'],
    ['openai', 'parallel-tool-calls'],
    ['ollama', 'tool-calls'],
    ['ollama-responses', 'tool-calls'],
    ['gemini', 'tool-calls-parallel'],
  ])('%s %s: two get_weather calls in Block order', async (dir, name) => {
    const { toolCalls, stopReason } = await collectText(fixture(dir, name))
    expect(stopReason).toBe('tool_use')
    expect(toolCalls).toMatchObject([
      { ok: true, name: 'get_weather', args: { city: 'Paris' }, issues: [] },
      { ok: true, name: 'get_weather', args: { city: 'Tokyo' }, issues: [] },
    ])
    expect(toolCalls[0]!.index).toBeLessThan(toolCalls[1]!.index)
    expect(toolCalls.every((c) => c.id !== '')).toBe(true)
  })

  it('keeps an OpenAI Responses custom tool input as text', async () => {
    const { toolCalls } = await collectText(fixture('openai-responses', 'custom-tool'))
    expect(toolCalls).toEqual([
      {
        index: 0,
        id: 'call_custom1',
        name: 'run_sql',
        ok: true,
        custom: true,
        input: 'SELECT count(*) FROM users',
        issues: [],
      },
    ])
  })

  it('validates a custom tool input with its schema', async () => {
    const select = z.string().startsWith('SELECT')
    const ok = await collectText(fixture('openai-responses', 'custom-tool'), {
      tools: { run_sql: select },
    })
    expect(ok.toolCalls[0]).toMatchObject({ ok: true, custom: true })
    const failed = await collectText(fixture('openai-responses', 'custom-tool'), {
      tools: { run_sql: z.string().startsWith('DELETE') },
    })
    expect(failed.toolCalls[0]).toMatchObject({
      ok: false,
      custom: true,
      error: 'schema_mismatch',
      argsText: 'SELECT count(*) FROM users',
    })
  })

  it('returns no tool calls for an answer without them', async () => {
    const { toolCalls } = await collectText(fixture('anthropic', 'text'))
    expect(toolCalls).toEqual([])
  })
})

describe('collectText: tool call arguments', () => {
  it('joins argument deltas', async () => {
    const source = stream(
      start(0),
      delta(0, '{"ci'),
      delta(0, 'ty": "Pa'),
      delta(0, 'ris"}'),
      done(),
    )
    const { toolCalls } = await collectText(source, { provider: echo })
    expect(toolCalls).toEqual([
      {
        index: 0,
        id: 'call_0',
        name: 'get_weather',
        ok: true,
        args: { city: 'Paris' },
        issues: [],
      },
    ])
  })

  it('repairs syntax and lists what it fixed', async () => {
    const source = stream(start(0), delta(0, "{'city': 'Paris', 'days': [1, 2,],}"), done())
    const [call] = (await collectText(source, { provider: echo })).toolCalls
    expect(call).toMatchObject({ ok: true, args: { city: 'Paris', days: [1, 2] } })
    expect(new Set(call!.issues.map((i) => i.code))).toEqual(
      new Set(['single_quotes', 'trailing_comma']),
    )
  })

  it('reports cut-off arguments and never completes them', async () => {
    const source = stream(
      start(0, 'delete_files'),
      delta(0, '{"paths": ["a.txt", "b.t'),
      done('max_tokens'),
    )
    const { toolCalls, stopReason } = await collectText(source, { provider: echo })
    expect(stopReason).toBe('max_tokens')
    expect(toolCalls).toEqual([
      {
        index: 0,
        id: 'call_0',
        name: 'delete_files',
        ok: false,
        error: 'truncated',
        argsText: '{"paths": ["a.txt", "b.t',
        issues: [],
      },
    ])
  })

  it('reports arguments that are not JSON', async () => {
    const source = stream(start(0), delta(0, '{"city": }'), done())
    const [call] = (await collectText(source, { provider: echo })).toolCalls
    expect(call).toMatchObject({ ok: false, error: 'unparseable', argsText: '{"city": }' })
  })

  it('reads missing or blank arguments as an empty object', async () => {
    const source = stream(start(0, 'now'), start(1, 'today'), delta(1, '  '), done())
    const { toolCalls } = await collectText(source, { provider: echo })
    expect(toolCalls).toMatchObject([
      { ok: true, name: 'now', args: {} },
      { ok: true, name: 'today', args: {} },
    ])
  })

  it('orders calls by Block and ignores deltas without a start', async () => {
    const source = stream(
      start(3, 'b'),
      start(1, 'a'),
      delta(7, '{}'),
      delta(1, '{}'),
      delta(3, '{}'),
      done(),
    )
    const { toolCalls } = await collectText(source, { provider: echo })
    expect(toolCalls.map((c) => [c.index, c.name])).toEqual([
      [1, 'a'],
      [3, 'b'],
    ])
  })
})

describe('collectText: tool schemas', () => {
  const tools = {
    get_weather: z.object({ city: z.string(), days: z.number().int().default(1) }),
    send_email: z.object({ to: z.string().email(), body: z.string() }),
  }

  it('validates arguments and returns the schema output', async () => {
    const source = stream(start(0), delta(0, '{"city": "Paris"}'), done())
    const [call] = (await collectText(source, { provider: echo, tools })).toolCalls
    expect(call).toMatchObject({ ok: true, args: { city: 'Paris', days: 1 } })
  })

  it('reports a mismatch with the schema issues and the repaired arguments text', async () => {
    const source = stream(
      start(0, 'send_email'),
      delta(0, "{'to': 'nobody', 'body': 'hi'}"),
      done(),
    )
    const [call] = (await collectText(source, { provider: echo, tools })).toolCalls
    expect(call).toMatchObject({
      ok: false,
      error: 'schema_mismatch',
      argsText: "{'to': 'nobody', 'body': 'hi'}",
    })
    expect(
      call!.ok === false && call!.error === 'schema_mismatch' && call!.schemaIssues.length,
    ).toBe(1)
    expect(call!.issues.length).toBeGreaterThan(0)
  })

  it('reports a call to a tool that is not listed', async () => {
    const source = stream(start(0, 'rm_rf'), delta(0, '{}'), done())
    const [call] = (await collectText(source, { provider: echo, tools })).toolCalls
    expect(call).toEqual({
      index: 0,
      id: 'call_0',
      name: 'rm_rf',
      ok: false,
      error: 'unknown_tool',
      argsText: '{}',
      issues: [],
    })
  })

  it('awaits asynchronous schemas', async () => {
    const lookup: StandardSchemaV1<unknown, { city: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => {
          await Promise.resolve()
          const city = (value as { city?: unknown }).city
          return city === 'Paris' ? { value: { city } } : { issues: [{ message: 'unknown city' }] }
        },
      },
    }
    const source = stream(
      start(0),
      delta(0, '{"city": "Paris"}'),
      start(1),
      delta(1, '{"city": "Atlantis"}'),
      done(),
    )
    const { toolCalls } = await collectText(source, {
      provider: echo,
      tools: { get_weather: lookup },
    })
    expect(toolCalls).toMatchObject([
      { ok: true, args: { city: 'Paris' } },
      { ok: false, error: 'schema_mismatch', schemaIssues: [{ message: 'unknown city' }] },
    ])
  })

  it('types arguments by tool name', async () => {
    const { toolCalls } = await collectText(stream(done()), { provider: echo, tools })
    expect(toolCalls).toEqual([])
    const call = toolCalls[0]
    if (call?.ok && !call.custom && call.name === 'get_weather')
      expectTypeOf(call.args).toEqualTypeOf<{ city: string; days: number }>()
    if (call?.ok && !call.custom && call.name === 'send_email')
      expectTypeOf(call.args).toEqualTypeOf<{ to: string; body: string }>()
    if (call && !call.ok && call.error === 'schema_mismatch')
      expectTypeOf(call.schemaIssues).toEqualTypeOf<readonly StandardSchemaV1.Issue[]>()

    const untyped = (await collectText(stream(done()), { provider: echo })).toolCalls[0]
    if (untyped?.ok && !untyped.custom) expectTypeOf(untyped.args).toEqualTypeOf<unknown>()
    if (untyped?.ok && untyped.custom) expectTypeOf(untyped.input).toEqualTypeOf<string>()
  })
})
