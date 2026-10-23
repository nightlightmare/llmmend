import { readdirSync, readFileSync } from 'node:fs'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LlmmendJsonError, repairJson } from '../../src/json/index'

const fixtures = new URL('../fixtures/llm-replies/', import.meta.url)

type Expected = { value: unknown; issues: string[] } | { error: string }

const corpus = readdirSync(fixtures)
  .filter((f) => f.startsWith('repair-') && f.endsWith('.txt'))
  .map((f) => {
    const name = f.slice(0, -'.txt'.length)
    const text = readFileSync(new URL(f, fixtures), 'utf8')
    const expected = JSON.parse(
      readFileSync(new URL(`${name}.expected.json`, fixtures), 'utf8'),
    ) as Expected
    return { name, text, expected }
  })

/** Outcome of repairJson in the shape of an expected.json file. */
function outcome(text: string): Expected {
  try {
    const { json, issues } = repairJson(text)
    return { value: JSON.parse(json), issues: issues.map((i) => i.code) }
  } catch (error) {
    if (error instanceof LlmmendJsonError) return { error: error.code }
    throw error
  }
}

describe('repairJson: fixture corpus', () => {
  it('has a case for every Repair Issue code', () => {
    const codes = new Set(corpus.flatMap((c) => ('issues' in c.expected ? c.expected.issues : [])))
    // Every Issue code except stripped_wrapper, which is Extraction, not Repair.
    expect(codes).toEqual(
      new Set([
        'comment_removed',
        'non_finite_number',
        'python_literal',
        'single_quotes',
        'trailing_comma',
        'truncated_closed',
        'unescaped_control_char',
        'unquoted_key',
      ]),
    )
  })

  it.each(corpus.map((c) => [c.name, c]))('%s', (_, { text, expected }) => {
    expect(outcome(text)).toEqual(expected)
  })
})

// Valid JSON text with one random character inserted, deleted or replaced.
const nearlyJson = fc
  .tuple(fc.json(), fc.nat(), fc.string({ minLength: 1, maxLength: 1, unit: 'binary' }))
  .map(([text, n, ch]) => {
    const i = n % (text.length + 1)
    return n % 2 ? text.slice(0, i) + ch + text.slice(i) : text.slice(0, i) + text.slice(i + 1)
  })

describe('repairJson: properties', () => {
  it('leaves valid JSON alone', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const text = JSON.stringify(v, null, 2)
        const { json, issues } = repairJson(text)
        expect(issues).toEqual([])
        expect(JSON.parse(json)).toEqual(JSON.parse(text))
      }),
    )
  })

  it('always returns valid JSON when it succeeds', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), nearlyJson), (text) => {
        // 'refused' (an LlmmendJsonError) is fine; 'broken' means invalid JSON came back.
        const kind = ((): string => {
          try {
            JSON.parse(repairJson(text).json)
            return 'valid'
          } catch (error) {
            return error instanceof LlmmendJsonError ? 'refused' : 'broken'
          }
        })()
        expect(kind).not.toBe('broken')
      }),
      { numRuns: 2000 },
    )
  })

  const docs = {
    strict:
      '{"s": "a\\"b\\u00e9", "n": -12.5e+3, "t": true, "f": false, "z": null, "a": [1, {"k": [ ]}], "u": "🌊"}',
    lenient: "{'a': True, b: [1, 2,], /* c */ \"d\": NaN, // e\n 'f': None}",
  }

  it.each(Object.entries(docs))('repairs the %s document cut off at every position', (_, doc) => {
    const complete = repairJson(doc)
    for (let length = 1; length < doc.length; length++) {
      const { json, issues } = repairJson(doc.slice(0, length))
      expect(() => JSON.parse(json)).not.toThrow()
      expect(issues.at(-1)?.code).toBe('truncated_closed')
      expect(issues.slice(0, -1)).toEqual(
        complete.issues.filter((i) => 'at' in i && i.at < length).slice(0, issues.length - 1),
      )
    }
    expect(complete.issues.map((i) => i.code)).not.toContain('truncated_closed')
  })

  it('throws LlmmendJsonError with the issues found so far', () => {
    expect(() => repairJson("{'a': 1} x")).toThrow(
      expect.objectContaining({
        name: 'LlmmendJsonError',
        code: 'unparseable',
        issues: [{ code: 'single_quotes', at: 1 }],
      }),
    )
  })

  it('reports where each Issue is', () => {
    expect(repairJson("{a: 'x', 'b': [1,],} // end").issues).toEqual([
      { code: 'unquoted_key', at: 1 },
      { code: 'single_quotes', at: 4 },
      { code: 'single_quotes', at: 9 },
      { code: 'trailing_comma', at: 16 },
      { code: 'trailing_comma', at: 18 },
      { code: 'comment_removed', at: 21 },
    ])
    expect(repairJson('{"a": ["x').issues).toEqual([{ code: 'truncated_closed', closed: '"]}' }])
  })
})
