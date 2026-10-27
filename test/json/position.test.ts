import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractJson, extractJsonOrThrow, LlmmendJsonError, repairJson } from '../../src/json/index'
import { lineAndColumn, snippet } from '../../src/json/position'

/** The error `run` throws. */
function thrown(run: () => unknown): LlmmendJsonError {
  try {
    run()
  } catch (error) {
    if (error instanceof LlmmendJsonError) return error
    throw error
  }
  throw new Error('nothing was thrown')
}

describe('lineAndColumn', () => {
  it.each([
    ['abc', 0, 1, 1],
    ['abc', 3, 1, 4],
    ['a\nbc', 3, 2, 2],
    ['a\r\nbc', 4, 2, 2],
    ['a\rbc', 3, 2, 2],
    ['a\r\n', 2, 1, 3], // between \r and \n: still the first line
    ['😀😀x', 4, 1, 3], // an emoji is one character
  ])('finds %j at %i on line %i, column %i', (text, at, line, column) => {
    expect(lineAndColumn(text, at)).toEqual({ line, column })
  })
})

/** Characters that move the ^: astral ones, newlines of every kind, tabs. */
const char = fc.constantFrom('a', 'é', '😀', '\n', '\r', '\r\n', '\t', '{')

describe('snippet', () => {
  it('shows the start of the text', () => {
    expect(snippet('x = 1', 0)).toBe('x = 1\n^')
  })

  it('shows about 20 characters on each side, with … where it cuts', () => {
    const text = 'a'.repeat(30) + 'X' + 'b'.repeat(30)
    expect(snippet(text, 30)).toBe(`…${'a'.repeat(20)}X${'b'.repeat(19)}…\n${' '.repeat(21)}^`)
  })

  it('puts the ^ after the last character at the end of the text', () => {
    expect(snippet('{"a": [1, 2', 11)).toBe('{"a": [1, 2\n           ^')
  })

  it('keeps one line: newlines show as ⏎, tabs as spaces', () => {
    expect(snippet('{\r\n\t"a": 1\n\t"b"\r}', 13)).toBe(`{⏎ "a": 1⏎ "b"⏎}\n${' '.repeat(12)}^`)
  })

  it('never cuts an astral character in half', () => {
    const text = '😀'.repeat(60)
    const [line, caret] = snippet(text, 60).split('\n')
    expect(line).toBe(`…${'😀'.repeat(40)}…`)
    expect(caret).toBe(`${' '.repeat(21)}^`)
  })

  it('always has the ^ under the position', () => {
    fc.assert(
      fc.property(fc.array(char, { maxLength: 80 }), fc.nat(), (chars, n) => {
        const text = chars.join('')
        // A position at a character boundary, as parsing reports.
        const at = chars.slice(0, n % (chars.length + 1)).join('').length
        const [line, caret] = snippet(text, at).split('\n')
        const point = text.codePointAt(at)
        const expected = point === undefined ? undefined : String.fromCodePoint(point)
        // The character above the ^ is the one at `at`, as shown; past the end there is none.
        expect(Array.from(line!)[caret!.length - 1]).toBe(
          expected === '\n' || expected === '\r' ? '⏎' : expected === '\t' ? ' ' : expected,
        )
      }),
    )
  })
})

describe('positions in JSON errors', () => {
  it('reports where extractJson failed', () => {
    expect(extractJson('{"a": 1 x}')).toEqual({
      ok: false,
      error: 'unparseable',
      issues: [],
      at: 8,
    })
    expect(extractJson('{"a": [1, 2', { repair: 'syntax' })).toMatchObject({
      error: 'truncated',
      at: 11,
    })
    expect(extractJson('no JSON')).not.toHaveProperty('at')
  })

  it('gives LlmmendJsonError a position, and a message that shows it', () => {
    const error = thrown(() => extractJsonOrThrow('Sure!\n\n{\n  "a": 1,\n  "b": x\n}'))
    expect(error).toMatchObject({ code: 'unparseable', at: 26, line: 5, column: 8 })
    expect(error.message).toBe(
      'Cannot extract JSON: unparseable at line 5, column 8\n…⏎{⏎  "a": 1,⏎  "b": x⏎}\n                     ^',
    )
  })

  it('gives repairJson errors a position too', () => {
    const error = thrown(() => repairJson('{"emoji": "😀😀", 😀}'))
    expect(error).toMatchObject({ code: 'unparseable', at: 20, line: 1, column: 18 })
    expect(error.message.split('\n')[0]).toBe(
      'Cannot repair JSON: unparseable at line 1, column 18',
    )
  })

  it('leaves the position out where there is none', () => {
    const error = thrown(() => extractJsonOrThrow('no JSON here'))
    expect(error.message).toBe('Cannot extract JSON: not_found')
    expect(error).not.toHaveProperty('at')
    expect(error).not.toHaveProperty('line')
    expect(error).not.toHaveProperty('column')
  })
})
