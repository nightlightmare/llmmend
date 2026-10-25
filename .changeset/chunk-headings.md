---
'llmmend': minor
---

Chunks in `markdown` mode carry `headings`: the path of headings in effect where the chunk's own text starts, for search context (ATX and setext headings, none from code fences; only the markers removed). New `chunkDocuments` splits several documents in one call and gives every chunk its document's position (`doc`) and typed `metadata`.
