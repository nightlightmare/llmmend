---
'llmmend': patch
---

`estimateTokens` counts symbols, arrows, box drawing and emoji at about 1.2 tokens each and a Markdown table's `|` as a whole token, instead of undercounting them; tables full of check marks and warning signs were up to 17 % low against `o200k_base`.
