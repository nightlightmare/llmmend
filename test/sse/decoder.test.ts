import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createLineDecoder } from '../../src/sse/decoder'
import { splitAt } from './split'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

function decodeAll(chunks: (Uint8Array | string)[]): string[] {
  const decoder = createLineDecoder()
  return chunks.flatMap((c) => decoder.push(c))
}

describe('createLineDecoder', () => {
  it('splits on LF, CRLF and CR', () => {
    expect(decodeAll(['a\nb\r\nc\rd\n'])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps empty lines', () => {
    expect(decodeAll(['\n\r\n\r'])).toEqual(['', '', ''])
  })

  it('treats CR at a chunk end followed by LF as one line ending', () => {
    expect(decodeAll(['a\r', '\nb\n'])).toEqual(['a', 'b'])
    expect(decodeAll(['a\r', '', '\nb\n'])).toEqual(['a', 'b'])
  })

  it('treats CR followed by anything else as a line ending', () => {
    expect(decodeAll(['a\r', 'b\n'])).toEqual(['a', 'b'])
  })

  it('joins a line split across chunks', () => {
    expect(decodeAll(['da', 'ta: x', 'y\n'])).toEqual(['data: xy'])
  })

  it('holds back an unterminated last line', () => {
    expect(decodeAll(['a\nincomplete'])).toEqual(['a'])
  })

  it('strips a leading BOM from bytes and from strings, only at the start', () => {
    expect(decodeAll([bytes('﻿a\n﻿b\n')])).toEqual(['a', '﻿b'])
    expect(decodeAll(['', '﻿a\n', '﻿b\n'])).toEqual(['a', '﻿b'])
  })

  it('decodes UTF-8 split anywhere, including inside a character', () => {
    const text = 'data: Привет 🌊 中文\r\ndata: é\n\n'
    const data = bytes(text)
    const whole = decodeAll([data])
    expect(whole).toEqual(['data: Привет 🌊 中文', 'data: é', ''])
    for (let i = 0; i <= data.length; i++) {
      expect(decodeAll([data.subarray(0, i), data.subarray(i)])).toEqual(whole)
    }
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: data.length }), (cuts) => {
        expect(decodeAll(splitAt(data, cuts))).toEqual(whole)
      }),
    )
  })

  it('holds back a character whose bytes have not all arrived', () => {
    expect(decodeAll([bytes('a\n'), new Uint8Array([0xf0, 0x9f])])).toEqual(['a'])
    expect(decodeAll([new Uint8Array([0xf0, 0x9f]), new Uint8Array([0x8c, 0x8a, 0x0a])])).toEqual([
      '🌊',
    ])
  })
})
