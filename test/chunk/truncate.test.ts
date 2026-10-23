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

  it('counts emoji and other scripts', () => {
    expect(estimateTokens('🌊🌊🌊🌊')).toBeGreaterThanOrEqual(4)
    expect(estimateTokens('Καλημέρα κόσμε')).toBeGreaterThan(1)
  })
})
