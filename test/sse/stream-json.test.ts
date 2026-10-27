import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractJson } from '../../src/json/index'
import {
  LlmmendHttpError,
  type StreamJsonItem,
  type StreamJsonOptions,
  streamJson,
} from '../../src/sse/index'
import { partialByLocate, type PickOptions, pickOptions, replyPieces } from '../json/replies'
import { byteStream } from './fixtures'

const encoder = new TextEncoder()

type Payload = Record<string, unknown>

const text = (t: string, index = 0): Payload => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'text_delta', text: t },
})
const end = (stopReason = 'end_turn'): Payload[] => [
  { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } },
  { type: 'message_stop' },
]

/** An Anthropic stream of the given payloads. */
function stream(...payloads: Payload[]): ReadableStream<Uint8Array> {
  return byteStream([
    encoder.encode(payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('')),
  ])
}

/** An Anthropic stream that writes `pieces` as text and ends the turn. */
const reply = (...pieces: string[]): ReadableStream<Uint8Array> =>
  stream(...pieces.map((p) => text(p)), ...end())

async function collect<T>(
  source: ReadableStream<Uint8Array> | Response,
  options: Partial<StreamJsonOptions<T>> = {},
): Promise<StreamJsonItem<T>[]> {
  const items: StreamJsonItem<T>[] = []
  for await (const item of streamJson(source, { provider: 'anthropic', ...options }))
    items.push(item)
  return items
}

/** A Reply cut off by max_tokens. */
const cut = (): ReadableStream<Uint8Array> => stream(text('{"items": [1, 2'), ...end('max_tokens'))

const partials = (items: StreamJsonItem<unknown>[]): unknown[] =>
  items.filter((i) => !i.done).map((i) => i.partial)

function last<T>(items: StreamJsonItem<T>[]): Extract<StreamJsonItem<T>, { done: true }> {
  const item = items.at(-1)
  if (!item?.done) throw new Error('the last item is not final')
  return item
}

describe('streamJson', () => {
  it('yields growing Partial values, then the full Extraction', async () => {
    const items = await collect(
      reply('Sure:\n```json\n{"title": "Hel', 'lo", "count": 4', '2, "tags": ["a"', ']}\n```'),
    )
    expect(items.slice(0, -1)).toEqual([
      { done: false, partial: { title: 'Hel' }, complete: false },
      { done: false, partial: { title: 'Hello' }, complete: false },
      { done: false, partial: { title: 'Hello', count: 42, tags: ['a'] }, complete: false },
      { done: false, partial: { title: 'Hello', count: 42, tags: ['a'] }, complete: true },
    ])
    const final = last(items)
    expect(final).toMatchObject({
      done: true,
      partial: { title: 'Hello', count: 42, tags: ['a'] },
      complete: true,
      text: 'Sure:\n```json\n{"title": "Hello", "count": 42, "tags": ["a"]}\n```',
      stopReason: 'end',
      rawStopReason: 'end_turn',
      usage: { outputTokens: 7 },
      result: { ok: true, value: { title: 'Hello', count: 42, tags: ['a'] } },
    })
    expect(final).not.toHaveProperty('error')
  })

  it('yields nothing until a Candidate starts, and nothing for unchanged values', async () => {
    const items = await collect(reply('Let me think', '. Here: ', '{"n": 1', '2', '3', '}'))
    // An unfinished number is left out until a delimiter arrives.
    expect(partials(items)).toEqual([{}, { n: 123 }])
    expect(items.filter((i) => !i.done).map((i) => i.complete)).toEqual([false, true])
  })

  it('follows the Candidate pick would choose: the answer, not the format example', async () => {
    const items = await collect(reply('Format: {"x": 0}. ', 'Answer: {"x": ', '1, "y": [1'))
    expect(partials(items)).toEqual([{ x: 0 }, {}, { x: 1, y: [] }])
    expect(last(items).result).toMatchObject({ ok: true, value: { x: 1, y: [1] } })
  })

  it('keeps to the first Candidate with pick: first', async () => {
    const items = await collect(reply('Format: {"x": 0}. ', 'Answer: {"x": 1}'), { pick: 'first' })
    expect(partials(items)).toEqual([{ x: 0 }])
    expect(last(items).result).toMatchObject({ ok: true, value: { x: 0 } })
  })

  it('applies expect to the Partial value and the result', async () => {
    const items = await collect(reply('{"meta": 1} then [1, ', '2]'), { expect: 'array' })
    expect(partials(items)).toEqual([[1], [1, 2]])
    expect(last(items).result).toMatchObject({ ok: true, value: [1, 2] })
  })

  it('validates the final value without throwing', async () => {
    const schema = z.object({ age: z.number() })
    const mismatch = last(await collect(reply('{"age": "x"}'), { schema }))
    expect(mismatch.result).toMatchObject({
      ok: false,
      error: 'schema_mismatch',
      value: { age: 'x' },
      schemaIssues: [expect.objectContaining({ path: ['age'] })],
    })
    const valid = last(await collect(reply('{"age": 3}'), { schema }))
    expect(valid.result).toMatchObject({ ok: true, value: { age: 3 } })
  })

  it('supports schemas that validate asynchronously', async () => {
    const schema = z.object({ user: z.string() }).refine(async (v) => v.user !== 'admin')
    const final = last(await collect(reply('{"user": "admin"}'), { schema }))
    expect(final.result).toMatchObject({ ok: false, error: 'schema_mismatch' })
  })

  it('reports a cut-off value through stopReason and the repair option', async () => {
    const full = last(await collect(cut()))
    expect(full).toMatchObject({
      stopReason: 'max_tokens',
      complete: false,
      result: { ok: true, value: { items: [1, 2] } },
    })
    const syntax = last(await collect(cut(), { repair: 'syntax' }))
    expect(syntax.result).toMatchObject({ ok: false, error: 'truncated' })
  })

  it('ends with the Provider error in the final item', async () => {
    const items = await collect(
      stream(text('{"a": 1'), {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      }),
    )
    expect(last(items)).toMatchObject({
      stopReason: 'error',
      error: 'Overloaded',
      // The Partial value leaves the unfinished number out; the final Extraction repairs it.
      partial: {},
      result: { ok: true, value: { a: 1 } },
    })
  })

  it('ends with not_found when the Reply has no JSON', async () => {
    const items = await collect(reply('No JSON ', 'here.'))
    expect(items).toHaveLength(1)
    expect(last(items)).toMatchObject({
      partial: undefined,
      complete: false,
      text: 'No JSON here.',
      result: { ok: false, error: 'not_found' },
    })
  })

  it('reads only text: reasoning and tool calls are ignored', async () => {
    const items = await collect(
      stream(
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '{"no": 1}' },
        },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 't', name: 'f', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"no": 2}' },
        },
        text('{"yes": ', 2),
        text('true}', 2),
        ...end(),
      ),
    )
    expect(partials(items)).toEqual([{}, { yes: true }])
  })

  it('joins all text Blocks into one Reply', async () => {
    const items = await collect(stream(text('{"a": '), text('1}', 3), ...end()))
    expect(last(items)).toMatchObject({ text: '{"a": 1}', result: { ok: true, value: { a: 1 } } })
  })

  it('throws LlmmendHttpError on a non-2xx Response', async () => {
    await expect(collect(new Response('nope', { status: 500 }))).rejects.toBeInstanceOf(
      LlmmendHttpError,
    )
  })

  it('throws AbortError when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(collect(reply('{}'), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('ends like extractJson and never repeats a value, however the Reply is split', async () => {
    const replyText =
      'Here you go:\n```json\n{"name": "Ada", "skills": ["math", "code"], "age": 36, "x": {"y": null}}\n```\nDone.'
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(replyText.length), { maxLength: 15 }), async (cuts) => {
        const points = [...new Set([0, ...cuts, replyText.length])]
        points.sort((a, b) => a - b)
        const pieces = points.slice(1).map((p, i) => replyText.slice(points[i], p))
        const items = await collect(reply(...pieces))
        const final = last(items)
        expect(final.result).toEqual(extractJson(replyText))
        expect(final.partial).toEqual({
          name: 'Ada',
          skills: ['math', 'code'],
          age: 36,
          x: { y: null },
        })
        const keys = items
          .filter((i) => !i.done)
          .map((i) => `${i.complete} ${JSON.stringify(i.partial)}`)
        expect(new Set(keys).size).toBe(keys.length)
      }),
      { numRuns: 50 },
    )
  })
})

describe('streamJson, parsing incrementally', () => {
  /** What streamJson yielded before #73: the whole text parsed again after every piece. */
  function itemsByLocate(pieces: string[], opts: PickOptions) {
    const items: { done: false; partial: unknown; complete: boolean }[] = []
    let text = ''
    let shown: string | undefined
    for (const piece of pieces) {
      text += piece
      const current = partialByLocate(text, opts)
      if (!current) continue
      const key = `${current.complete} ${JSON.stringify(current.value)}`
      if (key === shown) continue
      shown = key
      items.push({ done: false, partial: current.value, complete: current.complete })
    }
    return items
  }

  it('yields what parsing the whole Reply again for every piece yielded', async () => {
    await fc.assert(
      fc.asyncProperty(replyPieces, pickOptions, async (pieces, opts) => {
        const items = await collect(reply(...pieces), opts)
        expect(items.slice(0, -1)).toEqual(itemsByLocate(pieces, opts))
        expect(last(items).text).toBe(pieces.join(''))
      }),
      { numRuns: 500 },
    )
  })

  it('shares the parts of the value that ended between Partial values', async () => {
    const items = await collect(reply('{"done": {"a": 1}, "list": [1', ', 2', ', 3'))
    const [first, second] = partials(items) as { done: unknown }[]
    expect(second!.done).toBe(first!.done)
  })
})
