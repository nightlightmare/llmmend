import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { estimateTokens, truncateToTokens } from '../../src/chunk/index'

const chars = (text: string): number => [...text].length

describe('truncateToTokens', () => {
  it('returns a text that fits unchanged', () => {
    expect(truncateToTokens('short', 10)).toBe('short')
  })

  it('cuts the end, the start or the middle', () => {
    const text = 'abcdefghij'
    expect(truncateToTokens(text, 4, { countTokens: chars })).toBe('abcd')
    expect(truncateToTokens(text, 4, { countTokens: chars, from: 'start' })).toBe('ghij')
    expect(truncateToTokens(text, 5, { countTokens: chars, from: 'middle', ellipsis: '…' })).toBe(
      'ab…ij',
    )
  })

  it('counts with the tokenizer it is given, unless countTokens is', () => {
    const text = 'Claude splits text into more tokens than o200k_base does. '.repeat(10)
    expect(estimateTokens(text, { tokenizer: 'claude' })).toBeGreaterThan(estimateTokens(text))
    for (const tokenizer of ['o200k', 'claude', 'gemini'] as const) {
      const cut = truncateToTokens(text, 50, { tokenizer })
      expect(estimateTokens(cut, { tokenizer })).toBeLessThanOrEqual(50)
      expect(
        estimateTokens(cut + text.slice(cut.length, cut.length + 8), { tokenizer }),
      ).toBeGreaterThan(50)
    }
    expect(truncateToTokens(text, 4, { tokenizer: 'claude', countTokens: chars })).toBe('Clau')
  })

  it('counts the ellipsis against the budget', () => {
    expect(truncateToTokens('abcdefghij', 4, { countTokens: chars, ellipsis: '...' })).toBe('a...')
  })

  it('returns an empty string when not even the ellipsis fits', () => {
    expect(truncateToTokens('abcdef', 2, { countTokens: chars, ellipsis: '...' })).toBe('')
  })

  it('never splits a grapheme cluster', () => {
    expect(
      truncateToTokens('👨‍👩‍👧👨‍👩‍👧', 1, {
        countTokens: (t) => [...new Intl.Segmenter().segment(t)].length,
      }),
    ).toBe('👨‍👩‍👧')
  })

  it('always fits and keeps the longest prefix with estimated tokens', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 200 }),
        fc.integer({ min: 0, max: 30 }),
        (text, max) => {
          const cut = truncateToTokens(text, max)
          expect(text.startsWith(cut)).toBe(true)
          expect(estimateTokens(cut) <= max || cut === '').toBe(true)
        },
      ),
    )
  })
})

describe('estimateTokens', () => {
  it('is 0 for empty text and at least 1 otherwise', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(' ')).toBe(1)
  })

  it('estimates per tokenizer, Claude highest and Gemini lowest on English', () => {
    const text = 'The quick brown fox jumps over the lazy dog, again and again. '.repeat(20)
    const [o200k, claude, gemini] = (['o200k', 'claude', 'gemini'] as const).map((tokenizer) =>
      estimateTokens(text, { tokenizer }),
    )
    expect(estimateTokens(text, {})).toBe(o200k)
    expect(claude).toBeGreaterThan(o200k!)
    expect(gemini).toBeLessThan(claude!)
  })

  it('counts emoji and other scripts', () => {
    expect(estimateTokens('🌊🌊🌊🌊')).toBeGreaterThanOrEqual(4)
    expect(estimateTokens('Καλημέρα κόσμε')).toBeGreaterThan(1)
  })
})
