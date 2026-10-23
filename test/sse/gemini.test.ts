import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { LlmEvent } from '../../src/sse/index'
import { gemini } from '../../src/sse/providers/gemini'
import { byteStream, collectEvents, expectInvariants, sseFixtures } from './fixtures'
import { splitAt } from './split'

const fixtures = sseFixtures('gemini')
const byName = new Map(fixtures.map((f) => [f.name, f.bytes]))
const names = fixtures.map((f) => f.name)

function run(name: string): Promise<LlmEvent[]> {
  const bytes = byName.get(name)
  if (!bytes) throw new Error(`No fixture ${name}`)
  return collectEvents(byteStream([bytes]), { provider: 'gemini' })
}

/** Feeds raw chunks to a fresh adapter. */
function map(...payloads: unknown[]): LlmEvent[] {
  const next = gemini.create()
  return payloads.flatMap((p) =>
    next({ event: 'message', data: typeof p === 'string' ? p : JSON.stringify(p) }),
  )
}

const chunk = (parts: unknown[], finishReason?: string): unknown => ({
  candidates: [
    { content: { parts, role: 'model' }, index: 0, ...(finishReason && { finishReason }) },
  ],
})

/** The latest usage snapshot. */
const lastUsage = (events: LlmEvent[]): LlmEvent | undefined =>
  events.reduce<LlmEvent | undefined>((last, e) => (e.type === 'usage' ? e : last), undefined)

const join = (events: LlmEvent[], type: 'text' | 'reasoning'): string =>
  events.map((e) => (e.type === type ? e.text : '')).join('')

describe('gemini adapter: fixtures', () => {
  it.each(names)('%s matches the snapshot', async (name) => {
    await expect(JSON.stringify(await run(name), null, 2) + '\n').toMatchFileSnapshot(
      `__snapshots__/gemini/${name}.json`,
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
        const events = await collectEvents(byteStream(splitAt(bytes, cuts)), { provider: 'gemini' })
        expect(events).toEqual(whole)
      }),
      { numRuns: 20 },
    )
  })

  it('streams text and attaches the closing signature to the text Block', async () => {
    const events = await run('text')
    expect(join(events, 'text')).toContain('море')
    expect(events.every((e) => !('index' in e) || e.index === 0)).toBe(true)
    expect(events.filter((e) => e.type === 'reasoning_signature')).toHaveLength(1)
    expect(lastUsage(events)).toEqual({ type: 'usage', inputTokens: 19, outputTokens: 31 })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end', rawStopReason: 'STOP' })
  })

  it('puts thought summaries in a reasoning Block before the text Block', async () => {
    const events = await run('thinking')
    expect(join(events, 'reasoning')).toMatch(/Pell/)
    expect(events.every((e) => e.type !== 'reasoning' || e.index === 0)).toBe(true)
    expect(events.every((e) => e.type !== 'text' || e.index === 1)).toBe(true)
    expect(events.find((e) => e.type === 'reasoning_signature')).toMatchObject({ index: 1 })
    // Output tokens include thoughts, as for the other Providers.
    expect(lastUsage(events)).toMatchObject({ outputTokens: 343 + 680, reasoningTokens: 680 })
  })

  it('emits whole function calls as start and one delta, each in its own Block', async () => {
    const events = await run('tool-calls-parallel')
    expect(events.filter((e) => e.type.startsWith('tool_call'))).toEqual([
      { type: 'tool_call_start', index: 0, id: 'call_170123', name: 'get_weather' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"city":"Paris"}' },
      { type: 'tool_call_start', index: 1, id: 'call_170129', name: 'get_weather' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{"city":"Tokyo"}' },
    ])
    expect(events.find((e) => e.type === 'reasoning_signature')).toMatchObject({ index: 0 })
    // Gemini says STOP; the answer called tools.
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use', rawStopReason: 'STOP' })
  })

  it('stops at MAX_TOKENS', async () => {
    expect((await run('max-tokens')).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      rawStopReason: 'MAX_TOKENS',
    })
  })

  it('reports cached tokens inside inputTokens', async () => {
    expect(lastUsage(await run('cache-read'))).toEqual({
      type: 'usage',
      inputTokens: 3019,
      outputTokens: 1,
      cacheReadTokens: 2041,
    })
  })

  it('ends a blocked prompt as refused with the block reason', async () => {
    expect((await run('prompt-blocked')).at(-1)).toEqual({
      type: 'done',
      stopReason: 'refused',
      rawStopReason: 'SAFETY',
    })
  })

  it('maps a SAFETY finish to refused', async () => {
    expect((await run('finish-safety')).at(-1)).toMatchObject({ stopReason: 'refused' })
  })

  it('turns a mid-stream error payload into error, then done', async () => {
    expect((await run('error-mid-stream')).slice(-2)).toMatchObject([
      { type: 'error', message: 'The model is overloaded. Please try again later.' },
      { type: 'done', stopReason: 'error' },
    ])
  })
})

describe('gemini adapter: mapping', () => {
  it.each([
    ['STOP', 'end'],
    ['MAX_TOKENS', 'max_tokens'],
    ['CONTINUATION', 'paused'],
    ['RECITATION', 'refused'],
    ['PUP_LIMITED_DISABLED', 'refused'],
    ['MALFORMED_FUNCTION_CALL', 'error'],
    ['MISSING_THOUGHT_SIGNATURE', 'error'],
    ['OTHER', 'unknown'],
    ['SOMETHING_NEW', 'unknown'],
  ])('maps the finish reason %s to %s', (raw, stopReason) => {
    expect(map(chunk([{ text: 'x' }], raw)).at(-1)).toEqual({
      type: 'done',
      stopReason,
      rawStopReason: raw,
    })
  })

  it('opens a new Block whenever the kind of part changes', () => {
    const events = map(
      chunk([
        { text: 'a', thought: true },
        { text: 'b', thought: true },
      ]),
      chunk([{ text: 'c' }]),
      chunk([{ text: 'd' }, { functionCall: { name: 'f', args: { x: 1 } } }]),
      chunk([{ text: 'e', thought: true }, { text: 'f' }], 'STOP'),
    )
    expect(
      events.filter((e) => e.type !== 'done').map((e) => ('index' in e ? e.index : -1)),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 4])
    expect(events.at(-1)).toMatchObject({ stopReason: 'tool_use' })
  })

  it('gives a signature-only empty text part to the current text Block, or opens one', () => {
    expect(map(chunk([{ text: 'hi' }]), chunk([{ text: '', thoughtSignature: 's' }]))).toEqual([
      { type: 'text', index: 0, text: 'hi' },
      { type: 'reasoning_signature', index: 0, signature: 's' },
    ])
    expect(
      map(chunk([{ text: 'hm', thought: true }]), chunk([{ text: '', thoughtSignature: 's' }])),
    ).toEqual([
      { type: 'reasoning', index: 0, text: 'hm' },
      { type: 'reasoning_signature', index: 1, signature: 's' },
    ])
  })

  it('skips empty text parts without a signature', () => {
    expect(map(chunk([{ text: '' }]), chunk([{ text: 'x' }]))).toEqual([
      { type: 'text', index: 0, text: 'x' },
    ])
  })

  it('fills a function call without id, name or args', () => {
    expect(map(chunk([{ functionCall: {} }]))).toEqual([
      { type: 'tool_call_start', index: 0, id: '', name: '' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{}' },
    ])
  })

  it('emits a chunk with unknown parts as other, keeping the known ones', () => {
    const events = map(chunk([{ text: 'x' }, { executableCode: { code: '1' } }]))
    expect(events.map((e) => e.type)).toEqual(['text', 'other'])
  })

  it('reads only the first candidate', () => {
    expect(
      map({
        candidates: [
          { content: { parts: [{ text: 'a' }] } },
          { content: { parts: [{ text: 'b' }] } },
        ],
      }),
    ).toEqual([{ type: 'text', index: 0, text: 'a' }])
  })

  it('reports usage counts only when present', () => {
    expect(map({ usageMetadata: {} })).toEqual([{ type: 'usage' }])
    expect(map({ usageMetadata: { thoughtsTokenCount: 4 } })).toEqual([
      { type: 'usage', outputTokens: 4, reasoningTokens: 4 },
    ])
  })

  it('emits unknown payloads as other', () => {
    expect(map('not json', '42', { modelVersion: 'x' }).map((e) => e.type)).toEqual([
      'other',
      'other',
      'other',
    ])
  })

  it('uses a placeholder message for an error without one', () => {
    expect(map({ error: {} })).toEqual([
      { type: 'error', message: 'Provider error', raw: { error: {} } },
    ])
  })

  it('keeps separate state per stream', () => {
    const a = gemini.create()
    const b = gemini.create()
    const data = JSON.stringify(chunk([{ text: 'x' }]))
    a({ event: 'message', data: JSON.stringify(chunk([{ functionCall: { name: 'f' } }])) })
    expect(a({ event: 'message', data })).toMatchObject([{ index: 1 }])
    expect(b({ event: 'message', data })).toMatchObject([{ index: 0 }])
  })
})
