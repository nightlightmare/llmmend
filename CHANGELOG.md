# llmmend

## 0.2.1

### Patch Changes

- 79ef68d: The package `homepage` is now the playground, https://nightlightmare.github.io/llmmend/, where you can try JSON repair, SSE parsing and chunking in the browser.
- c6c9721: Ship `llms.txt` and `llms-full.txt` in the package, so AI coding assistants can read the API reference from `node_modules`.
- 3b7970c: `estimateTokens` counts symbols, arrows, box drawing and emoji at about 1.2 tokens each and a Markdown table's `|` as a whole token, instead of undercounting them; tables full of check marks and warning signs were up to 17 % low against `o200k_base`.

## 0.2.0

### Minor Changes

- e5e6439: `provider` is now optional and defaults to `'auto'`, which detects Anthropic, OpenAI Chat Completions, OpenAI Responses and Gemini streams from their first events: `streamLlm(res)` just works. Errors before the answer arrive as `error` in any of these shapes.
- d1fb4b2: Add `llmmend/chunk`: `chunkText` splits a text into chunks of at most `maxTokens` tokens at the coarsest separator that fits (headings in `markdown` mode, then paragraphs, lines, sentences, words, grapheme clusters), with exact positions, optional overlap, and code fences and tables kept whole when they fit; `estimateTokens` estimates tokens without a vocabulary; `truncateToTokens` shortens a text to a token budget without splitting a grapheme cluster.
- cea1136: Add the `'gemini'` Provider for Google Gemini `streamGenerateContent`: Blocks in part order, thought summaries as `reasoning`, `thoughtSignature` as `reasoning_signature` on the Block that carried it, whole function calls, cumulative usage with cached tokens, and finish reasons mapped to Stop reasons (`STOP` after function calls is `tool_use`).
- 73a3f44: Add the `'openai-responses'` Provider for the OpenAI Responses API: one Block per output item, reasoning summaries as `reasoning` and `encrypted_content` as `reasoning_signature`, function and custom tool calls, built-in tools as `other`, and stop reasons from `response.completed`, `response.incomplete` and `response.failed`. The `'openai'` Provider now shows a structured-outputs `refusal` as text and ends it as `refused`.
- 65905f1: Add `streamJson` to `llmmend/sse`: streams a Reply that contains JSON, yielding the Partial value each time it changes and a final item with the full Extraction (`result`), the text, the Stop reason and usage.

## 0.1.1

### Patch Changes

- Show the English README on npmjs.com: 0.1.0 shipped with the Chinese translation as the package README. The translations moved to `docs/`.

## 0.1.0

### Minor Changes

- First release.
  
  - `llmmend/json`: `extractJson`, `extractJsonAsync`, `extractJsonOrThrow` and `extractAllJson` find JSON in a model reply, repair it (trailing commas, single quotes, unquoted keys, Python literals, `NaN`, raw control characters, comments, cut-off values) and validate it with any Standard Schema; `repairJson` repairs bare JSON text; `parsePartialJson` reads JSON that is still streaming in.
  - `llmmend/sse`: `parseSSE`, a WHATWG-compliant server-sent events parser; `streamLlm`, `streamText` and `collectText` turn Anthropic and OpenAI-compatible Chat Completions streams into one sequence of LLM events, with `done` exactly once and last.
  - Zero dependencies, ESM and CommonJS, TypeScript types; tested on Node 20+, Bun, Deno, WebKit and Cloudflare Workers.
