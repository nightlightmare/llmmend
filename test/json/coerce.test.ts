import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  extractAllJson,
  extractJson,
  extractJsonAsync,
  type Issue,
  type StandardSchemaV1,
} from '../../src/json/index'
import { collectText, streamJson } from '../../src/sse/index'

/** The same shape in each library. */
const schemas: [string, StandardSchemaV1][] = [
  [
    'zod',
    z.object({
      count: z.number(),
      active: z.boolean(),
      label: z.string(),
      note: z.null(),
      tags: z.array(z.number()),
      nested: z.object({ id: z.string() }),
    }),
  ],
  [
    'valibot',
    v.object({
      count: v.number(),
      active: v.boolean(),
      label: v.string(),
      note: v.null(),
      tags: v.array(v.number()),
      nested: v.object({ id: v.string() }),
    }),
  ],
  [
    'arktype',
    type({
      count: 'number',
      active: 'boolean',
      label: 'string',
      note: 'null',
      tags: 'number[]',
      nested: { id: 'string' },
    }),
  ],
]

const slipped =
  '{"count": "42", "active": "true", "label": 7, "note": "null", "tags": ["1", 2], "nested": {"id": 5}}'
const meant = { count: 42, active: true, label: '7', note: null, tags: [1, 2], nested: { id: '5' } }

/** The `coerced` Issues, in path order: libraries report issues in different orders. */
const coerced = (issues: Issue[]) =>
  issues
    .filter((i) => i.code === 'coerced')
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

describe.each(schemas)('coerce with %s', (_, schema) => {
  it('fixes the type slips at the paths the schema names, and records each one', () => {
    const result = extractJson(slipped, { schema, coerce: true })
    expect(result).toMatchObject({ ok: true, value: meant, repaired: true })
    expect(coerced(result.issues)).toEqual([
      { code: 'coerced', path: ['active'], from: 'string', to: 'boolean' },
      { code: 'coerced', path: ['count'], from: 'string', to: 'number' },
      { code: 'coerced', path: ['label'], from: 'number', to: 'string' },
      { code: 'coerced', path: ['nested', 'id'], from: 'number', to: 'string' },
      { code: 'coerced', path: ['note'], from: 'string', to: 'null' },
      { code: 'coerced', path: ['tags', 0], from: 'string', to: 'number' },
    ])
  })

  it('is off by default', () => {
    expect(extractJson(slipped, { schema })).toMatchObject({ ok: false, error: 'schema_mismatch' })
  })

  it('keeps what it fixed and reports what it could not', () => {
    const result = extractJson(
      '{"count": "many", "active": "true", "label": "x", "note": null, "tags": [], "nested": {"id": "a"}}',
      {
        schema,
        coerce: true,
      },
    )
    expect(result).toMatchObject({
      ok: false,
      error: 'schema_mismatch',
      value: { count: 'many', active: true },
    })
    if (result.ok || result.error !== 'schema_mismatch') return
    expect(result.schemaIssues).toHaveLength(1)
    expect(coerced(result.issues)).toEqual([
      { code: 'coerced', path: ['active'], from: 'string', to: 'boolean' },
    ])
  })

  it('works with extractJsonAsync and extractAllJson', async () => {
    expect(await extractJsonAsync(slipped, { schema, coerce: true })).toMatchObject({
      ok: true,
      value: meant,
    })
    expect(extractAllJson(`${slipped} and ${slipped}`, { schema, coerce: true })).toEqual([
      meant,
      meant,
    ])
  })
})

describe('coerce', () => {
  it('leaves strings that are not numbers, booleans or null alone', () => {
    const schema = z.object({ n: z.number() })
    for (const text of ['" 42"', '"042"', '"1,5"', '"True"', '"NaN"']) {
      expect(extractJson(`{"n": ${text}}`, { schema, coerce: true })).toMatchObject({
        ok: false,
        issues: [],
      })
    }
  })

  it('keeps a change only when the issue at its path goes away', () => {
    const schema = z.object({ n: z.number().min(10) })
    // 3 is still too small: the string stays, and nothing is recorded.
    expect(extractJson('{"n": "3"}', { schema, coerce: true })).toMatchObject({
      ok: false,
      value: { n: '3' },
      issues: [],
    })
  })

  it('makes at most 32 changes', () => {
    const keys = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const schema = z.object(Object.fromEntries(keys.map((k) => [k, z.number()])))
    const text = JSON.stringify(Object.fromEntries(keys.map((k) => [k, '1'])))
    const result = extractJson(text, { schema, coerce: true })
    expect(result).toMatchObject({ ok: false, error: 'schema_mismatch' })
    expect(result.issues.filter((i) => i.code === 'coerced')).toHaveLength(32)
  })

  it('validates asynchronously when the schema does', async () => {
    const schema = z.object({ n: z.number() }).refine(async (o) => o.n > 0)
    expect(await extractJsonAsync('{"n": "3"}', { schema, coerce: true })).toMatchObject({
      ok: true,
      value: { n: 3 },
    })
  })

  it('applies to the final result of streamJson', async () => {
    const reply = new Response(
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"n": "3"}' } })}\n\n`,
    )
    let last: unknown
    for await (const item of streamJson(reply, {
      provider: 'anthropic',
      schema: z.object({ n: z.number() }),
      coerce: true,
    }))
      last = item
    expect(last).toMatchObject({ done: true, result: { ok: true, value: { n: 3 } } })
  })

  it('applies to tool arguments in collectText', async () => {
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'repeat' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"times": "3"}' },
      },
      { type: 'message_stop' },
    ]
    const body = () => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))
    const tools = { repeat: z.object({ times: z.number() }) }
    const off = await collectText(body(), { provider: 'anthropic', tools })
    expect(off.toolCalls[0]).toMatchObject({ ok: false, error: 'schema_mismatch' })
    const on = await collectText(body(), { provider: 'anthropic', tools, coerce: true })
    expect(on.toolCalls[0]).toMatchObject({
      ok: true,
      args: { times: 3 },
      issues: [{ code: 'coerced', path: ['times'], from: 'string', to: 'number' }],
    })
  })
})
