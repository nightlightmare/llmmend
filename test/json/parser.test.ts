import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_DEPTH, parseJson, parseValueAt } from '../../src/json/parser'

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

/** What JSON.parse makes of `text`, in the shape of a parse result without positions. */
function native(text: string): Outcome {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, error: 'unparseable' }
  }
}

function strict(text: string): Outcome {
  const result = parseJson(text)
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }
}

function expectSameAsNative(text: string): void {
  expect(strict(text)).toEqual(native(text))
}

const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth)

// Valid JSON text with one random character inserted, deleted or replaced.
const nearlyJson = fc
  .tuple(
    fc.json(),
    fc.nat(),
    fc.constantFrom('insert', 'delete', 'replace'),
    fc.string({ minLength: 1, maxLength: 1, unit: 'binary' }),
  )
  .map(([text, n, op, ch]) => {
    const i = n % (text.length + 1)
    if (op === 'insert') return text.slice(0, i) + ch + text.slice(i)
    if (op === 'delete') return text.slice(0, i) + text.slice(i + 1)
    return text.slice(0, i) + ch + text.slice(i + 1)
  })

describe('parseJson (strict)', () => {
  it('round-trips any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.constantFrom(undefined, 2), (v, indent) => {
        const text = JSON.stringify(v, null, indent)
        const result = parseJson(text)
        expect(result).toMatchObject({ ok: true, end: text.length })
        expect(result.ok && result.value).toEqual(JSON.parse(text))
      }),
    )
  })

  it('agrees with JSON.parse on arbitrary and nearly-valid text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), nearlyJson), expectSameAsNative),
      { numRuns: 2000 },
    )
  })

  it.each([
    '',
    ' ',
    '{',
    '[1,]',
    '{"a":1,}',
    '{,}',
    '[,1]',
    '{"a" 1}',
    '{a:1}',
    "{'a':1}",
    '[1 2]',
    '{"a":1 "b":2}',
    'tru',
    'nul',
    'True',
    'NaN',
    '01',
    '+1',
    '"a',
    '1 2',
    '﻿1',
    '// c\n1',
  ])('rejects %j like JSON.parse', expectSameAsNative)

  it('reports where parsing stopped', () => {
    expect(parseJson('[1, x]')).toEqual({ ok: false, error: 'unparseable', at: 4 })
    expect(parseJson('{"a":1;')).toEqual({ ok: false, error: 'unparseable', at: 6 })
    expect(parseJson('[1] x')).toEqual({ ok: false, error: 'unparseable', at: 4 })
  })

  it('keeps __proto__ as an own property instead of setting the prototype', () => {
    const result = parseJson('{"__proto__": {"polluted": true}}')
    expect(result.ok).toBe(true)
    const value = (result.ok ? result.value : undefined) as object
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.keys(value)).toEqual(['__proto__'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('lets the last duplicate key win, like JSON.parse', () => {
    expect(strict('{"a":1,"a":2}')).toEqual({ ok: true, value: { a: 2 } })
  })
})

describe('parseValueAt', () => {
  it('parses one value at an offset and reports where it ends', () => {
    const text = 'Here: {"a": [1, 2]} and more'
    expect(parseValueAt(text, 6)).toEqual({ ok: true, value: { a: [1, 2] }, end: 19 })
  })

  it('accepts top-level scalars', () => {
    expect(parseValueAt('  42,', 0)).toEqual({ ok: true, value: 42, end: 4 })
  })
})

describe('depth limit', () => {
  it('accepts nesting up to the limit', () => {
    expect(parseJson(nested(DEFAULT_MAX_DEPTH)).ok).toBe(true)
  })

  it('fails with max_depth one level deeper', () => {
    expect(parseJson(nested(DEFAULT_MAX_DEPTH + 1))).toEqual({
      ok: false,
      error: 'max_depth',
      at: DEFAULT_MAX_DEPTH,
    })
  })

  it('handles 10 000 levels of arrays and objects without a stack overflow', () => {
    expect(parseJson(nested(10_000))).toMatchObject({ ok: false, error: 'max_depth' })
    expect(parseJson('{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000))).toMatchObject({
      ok: false,
      error: 'max_depth',
    })
  })

  it('honours a custom limit', () => {
    expect(parseJson('[[1]]', { maxDepth: 1 })).toMatchObject({ ok: false, error: 'max_depth' })
    expect(parseJson('[1]', { maxDepth: 1 }).ok).toBe(true)
  })
})

describe('fuzzing', () => {
  it('never throws on random input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 2000 }), (text) => {
        expect(() => parseJson(text)).not.toThrow()
      }),
      { numRuns: 1000 },
    )
  })

  const size = 100_000
  const inputs: Record<string, string> = {
    'deep nesting': '['.repeat(size),
    'unterminated string': '"' + 'a'.repeat(size),
    'many escapes': '"' + '\\n'.repeat(size / 2) + '"',
    'long number': '1'.repeat(size),
    'repeated keys': '{' + '"k":1,'.repeat(size / 6) + '"k":1}',
    'wide array': '[' + '0,'.repeat(size / 2 - 1) + '0]',
    'random bytes': Array.from({ length: size }, (_, i) =>
      String.fromCharCode((i * 2654435761) % 256),
    ).join(''),
  }

  it.each(Object.entries(inputs))('parses 100 kB of %s within 50 ms', (_, text) => {
    parseJson(text) // warm up the JIT
    const start = performance.now()
    parseJson(text)
    expect(performance.now() - start).toBeLessThan(50)
  })
})
