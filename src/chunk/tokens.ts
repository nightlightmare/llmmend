// A token estimate without a vocabulary, calibrated against real tokenizers on English, Russian,
// Chinese, Japanese, Korean, code, Markdown and chat text: within ±15 % on texts over 1,000
// characters (test/chunk/accuracy.test.ts measures it). Pass your own `countTokens` for exact counts.

/** The tokenizer `estimateTokens` imitates: OpenAI's `o200k_base`, Claude's or Gemini's. */
export type Tokenizer = 'o200k' | 'claude' | 'gemini'

export interface EstimateOptions {
  /** Default `'o200k'`. */
  tokenizer?: Tokenizer
}

const RUNS =
  /(?<lat>[A-Za-zÀ-ɏ]+)|(?<cyr>[Ѐ-ӿ]+)|(?<han>[㐀-鿿豈-﫿]+)|(?<kana>[぀-ヿ]+)|(?<hng>[가-힯]+)|(?<sym>(?:[\u{2070}-\u{2BFF}\u{1F000}-\u{1FAFF}]\u{FE0F}?)+)|(?<dig>\d+)|(?<ws>\s+)|(?<rep>(?<ch>[!-/:-@[-`{-~])\k<ch>+)|(?<pun>[!-/:-@[-`{-~])/gu

// Tokens per: Latin word, its letter past the 6th, letter of an all-caps word; Cyrillic word, its
// letter past the 3rd; Han, kana and Hangul character; symbol; group of 3 digits; whitespace run
// (with a line break or longer than one), its character; run of one symbol (`----`), its
// character; punctuation; `|`; other code unit. `claude` and `gemini` are fitted to the exact
// counts in test/fixtures/chunk/counts (scripts/record-token-counts.mjs records them).
const WEIGHTS = {
  // Short words are one token, longer ones split about every 4 letters. A space before a word
  // belongs to the word. Punctuation mostly merges with its neighbours in code; a table's `|`
  // stands alone. Symbols, arrows, box drawing and emoji are rare: often several bytes each.
  o200k: [1, 0.25, 0, 1, 0.25, 0.8, 0.8, 0.8, 1.2, 1, 1, 1 / 64, 1, 1 / 64, 0.64, 1, 0.5],
  claude: [
    1.38, 0.67, 0.1, 1.39, 0.36, 1.18, 0.97, 1.49, 1.61, 1.65, 1.34, 0.05, 1.31, 0.16, 0.95, 1.07,
    1.06,
  ],
  gemini: [
    0.95, 0.22, 0.04, 0.98, 0.19, 0.73, 0.58, 0.76, 1.25, 1.77, 1.52, 0.03, 1.31, 0.08, 0.8, 0.29,
    0.66,
  ],
} as const satisfies Record<Tokenizer, readonly number[]>

/** Estimates how many tokens `text` takes in a modern BPE vocabulary (default `o200k_base`). */
export function estimateTokens(text: string, options: EstimateOptions = {}): number {
  const [
    word,
    letter,
    caps,
    cyrWord,
    cyrLetter,
    han,
    kana,
    hangul,
    symbol,
    digits,
    space,
    spaceChar,
    run,
    runChar,
    punctuation,
    pipe,
    other,
  ] = WEIGHTS[options.tokenizer ?? 'o200k']
  let tokens = 0
  let counted = 0
  for (const match of text.matchAll(RUNS)) {
    const groups = match.groups as Record<string, string | undefined>
    const n = match[0].length
    counted += n
    if (groups.lat) {
      tokens += word + Math.max(0, n - 6) * letter
      if (n > 1 && groups.lat === groups.lat.toUpperCase()) tokens += n * caps
    } else if (groups.cyr) tokens += cyrWord + Math.max(0, n - 3) * cyrLetter
    else if (groups.han) tokens += n * han
    else if (groups.kana) tokens += n * kana
    else if (groups.hng) tokens += n * hangul
    else if (groups.sym) tokens += [...groups.sym].length * symbol
    else if (groups.dig) tokens += Math.ceil(n / 3) * digits
    // A single space before a word costs nothing on its own.
    else if (groups.ws) tokens += groups.ws.includes('\n') || n > 1 ? space + n * spaceChar : 0
    else if (groups.rep) tokens += run + n * runChar
    else tokens += match[0] === '|' ? pipe : punctuation
  }
  // Everything else (other scripts) is about a token per code unit pair in `o200k_base`.
  tokens += (text.length - counted) * other
  return text ? Math.max(1, Math.round(tokens)) : 0
}
