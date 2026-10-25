---
'llmmend': minor
---

Add `extractCodeBlocks` to `llmmend/json`: every fenced code block in a Reply with its language, info string, content, position and `complete: false` for a block cut off at the end; the `lang` filter matches common aliases (`ts`/`typescript`, `sh`/`bash`…). `extractTag` now skips code with the same fence scanner.
