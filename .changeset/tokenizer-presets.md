---
'llmmend': minor
---

New option `tokenizer` on `estimateTokens`, `chunkText`, `chunkDocuments` and `truncateToTokens`: `'o200k'` (the default, unchanged), `'claude'` or `'gemini'`. Each preset has its own weights per kind of character, fitted to exact Claude and Gemini counts of the calibration corpus, and is within ±15 % on every 1,000-character window of it, like `'o200k'`. This replaces the advice to divide the budget by 1.5 for Claude.
