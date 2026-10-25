import { describe, expect, expectTypeOf, it } from 'vitest'
import { chunkDocuments, chunkText } from '../../src/chunk/index'

/** Counts characters, so the tests control exactly where chunks end. */
const chars = (text: string): number => text.length
const paths = (text: string, maxTokens: number, overlap = 0): [string, string[]][] =>
  chunkText(text, { maxTokens, overlap, mode: 'markdown', countTokens: chars }).map((c) => [
    c.text.trim().split('\n')[0]!,
    c.headings!,
  ])

describe('chunkText headings', () => {
  const doc = [
    '# Install',
    'Pick your system.',
    '## Linux',
    'Run the script.',
    '### Debian',
    'Use apt.',
    '## macOS',
    'Use brew.',
    '# Usage',
    'Import it.',
  ].join('\n\n')

  it('gives each chunk the path of headings in effect where it starts', () => {
    expect(paths(doc, 30)).toEqual([
      ['# Install', ['Install']],
      ['## Linux', ['Install', 'Linux']],
      ['### Debian', ['Install', 'Linux', 'Debian']],
      ['## macOS', ['Install', 'macOS']],
      ['# Usage', ['Usage']],
    ])
  })

  it('gives a chunk of several sections the path of the first', () => {
    expect(paths(doc, 200).map(([, h]) => h)).toEqual([['Install']])
  })

  it('takes the path where the chunk’s own text starts, not where the Overlap does', () => {
    const chunks = chunkText(doc, {
      maxTokens: 30,
      overlap: 12,
      mode: 'markdown',
      countTokens: chars,
    })
    // The macOS chunk repeats the end of the Debian section, yet its path is its own.
    expect(chunks.map((c) => [c.text, c.headings])).toEqual([
      ['# Install\n\nPick your system.\n\n', ['Install']],
      ['\n## Linux\n\nRun the script.\n\n', ['Install', 'Linux']],
      ['\n### Debian\n\nUse apt.\n\n', ['Install', 'Linux', 'Debian']],
      ['apt.\n\n## macOS\n\nUse brew.\n\n', ['Install', 'macOS']],
      ['Use brew.\n\n# Usage\n\nImport it.', ['Usage']],
    ])
  })

  it('reads every ATX level, setext headings, and closing hashes', () => {
    const text = [
      'Title',
      '=====',
      'Intro.',
      '',
      'Part',
      '----',
      'Text.',
      '',
      '###### Deep ######',
      'Deepest.',
    ].join('\n')
    const [last] = chunkText(text, { maxTokens: 1000, mode: 'markdown' }).slice(-1)
    expect(last?.headings).toEqual(['Title'])
    const small = chunkText(text, { maxTokens: 12, mode: 'markdown', countTokens: chars })
    expect(small.at(-1)?.headings).toEqual(['Title', 'Part', 'Deep'])
  })

  it('keeps inline Markdown in heading text and skips levels it never saw', () => {
    const text = '# The **`chunk`** API\n\n### Options\n\nmaxTokens'
    const chunks = chunkText(text, { maxTokens: 15, mode: 'markdown', countTokens: chars })
    expect(chunks.at(-1)?.headings).toEqual(['The **`chunk`** API', 'Options'])
  })

  it('ignores headings in code fences, a thematic break, and `#` without a space', () => {
    const text = [
      '# Real',
      '```md',
      '# Not a heading',
      '```',
      '',
      '---',
      '#hashtag',
      'Body text.',
    ].join('\n')
    const chunks = chunkText(text, { maxTokens: 1000, mode: 'markdown' })
    expect(chunks.map((c) => c.headings)).toEqual([['Real']])
  })

  it('reads an empty ATX heading, and `---` under an ATX heading as a break, not setext', () => {
    const text = '# Top\n---\n\n##\n\nUntitled section.'
    const chunks = chunkText(text, { maxTokens: 1000, mode: 'markdown' })
    expect(chunks.map((c) => c.headings)).toEqual([['Top']])
    const small = chunkText(text, { maxTokens: 12, mode: 'markdown', countTokens: chars })
    expect(small.at(-1)?.headings).toEqual(['Top', ''])
  })

  it('reads headings in text with Windows line breaks', () => {
    const text = '# One\r\n\r\nFirst.\r\n\r\n## Two\r\n\r\nSecond.'
    const chunks = chunkText(text, { maxTokens: 12, mode: 'markdown', countTokens: chars })
    expect(chunks.at(-1)?.headings).toEqual(['One', 'Two'])
  })

  it('leaves headings out in text mode and gives [] before the first heading', () => {
    expect(chunkText('# A\n\nb', { maxTokens: 100 })[0]).not.toHaveProperty('headings')
    expect(
      chunkText('Preface.\n\n# A', { maxTokens: 3, mode: 'markdown', countTokens: chars })[0]
        ?.headings,
    ).toEqual([])
  })
})

describe('chunkDocuments', () => {
  const docs = [
    { text: 'First page. It has two sentences.', metadata: { source: 'a.pdf', page: 1 } },
    { text: 'Second page.', metadata: { source: 'a.pdf', page: 2 } },
  ]

  it('returns every chunk of every document with its position and metadata', () => {
    const chunks = chunkDocuments(docs, { maxTokens: 14, countTokens: chars })
    expect(chunks.map((c) => [c.doc, c.index, c.text, c.metadata.page])).toEqual([
      [0, 0, 'First page. ', 1],
      [0, 1, 'It has two ', 1],
      [0, 2, 'sentences.', 1],
      [1, 0, 'Second page.', 2],
    ])
    for (const c of chunks) expect(docs[c.doc]!.text.slice(c.start, c.end)).toBe(c.text)
  })

  it('never overlaps across documents, and passes options through', () => {
    const chunks = chunkDocuments([{ text: '# A\n\nalpha beta gamma' }, { text: '# B\n\ndelta' }], {
      maxTokens: 12,
      overlap: 6,
      mode: 'markdown',
      countTokens: chars,
    })
    expect(chunks.filter((c) => c.index === 0).every((c) => c.start === 0)).toBe(true)
    expect(chunks.find((c) => c.doc === 1)?.headings).toEqual(['B'])
  })

  it('types metadata from the input', () => {
    const chunks = chunkDocuments(docs, { maxTokens: 100 })
    expectTypeOf(chunks[0]!.metadata).toEqualTypeOf<{ source: string; page: number }>()
    const bare = chunkDocuments([{ text: 'x' }], { maxTokens: 100 })
    expectTypeOf(bare[0]!.metadata).toEqualTypeOf<unknown>()
    expect(bare[0]!.metadata).toBeUndefined()
  })
})
