// A token estimate without a vocabulary, calibrated against `o200k_base` on English, Russian,
// Chinese, Japanese, Korean, code, Markdown and chat text: within ±15 % on texts over 1,000
// characters (test/chunk/accuracy.test.ts measures it). Pass your own `countTokens` for exact counts.

const RUNS =
  /(?<lat>[A-Za-zÀ-ɏ]+)|(?<cyr>[Ѐ-ӿ]+)|(?<cjk>[぀-ヿ㐀-鿿가-힯豈-﫿]+)|(?<dig>\d+)|(?<ws>\s+)|(?<rep>(?<ch>[!-/:-@[-`{-~])\k<ch>+)|(?<pun>[!-/:-@[-`{-~])/gu

/** Estimates how many tokens `text` takes in a modern BPE vocabulary (`o200k_base`). */
export function estimateTokens(text: string): number {
  let tokens = 0
  let counted = 0
  for (const match of text.matchAll(RUNS)) {
    const { lat, cyr, cjk, dig, ws, rep } = match.groups as Record<string, string | undefined>
    counted += match[0].length
    // Short words are one token; longer ones split about every 4 letters.
    if (lat) tokens += 1 + Math.max(0, lat.length - 6) / 4
    else if (cyr) tokens += 1 + Math.max(0, cyr.length - 3) / 4
    else if (cjk) tokens += cjk.length * 0.8
    else if (dig) tokens += Math.ceil(dig.length / 3)
    // A space before a word belongs to the word; longer runs and line breaks cost about one.
    else if (ws) tokens += ws.includes('\n') || ws.length > 1 ? 1 + ws.length / 64 : 0
    // Runs of one symbol (`----`, `====`) merge into few tokens.
    else if (rep) tokens += 1 + rep.length / 64
    else tokens += 0.64
  }
  // Everything else (emoji, other scripts) is about a token per code unit pair.
  tokens += (text.length - counted) / 2
  return text ? Math.max(1, Math.round(tokens)) : 0
}
