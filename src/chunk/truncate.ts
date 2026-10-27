import { estimateTokens, type Tokenizer } from './tokens'

export interface TruncateOptions {
  /** Where to cut: `'end'` (default) keeps the beginning, `'start'` the end, `'middle'` both. */
  from?: 'end' | 'start' | 'middle'
  /** Put where the text was cut; counted against `max`. Default `''`. */
  ellipsis?: string
  /** Default: `estimateTokens` for `tokenizer`. */
  countTokens?: (text: string) => number
  /** The tokenizer `estimateTokens` imitates when there is no `countTokens`. Default `'o200k'`. */
  tokenizer?: Tokenizer
}

let segmenter: Intl.Segmenter | undefined

/** Shortens `text` to at most `max` tokens, never splitting a grapheme cluster. */
export function truncateToTokens(text: string, max: number, options: TruncateOptions = {}): string {
  const { from = 'end', ellipsis = '' } = options
  const countTokens = options.countTokens ?? ((t: string) => estimateTokens(t, options))
  if (countTokens(text) <= max) return text
  segmenter ??= new Intl.Segmenter()
  const graphemes = Array.from(segmenter.segment(text), (s) => s.segment)
  const keep = (n: number): string => {
    if (from === 'start') return ellipsis + graphemes.slice(graphemes.length - n).join('')
    if (from === 'end') return graphemes.slice(0, n).join('') + ellipsis
    const head = Math.ceil(n / 2)
    return (
      graphemes.slice(0, head).join('') +
      ellipsis +
      graphemes.slice(graphemes.length - (n - head)).join('')
    )
  }
  // The longest cut that fits: counts grow with the number of graphemes kept.
  let low = 0
  let high = graphemes.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (countTokens(keep(mid)) <= max) low = mid
    else high = mid - 1
  }
  const result = keep(low)
  return countTokens(result) <= max ? result : ''
}
