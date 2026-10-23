---
'llmmend': minor
---

Add the `'gemini'` Provider for Google Gemini `streamGenerateContent`: Blocks in part order, thought summaries as `reasoning`, `thoughtSignature` as `reasoning_signature` on the Block that carried it, whole function calls, cumulative usage with cached tokens, and finish reasons mapped to Stop reasons (`STOP` after function calls is `tool_use`).
