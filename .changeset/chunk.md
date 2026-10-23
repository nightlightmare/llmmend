---
'llmmend': minor
---

Add `llmmend/chunk`: `chunkText` splits a text into chunks of at most `maxTokens` tokens at the coarsest separator that fits (headings in `markdown` mode, then paragraphs, lines, sentences, words, grapheme clusters), with exact positions, optional overlap, and code fences and tables kept whole when they fit; `estimateTokens` estimates tokens without a vocabulary; `truncateToTokens` shortens a text to a token budget without splitting a grapheme cluster.
