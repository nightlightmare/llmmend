---
'llmmend': minor
---

`provider` is now optional and defaults to `'auto'`, which detects Anthropic, OpenAI Chat Completions, OpenAI Responses and Gemini streams from their first events: `streamLlm(res)` just works. Errors before the answer arrive as `error` in any of these shapes.
