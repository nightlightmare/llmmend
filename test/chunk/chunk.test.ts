import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Chunk, type ChunkOptions, chunkText, estimateTokens } from '../../src/chunk/index'

/** One "token" per character, so budgets in tests are exact and easy to reason about. */
const chars = (text: string): number => [...text].length

/** Every broken invariant, as a message; empty when the chunking is valid. */
function violations(text: string, chunks: Chunk[], options: ChunkOptions): string[] {
  const count = options.countTokens ?? ((t: string) => estimateTokens(t, options))
  const out: string[] = []
  const check = (ok: boolean, message: string): void => {
    if (!ok) out.push(message)
  }
  if (!text) return chunks.length ? ['chunks for empty text'] : []
  check(chunks[0]?.start === 0, 'the first chunk does not start at 0')
  check(chunks.at(-1)?.end === text.length, 'the last chunk does not end at the end')
  for (const [i, chunk] of chunks.entries()) {
    check(chunk.index === i, `#${i}: index ${chunk.index}`)
    check(chunk.text === text.slice(chunk.start, chunk.end), `#${i}: text is not the slice`)
    check(chunk.tokens === count(chunk.text), `#${i}: tokens ${chunk.tokens} are not the count`)
    check(
      chunk.oversized ? chunk.tokens > options.maxTokens : chunk.tokens <= options.maxTokens,
      `#${i}: ${chunk.tokens} tokens, oversized ${chunk.oversized ?? false}`,
    )
    const previous = chunks[i - 1]
    if (!previous) continue
    // In order, without gaps; with no overlap, back to back.
    check(chunk.start <= previous.end, `#${i}: gap before it`)
    check(chunk.start > previous.start, `#${i}: repeats the whole previous chunk`)
    check(chunk.end > previous.end, `#${i}: does not move forward`)
    check(
      Boolean(options.overlap) || chunk.start === previous.end,
      `#${i}: overlaps without overlap`,
    )
  }
  check(
    Boolean(options.overlap) || chunks.map((c) => c.text).join('') === text,
    'joining the chunks does not restore the text',
  )
  return out
}

const pieces = [
  'The sea ',
  'is calm. ',
  'Море спокойно. ',
  '海は静かだ。',
  '🌊',
  '👨‍👩‍👧',
  '\n',
  '\n\n',
  '# Title\n',
  '## Part\n',
  '```ts\nconst x = 1\n```\n',
  '| a | b |\n|---|---|\n',
  'word',
  ' ',
  '42',
]
const texts = fc.array(fc.constantFrom(...pieces), { maxLength: 40 }).map((p) => p.join(''))

describe('chunkText: invariants', () => {
  it.each([
    ['estimated tokens, text mode', { maxTokens: 12 }],
    ['estimated tokens, markdown mode', { maxTokens: 12, mode: 'markdown' as const }],
    ['estimated tokens with overlap', { maxTokens: 16, overlap: 5 }],
    [
      'Claude estimates, markdown mode',
      { maxTokens: 18, tokenizer: 'claude' as const, mode: 'markdown' as const },
    ],
    ['Gemini estimates with overlap', { maxTokens: 12, overlap: 4, tokenizer: 'gemini' as const }],
    ['exact tokens, tiny budget', { maxTokens: 3, countTokens: chars }],
    [
      'exact tokens, markdown with overlap',
      { maxTokens: 20, overlap: 6, countTokens: chars, mode: 'markdown' as const },
    ],
  ])('hold with %s', (_, options: ChunkOptions) => {
    fc.assert(
      fc.property(texts, (text) => {
        expect(violations(text, chunkText(text, options), options)).toEqual([])
      }),
      { numRuns: 300 },
    )
  })

  it('never splits a grapheme cluster', () => {
    fc.assert(
      fc.property(texts, (text) => {
        const segmenter = new Intl.Segmenter()
        const bounds = new Set([...segmenter.segment(text)].map((s) => s.index))
        for (const chunk of chunkText(text, { maxTokens: 2, countTokens: chars })) {
          expect(bounds.has(chunk.start) || chunk.start === text.length).toBe(true)
        }
      }),
    )
  })

  it('returns nothing for empty text', () => {
    expect(chunkText('', { maxTokens: 10 })).toEqual([])
  })

  it('keeps a text that fits in one chunk', () => {
    expect(chunkText('Short.', { maxTokens: 10 })).toEqual([
      { text: 'Short.', start: 0, end: 6, tokens: estimateTokens('Short.'), index: 0 },
    ])
  })
})

const text = 'One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.'
const at = (maxTokens: number): string[] =>
  chunkText(text, { maxTokens, countTokens: chars }).map((c) => c.text)

describe('chunkText: where it cuts', () => {
  it('prefers paragraphs, then sentences, then words', () => {
    expect(at(40)).toEqual([
      'One two three. Four five six.\n\n',
      'Seven eight nine. Ten eleven twelve.',
    ])
    expect(at(20)).toEqual([
      'One two three. ',
      'Four five six.\n\n',
      'Seven eight nine. ',
      'Ten eleven twelve.',
    ])
    expect(at(10)[0]).toBe('One two ')
  })

  it('cuts after CJK sentence ends without spaces', () => {
    const chunks = chunkText('海は静かだ。空は青い。風が吹く。', {
      maxTokens: 7,
      countTokens: chars,
    })
    expect(chunks.map((c) => c.text)).toEqual(['海は静かだ。', '空は青い。', '風が吹く。'])
  })

  it('marks a single grapheme that alone exceeds the budget as oversized', () => {
    const chunks = chunkText('a👨‍👩‍👧b', { maxTokens: 2, countTokens: (t) => t.length })
    expect(chunks.map((c) => [c.text, c.oversized ?? false])).toEqual([
      ['a', false],
      ['👨‍👩‍👧', true],
      ['b', false],
    ])
  })

  it('repeats the end of the previous chunk as overlap, cut at a separator', () => {
    const chunks = chunkText(text, { maxTokens: 60, overlap: 18, countTokens: chars })
    // The second chunk starts with the previous chunk's last sentence: 16 of the 18 tokens.
    expect(chunks.map((c) => c.text)).toEqual([
      'One two three. Four five six.\n\n',
      'Four five six.\n\nSeven eight nine. Ten eleven twelve.',
    ])
  })

  it('takes no more overlap than the chunk budget leaves', () => {
    // At 40 tokens the second paragraph (36) leaves room for 4: the final blank line only.
    const chunks = chunkText(text, { maxTokens: 40, overlap: 18, countTokens: chars })
    expect(chunks[1]?.text).toBe('\nSeven eight nine. Ten eleven twelve.')
  })

  it('takes custom separators, strings or regular expressions', () => {
    const chunks = chunkText('a;b;c|d', {
      maxTokens: 3,
      countTokens: chars,
      separators: [/\|/g, ';'],
    })
    // '|' first: 'a;b;c|' is still too big, so ';' splits it; then the pieces are merged back.
    expect(chunks.map((c) => c.text)).toEqual(['a;', 'b;', 'c|d'])
  })
})

describe('chunkText: markdown mode', () => {
  const doc = [
    '# Guide',
    '',
    'Intro text.',
    '',
    '## Install',
    '',
    'Run this:',
    '',
    '```sh',
    'npm i llmmend',
    'npm test',
    '```',
    '',
    '## Use',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n')

  it('starts chunks at headings', () => {
    const chunks = chunkText(doc, { maxTokens: 60, countTokens: chars, mode: 'markdown' })
    expect(chunks.map((c) => c.text.split('\n')[0])).toEqual(['# Guide', '## Install', '## Use'])
  })

  it('keeps a code fence whole when it fits', () => {
    for (const maxTokens of [40, 50, 60]) {
      const chunks = chunkText(doc, { maxTokens, countTokens: chars, mode: 'markdown' })
      const fence = '```sh\nnpm i llmmend\nnpm test\n```'
      expect(
        chunks.some((c) => c.text.includes(fence)),
        `maxTokens ${maxTokens}`,
      ).toBe(true)
    }
  })

  it('keeps a table whole when it fits', () => {
    const chunks = chunkText(doc, { maxTokens: 30, countTokens: chars, mode: 'markdown' })
    expect(chunks.some((c) => c.text.includes('| a | b |\n|---|---|\n| 1 | 2 |\n'))).toBe(true)
  })

  it('splits a code fence by lines only when it does not fit', () => {
    const big = '```\n' + Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n```\n'
    const chunks = chunkText(big, { maxTokens: 20, countTokens: chars, mode: 'markdown' })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.text.endsWith('\n') || c.end === big.length)).toBe(true)
  })

  it('handles an unclosed fence at the end', () => {
    const unclosed = 'Text.\n\n```js\nconst a = 1\nconst b = 2'
    const options = { maxTokens: 12, countTokens: chars, mode: 'markdown' as const }
    expect(violations(unclosed, chunkText(unclosed, options), options)).toEqual([])
  })
})
