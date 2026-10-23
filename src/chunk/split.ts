import { estimateTokens } from './tokens'

/** One piece of a text, cut to fit a token budget. `text === source.slice(start, end)`. */
export interface Chunk {
  text: string
  start: number
  end: number
  tokens: number
  index: number
  /**
   * Set when no separator could cut the chunk below `maxTokens`: with the default separators,
   * a single grapheme cluster.
   */
  oversized?: true
}

export interface ChunkOptions {
  maxTokens: number
  /** Tokens repeated from the end of the previous chunk, cut at a separator. Default 0. */
  overlap?: number
  /** Default: `estimateTokens`. */
  countTokens?: (text: string) => number
  /** Tried in order, coarsest first; `''` splits between grapheme clusters. */
  separators?: (string | RegExp)[]
  /** `markdown` starts chunks at headings and keeps code fences and tables whole if they fit. */
  mode?: 'text' | 'markdown'
}

// A sentence ends at `.`, `!`, `?` or `…` followed by whitespace, or right after `。！？`.
const SENTENCE = /(?<=[.!?…])\s+|(?<=[。！？])/
const TEXT_SEPARATORS: (string | RegExp)[] = ['\n\n', '\n', SENTENCE, ' ', '']
// Cut before a heading, so each section starts its chunk.
const MARKDOWN_SEPARATORS: (string | RegExp)[] = [
  /\n(?=# )/,
  /\n(?=## )/,
  /\n(?=### )/,
  /\n(?=#### )/,
  ...TEXT_SEPARATORS,
]
// Inside a code fence or table that does not fit: lines, then grapheme clusters.
const BLOCK_SEPARATORS = ['\n', '']

let segmenter: Intl.Segmenter | undefined

/** Where `separator` cuts `text` strictly between `start` and `end`; a cut follows the separator. */
function cuts(text: string, start: number, end: number, separator: string | RegExp): number[] {
  const found: number[] = []
  if (separator === '') {
    segmenter ??= new Intl.Segmenter()
    for (const { index } of segmenter.segment(text.slice(start, end))) {
      if (index > 0) found.push(start + index)
    }
    return found
  }
  if (typeof separator === 'string') {
    for (let i = text.indexOf(separator, start); i !== -1 && i < end;) {
      const cut = i + separator.length
      if (cut < end) found.push(cut)
      i = text.indexOf(separator, cut)
    }
    return found
  }
  const re = new RegExp(separator.source, separator.flags.replace(/[gy]/g, '') + 'g')
  re.lastIndex = start
  for (let m = re.exec(text); m && m.index < end; m = re.exec(text)) {
    const cut = m.index + m[0].length
    if (cut > start && cut < end) found.push(cut)
    if (!m[0]) re.lastIndex++
  }
  return found
}

/** Code fences and tables, as [start, end) ranges. */
function protectedBlocks(text: string): [number, number][] {
  const blocks: [number, number][] = []
  const fences =
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))|(?:^ {0,3}\|[^\n]*(?:\n|$))+/gm
  for (const m of text.matchAll(fences)) blocks.push([m.index, m.index + m[0].length])
  return blocks
}

/** Splits `text` into chunks of at most `maxTokens` tokens, at the coarsest separators that fit. */
export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  const { maxTokens, overlap = 0, countTokens = estimateTokens, mode = 'text' } = options
  const separators =
    options.separators ?? (mode === 'markdown' ? MARKDOWN_SEPARATORS : TEXT_SEPARATORS)
  const blocks = mode === 'markdown' ? protectedBlocks(text) : []
  const count = (start: number, end: number): number => countTokens(text.slice(start, end))
  const inBlock = (cut: number): boolean => blocks.some(([s, e]) => s < cut && cut < e)

  // Pieces small enough to fit (or indivisible), each ending right after a separator.
  const starts: number[] = []
  const ends: number[] = []
  const sizes: number[] = []
  const split = (start: number, end: number, levels: (string | RegExp)[], guard: boolean): void => {
    const tokens = count(start, end)
    if (tokens > maxTokens) {
      for (let level = 0; level < levels.length; level++) {
        const at = cuts(text, start, end, levels[level]!).filter((cut) => !guard || !inBlock(cut))
        if (!at.length) continue
        const bounds = [start, ...at, end]
        for (let i = 1; i < bounds.length; i++)
          split(bounds[i - 1]!, bounds[i]!, levels.slice(level + 1), guard)
        return
      }
      // Only a protected block is left: split it by lines after all.
      if (guard) return split(start, end, BLOCK_SEPARATORS, false)
    }
    starts.push(start)
    ends.push(end)
    sizes.push(tokens)
  }
  if (text) split(0, text.length, separators, blocks.length > 0)

  const chunks: Chunk[] = []
  for (let first = 0; first < starts.length;) {
    // Merge greedily by summed counts, then check the real count of the merged text.
    let last = first
    for (
      let sum = sizes[first]!;
      last + 1 < starts.length && sum + sizes[last + 1]! <= maxTokens;
    ) {
      sum += sizes[++last]!
    }
    let tokens = count(starts[first]!, ends[last]!)
    while (tokens > maxTokens && last > first) tokens = count(starts[first]!, ends[--last]!)
    const end = ends[last]!
    let start = starts[first]!
    // Overlap: the longest end of the previous chunk that fits both budgets, cut at a separator
    // (the coarsest on a tie; between grapheme clusters only if nothing else fits). Cuts lie
    // strictly inside the previous chunk, so it is never repeated whole.
    const previous = chunks[chunks.length - 1]
    let overlapStart = start
    for (const separator of overlap > 0 && previous ? separators : []) {
      if (separator === '' && overlapStart < start) break
      const at = cuts(text, previous!.start, start, separator).filter((cut) => !inBlock(cut))
      for (let i = at.length - 1; i >= 0 && count(at[i]!, start) <= overlap; i--) {
        const total = count(at[i]!, end)
        if (total > maxTokens) break
        if (at[i]! < overlapStart) {
          overlapStart = at[i]!
          tokens = total
        }
      }
    }
    start = overlapStart
    const chunk: Chunk = { text: text.slice(start, end), start, end, tokens, index: chunks.length }
    if (tokens > maxTokens) chunk.oversized = true
    chunks.push(chunk)
    first = last + 1
  }
  return chunks
}
