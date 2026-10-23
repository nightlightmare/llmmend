import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parsePartialJson } from '../../src/json/index'

describe('parsePartialJson', () => {
  it.each([
    ['{"title": "Hel', { title: 'Hel' }],
    ['{"title": "Hello"', { title: 'Hello' }],
    ['{"n": 12', {}],
    ['{"n": 12,', { n: 12 }],
    ['{"n": 1.', {}],
    ['{"n": -', {}],
    ['{"ok": tru', {}],
    ['{"ok": true', {}],
    ['{"ok": true ', { ok: true }],
    ['{"a": [1, 2', { a: [1] }],
    ['{"a": [1, 2]', { a: [1, 2] }],
    ['{"a": "x", "b', { a: 'x' }],
    ['{"a": "x", "b":', { a: 'x' }],
    ['{"a": "line\\', { a: 'line' }],
    ['{"a": "caf\\u00', { a: 'caf' }],
    ['[', []],
    ['{', {}],
    ["{'a': True", {}],
    ["{'a': True,", { a: true }],
    ['{name: "Ada", tags: ["x"', { name: 'Ada', tags: ['x'] }],
  ])('reads %j as %j', (text, value) => {
    expect(parsePartialJson(text)).toEqual({ value, complete: false })
  })

  it('reports a finished value as complete', () => {
    expect(parsePartialJson('{"ok": true}')).toEqual({ value: { ok: true }, complete: true })
    expect(parsePartialJson('```json\n[1, 2]\n```\nDone')).toEqual({
      value: [1, 2],
      complete: true,
    })
  })

  it('skips a preamble and a code fence', () => {
    expect(parsePartialJson('Here\'s the data:\n```json\n{"title": "Hi')).toEqual({
      value: { title: 'Hi' },
      complete: false,
    })
  })

  it('reads the first object or array only', () => {
    expect(parsePartialJson('{"a": 1}\n{"b": 2')).toEqual({ value: { a: 1 }, complete: true })
  })

  it('skips prose brackets that cannot be JSON', () => {
    expect(parsePartialJson('Fill in {placeholders}: {"a": "x')).toEqual({
      value: { a: 'x' },
      complete: false,
    })
  })

  it('returns undefined until an object or array starts', () => {
    expect(parsePartialJson('')).toEqual({ value: undefined, complete: false })
    expect(parsePartialJson('Here is the "answer": 42')).toEqual({
      value: undefined,
      complete: false,
    })
  })

  it('never throws on pathological input', () => {
    expect(parsePartialJson('['.repeat(10_000))).toEqual({ value: undefined, complete: false })
  })
})

/** True if `next` could follow `prev`: nothing shown is removed or changed, strings only grow. */
function canFollow(prev: unknown, next: unknown): boolean {
  if (typeof prev === 'string') return typeof next === 'string' && next.startsWith(prev)
  if (Array.isArray(prev)) {
    return (
      Array.isArray(next) &&
      next.length >= prev.length &&
      prev.every((p, i) => canFollow(p, next[i]))
    )
  }
  if (prev !== null && typeof prev === 'object') {
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return false
    const n = next as Record<string, unknown>
    return Object.entries(prev).every(([k, v]) => Object.hasOwn(n, k) && canFollow(v, n[k]))
  }
  return Object.is(prev, next)
}

describe('parsePartialJson: properties', () => {
  // Small values: every prefix is parsed from scratch, so the test is quadratic in their size.
  const small = fc.jsonValue({ maxDepth: 3 })
  const container = fc.oneof(
    fc.array(small, { maxLength: 6 }),
    fc.dictionary(fc.string(), small, { maxKeys: 6 }),
  )
  const wrapper = fc.constantFrom('', 'Here is the result:\n```json\n', 'Output: ')

  it('reads every prefix monotonically, and is complete only at the end', () => {
    fc.assert(
      fc.property(container, wrapper, fc.boolean(), (value, before, indent) => {
        const json = JSON.stringify(value, null, indent ? 2 : undefined)
        const reply = before + json
        let prev: unknown
        for (let length = before.length; length <= reply.length; length++) {
          const { value: current, complete } = parsePartialJson(reply.slice(0, length))
          expect(complete).toBe(length === reply.length)
          expect(prev === undefined || canFollow(prev, current)).toBe(true)
          prev = current
        }
        expect(prev).toEqual(JSON.parse(json))
      }),
      { numRuns: 200 },
    )
  })

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(() => parsePartialJson(text)).not.toThrow()
      }),
      { numRuns: 1000 },
    )
  })
})
