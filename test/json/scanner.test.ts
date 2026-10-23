import { describe, expect, it } from 'vitest'
import {
  type Cursor,
  scanNumber,
  scanString,
  scanWord,
  skipComment,
  skipWhitespace,
} from '../../src/json/scanner'

const at = (text: string, pos = 0): Cursor => ({ text, pos })

describe('skipWhitespace', () => {
  it('skips space, tab, LF and CR only', () => {
    const c = at(' \t\r\n x')
    skipWhitespace(c)
    expect(c.pos).toBe(5)
  })

  it('does not treat other Unicode spaces or a BOM as whitespace', () => {
    for (const text of [' ', ' ', '﻿', '\v', '\f']) {
      const c = at(text)
      skipWhitespace(c)
      expect(c.pos).toBe(0)
    }
  })

  it('stops at the end of the text', () => {
    const c = at('   ')
    skipWhitespace(c)
    expect(c.pos).toBe(3)
  })
})

describe('skipComment', () => {
  it.each([
    ['// note\n1', 7],
    ['// note\r\n1', 7],
    ['// to the end', 13],
    ['/* a */1', 7],
    ['/* multi\nline */1', 16],
    ['/* unterminated', 15],
  ])('skips %j', (text, end) => {
    const c = at(text)
    expect(skipComment(c)).toBe(true)
    expect(c.pos).toBe(end)
  })

  it.each(['/x', '/', 'a', ''])('leaves %j alone', (text) => {
    const c = at(text)
    expect(skipComment(c)).toBe(false)
    expect(c.pos).toBe(0)
  })
})

describe('scanString', () => {
  it.each([
    ['""', ''],
    ['"plain"', 'plain'],
    ['"Привет 🌊"', 'Привет 🌊'],
    ['"\\" \\\\ \\/ \\b \\f \\n \\r \\t"', '" \\ / \b \f \n \r \t'],
    ['"\\u0041\\u00e9\\u4E2D"', 'Aé中'],
    ['"\\ud83c\\udf0a"', '🌊'],
    ['"\\ud800"', '\ud800'],
    ['"a\\nb\\tc"', 'a\nb\tc'],
  ])('scans %s', (text, value) => {
    const c = at(text + ' rest')
    expect(scanString(c)).toBe(value)
    expect(c.pos).toBe(text.length)
  })

  it.each([
    ['"\\x"', 1],
    ['"\\u12"', 1],
    ['"\\u12G4"', 1],
    ['"ab\\', 3],
    ['"a\nb"', 2],
    ['"a\u0000"', 2],
    ['"unterminated', 13],
  ])('rejects %j at %i', (text, pos) => {
    const c = at(text)
    expect(scanString(c)).toBeUndefined()
    expect(c.pos).toBe(pos)
  })

  it('accepts DEL and other non-control characters raw', () => {
    expect(scanString(at('"\u007f "'))).toBe('\u007f ')
  })
})

describe('scanNumber', () => {
  it.each([
    ['0', 0],
    ['-0', -0],
    ['7', 7],
    ['-12', -12],
    ['3.25', 3.25],
    ['1e3', 1000],
    ['1E+3', 1000],
    ['2.5e-1', 0.25],
    ['1e400', Infinity],
  ])('scans %s', (text, value) => {
    const c = at(text + ',')
    expect(scanNumber(c)).toBe(value)
    expect(c.pos).toBe(text.length)
  })

  it('stops after a leading zero', () => {
    const c = at('012')
    expect(scanNumber(c)).toBe(0)
    expect(c.pos).toBe(1)
  })

  it.each([
    ['-', 1],
    ['-a', 1],
    ['.5', 0],
    ['1.', 2],
    ['1.e3', 2],
    ['1e', 2],
    ['1e+', 3],
  ])('rejects %j at %i', (text, pos) => {
    const c = at(text)
    expect(scanNumber(c)).toBeUndefined()
    expect(c.pos).toBe(pos)
  })
})

describe('scanWord', () => {
  it('consumes a matching word', () => {
    const c = at('xtrue', 1)
    expect(scanWord(c, 'true')).toBe(true)
    expect(c.pos).toBe(5)
  })

  it('leaves the cursor alone otherwise', () => {
    const c = at('tru')
    expect(scanWord(c, 'true')).toBe(false)
    expect(c.pos).toBe(0)
  })
})
