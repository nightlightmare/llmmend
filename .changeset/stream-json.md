---
'llmmend': minor
---

Add `streamJson` to `llmmend/sse`: streams a Reply that contains JSON, yielding the Partial value each time it changes and a final item with the full Extraction (`result`), the text, the Stop reason and usage.
