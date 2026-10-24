---
'llmmend': patch
---

`estimateTokens` counts symbols, arrows, box drawing and emoji at about 1.2 tokens each and a Markdown table's `|` as a whole token, instead of undercounting them; tables with ✅ and ⚠️ were up to 17 % low against `o200k_base`.
