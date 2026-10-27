---
'llmmend': minor
---

New module `llmmend/cost`: `estimateCost(usage, prices)` prices a call's token usage with prices you pass per million tokens (input, cache reads and writes, output, long-context tiers) and returns the cost by part, listing any missing count; `toUsage(raw)` reads the raw `usage` of an Anthropic, OpenAI or Gemini reply without streaming.
