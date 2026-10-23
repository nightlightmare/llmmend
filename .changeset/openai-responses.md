---
'llmmend': minor
---

Add the `'openai-responses'` Provider for the OpenAI Responses API: one Block per output item, reasoning summaries as `reasoning` and `encrypted_content` as `reasoning_signature`, function and custom tool calls, built-in tools as `other`, and stop reasons from `response.completed`, `response.incomplete` and `response.failed`. The `'openai'` Provider now shows a structured-outputs `refusal` as text and ends it as `refused`.
