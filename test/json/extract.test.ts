import { type } from 'arktype'
import * as fc from 'fast-check'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  extractAllJson,
  extractJson,
  extractJsonAsync,
  extractJsonOrThrow,
  type ExtractOptions,
  LlmmendError,
  LlmmendJsonError,
} from '../../src/json/index'
import { fixtureDir } from '../fixtures'

const fixtures = fixtureDir('llm-replies')

type Expected = ({ value: unknown; issues: string[] } | { error: string }) & {
  options?: ExtractOptions<unknown>
}

const corpus = [...fixtures.keys()]
  // extract-* are written for Extraction; real-* are recorded model Replies.
  .filter((f) => (f.startsWith('extract-') || f.startsWith('real-')) && f.endsWith('.txt'))
  .map((f) => {
    const name = f.slice(0, -'.txt'.length)
    const text = fixtures.get(f) ?? ''
    const expected = JSON.parse(fixtures.get(`${name}.expected.json`) ?? '') as Expected
    return { name, text, expected }
  })

/** extractJson's result in the shape of an expected.json file (without options). */
function outcome(text: string, options: ExtractOptions<unknown> = {}): Expected {
  const result = extractJson(text, options)
  return result.ok
    ? { value: result.value, issues: result.issues.map((i) => i.code) }
    : { error: result.error }
}

describe('extractJson: fixture corpus', () => {
  it('has at least 150 Replies including the repair corpus', () => {
    expect([...fixtures.keys()].filter((f) => f.endsWith('.txt')).length).toBeGreaterThanOrEqual(
      150,
    )
  })

  it.each(corpus.map((c) => [c.name, c]))('%s', (_, { text, expected }) => {
    const { options, ...rest } = expected
    expect(outcome(text, options)).toEqual(rest)
  })
})

describe('extractJson: Extraction', () => {
  it('does not count a stripped wrapper as Repair', () => {
    const result = extractJson('Here:\n```json\n{"a": [1, 2]}\n```\nDone.')
    expect(result).toEqual({
      ok: true,
      value: { a: [1, 2] },
      repaired: false,
      issues: [{ code: 'stripped_wrapper', detail: 'code fence, text before, text after' }],
      raw: '{"a": [1, 2]}',
    })
  })

  it('reports Repair, with positions in the whole Reply', () => {
    const result = extractJson("Data: {'a': 1}")
    expect(result).toMatchObject({
      ok: true,
      repaired: true,
      raw: "{'a': 1}",
      issues: [
        { code: 'stripped_wrapper', detail: 'text before' },
        { code: 'single_quotes', at: 7 },
      ],
    })
  })

  it.each([
    ['{"a": 1}', undefined],
    ['```json\n{"a": 1}\n```', 'code fence'],
    ['```\n{"a": 1}', 'code fence'],
    ['{"a": 1}\n```', 'code fence'],
    ['Note: {"a": 1}', 'text before'],
    ['{"a": 1} Done', 'text after'],
    ['Use ```code``` like this: {"a": 1}', 'text before'],
  ])('describes the wrapper of %j', (text, detail) => {
    const result = extractJson(text)
    expect(result.ok && result.issues.find((i) => i.code === 'stripped_wrapper')).toEqual(
      detail ? { code: 'stripped_wrapper', detail } : undefined,
    )
  })

  const noBrackets = fc.string({ unit: 'grapheme' }).map((s) => s.replace(/[[\]{}]/g, ''))
  const container = fc.oneof(fc.array(fc.jsonValue()), fc.dictionary(fc.string(), fc.jsonValue()))

  it('finds any object or array in any wrapper', () => {
    fc.assert(
      fc.property(
        noBrackets,
        fc.boolean(),
        container,
        noBrackets,
        (before, fence, value, after) => {
          const json = JSON.stringify(value, null, 1)
          const reply = fence
            ? `${before}\n\`\`\`json\n${json}\n\`\`\`\n${after}`
            : `${before}${json}${after}`
          const result = extractJson(reply)
          expect(result.ok && result.value).toEqual(JSON.parse(json))
          expect(result.ok && result.repaired).toBe(false)
        },
      ),
    )
  })

  it('never throws on random input', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.constantFrom('full', 'syntax', 'none'),
        (text, repair) => {
          expect(() => extractJson(text, { repair })).not.toThrow()
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('skips runs of brackets that cannot start JSON', () => {
    expect(extractJson('[[[{{ broken, then [[1], [2]]')).toMatchObject({
      ok: true,
      value: [[1], [2]],
    })
  })

  it('still finds JSON after thousands of failing starts', () => {
    const reply = '[link](https://example.com) '.repeat(4000) + '{"found": true}'
    expect(extractJson(reply)).toMatchObject({
      ok: true,
      value: { found: true },
    })
  })
})

describe('extractJson: schemas', () => {
  const reply = "```json\n{name: 'Ada', age: '36', tags: ['x',]}\n```"

  const schemas = {
    zod: z.object({ name: z.string(), age: z.coerce.number(), tags: z.array(z.string()) }),
    valibot: v.object({
      name: v.string(),
      age: v.pipe(v.string(), v.transform(Number)),
      tags: v.array(v.string()),
    }),
    arktype: type({ name: 'string', age: 'string.numeric.parse', tags: 'string[]' }),
  }

  it.each(Object.entries(schemas))('returns the %s output, typed', (_, schema) => {
    const result = extractJson(reply, { schema })
    expect(result).toMatchObject({ ok: true, value: { name: 'Ada', age: 36, tags: ['x'] } })
    // Type-level check: the value has the schema's output type (age is a number, not a string).
    const age: number | undefined = result.ok ? result.value.age : undefined
    expect(age).toBe(36)
  })

  const strictSchemas = {
    zod: z.object({ age: z.number() }),
    valibot: v.object({ age: v.number() }),
    arktype: type({ age: 'number' }),
  }

  it.each(Object.entries(strictSchemas))(
    'reports a %s mismatch with the parsed value',
    (_, schema) => {
      const result = extractJson(reply, { schema })
      expect(result).toMatchObject({
        ok: false,
        error: 'schema_mismatch',
        value: { name: 'Ada', age: '36', tags: ['x'] },
      })
      expect(
        !result.ok && result.error === 'schema_mismatch' && result.schemaIssues.length,
      ).toBeGreaterThan(0)
    },
  )

  const asyncSchemas = {
    zod: z.object({ name: z.string().refine(async (s) => s.length > 0) }),
    valibot: v.objectAsync({
      name: v.pipeAsync(
        v.string(),
        v.checkAsync(async (s) => s.length > 0),
      ),
    }),
  }

  it.each(Object.entries(asyncSchemas))(
    'rejects an async %s schema in the sync API',
    (_, schema) => {
      expect(() => extractJson(reply, { schema })).toThrow(
        expect.objectContaining({ name: 'LlmmendError', code: 'async_schema' }),
      )
    },
  )

  it.each(Object.entries(asyncSchemas))(
    'validates an async %s schema in extractJsonAsync',
    async (_, schema) => {
      await expect(extractJsonAsync(reply, { schema })).resolves.toMatchObject({
        ok: true,
        value: { name: 'Ada' },
      })
    },
  )

  it('works without a schema in extractJsonAsync', async () => {
    await expect(extractJsonAsync('{"a": 1}')).resolves.toMatchObject({ ok: true, value: { a: 1 } })
    await expect(extractJsonAsync('nothing')).resolves.toMatchObject({
      ok: false,
      error: 'not_found',
    })
  })
})

describe('extractJsonOrThrow', () => {
  it('returns the value', () => {
    expect(extractJsonOrThrow('Result: [1, 2]')).toEqual([1, 2])
  })

  it('throws LlmmendJsonError with the code', () => {
    expect(() => extractJsonOrThrow('nothing here')).toThrow(
      expect.objectContaining({ name: 'LlmmendJsonError', code: 'not_found', issues: [] }),
    )
  })

  it('carries the schema issues on a mismatch', () => {
    let error: unknown
    try {
      extractJsonOrThrow('{"age": "x"}', { schema: z.object({ age: z.number() }) })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(LlmmendJsonError)
    expect((error as LlmmendJsonError).code).toBe('schema_mismatch')
    expect((error as LlmmendJsonError).schemaIssues?.[0]?.path).toEqual(['age'])
  })
})

describe('extractAllJson', () => {
  const reply = 'A: {"id": 1} B: [2] C: {"id": "three"}'

  it('returns every Candidate in order', () => {
    expect(extractAllJson(reply)).toEqual([{ id: 1 }, [2], { id: 'three' }])
  })

  it('filters by expect', () => {
    expect(extractAllJson(reply, { expect: 'array' })).toEqual([[2]])
  })

  it('keeps only values that pass the schema, as the schema outputs them', () => {
    expect(extractAllJson(reply, { schema: z.object({ id: z.number() }) })).toEqual([{ id: 1 }])
  })

  it('rejects an async schema', () => {
    expect(() => extractAllJson(reply, { schema: asyncZod() })).toThrow(LlmmendError)
  })
})

function asyncZod(): z.ZodType {
  return z.object({ id: z.number().refine(async () => true) })
}
