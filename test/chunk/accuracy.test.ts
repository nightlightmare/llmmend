import { getEncoding } from 'js-tiktoken'
import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../../src/chunk/index'
import { fixtureDir } from '../fixtures'

// The repository's own docs (English, Russian, Chinese) and code, and hand-written Japanese,
// Korean and chat text: the corpus the heuristic is calibrated on. The docs and code are a frozen
// copy (in `chunk/repo`, `/` written as `__`), so editing them cannot move a window over the limit.
const corpus = new Map<string, string>([
  ...[...fixtureDir('chunk/repo')].map(([name, text]): [string, string] => [
    name.replaceAll('__', '/').replace(/\.txt$/, ''),
    text,
  ]),
  ...[...fixtureDir('chunk/corpus')].map(([name, text]): [string, string] => [
    `corpus/${name}`,
    text,
  ]),
])

const o200k = getEncoding('o200k_base')
const error = (text: string): number => {
  const real = o200k.encode(text).length
  return (estimateTokens(text) - real) / real
}

/** Overlapping windows of `size` characters, every `size / 2`. */
function windows(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i + size <= text.length; i += size / 2) out.push(text.slice(i, i + size))
  return out
}

describe('estimateTokens accuracy against o200k_base', () => {
  it('has a corpus in every language and kind', () => {
    const names = [...corpus.keys()]
    for (const part of [
      'docs/api.ru.md',
      'docs/api.zh-CN.md',
      'README.md',
      'src/',
      'corpus/ja',
      'corpus/ko',
    ]) {
      expect(names.some((n) => n.includes(part))).toBe(true)
    }
  })

  it('is within ±15 % on every 1,000-character window', () => {
    const outside: string[] = []
    for (const [name, text] of corpus) {
      for (const [i, piece] of windows(text, 1000).entries()) {
        const e = error(piece)
        if (Math.abs(e) > 0.15) outside.push(`${name}#${i}: ${(e * 100).toFixed(1)} %`)
      }
    }
    expect(outside).toEqual([])
  })

  it('is within ±15 % on 97 % of 600-character windows', () => {
    const errors = [...corpus.values()].flatMap((text) => windows(text, 600).map(error))
    const within = errors.filter((e) => Math.abs(e) <= 0.15).length / errors.length
    expect(within).toBeGreaterThanOrEqual(0.97)
  })

  it('is within ±15 % on each whole text over 500 characters', () => {
    const outside = [...corpus]
      .filter(([, text]) => text.length > 500 && Math.abs(error(text)) > 0.15)
      .map(([name]) => name)
    expect(outside).toEqual([])
  })
})
