# llmmend

## 0.6.0

### Minor Changes

- f3af34c: New module `llmmend/retry`: `classifyError(error)` sorts a failed model call (an `LlmmendHttpError`, a stream `error` event, a `fetch` error, or an official SDK's API error) into one of eleven kinds with `retryable`, the Provider's `retryAfter` in milliseconds, `status` and the Provider's own `message`. It tells a 429 that means out of credit from a rate limit, and a 400 about prompt length from other bad requests.
- ac96474: New module `llmmend/cost`: `estimateCost(usage, prices)` prices a call's token usage with prices you pass per million tokens (input, cache reads and writes, output, long-context tiers) and returns the cost by part, listing any missing count; `toUsage(raw)` reads the raw `usage` of an Anthropic, OpenAI or Gemini reply without streaming.
- cac91dd: New module `llmmend/prompt`: `safePrompt`, a template tag that escapes each substitution for the tags the template itself uses, so untrusted text can't close `<document>` or open `<instructions>`; `trusted` to insert a built prompt as is; and `escapeTags` for the same escaping without a template.

### Patch Changes

- ac96474: Stream `usage` events leave out a token count the Provider sent as `null` (Anthropic can send `cache_creation_input_tokens: null`) instead of passing the `null` through. The four stream adapters now share one usage conversion with `toUsage`.

## 0.5.0

### Minor Changes

- cafb849: New option `coerce` on `extractJson`, `extractJsonAsync`, `extractAllJson` and `streamJson`, and for tool arguments on `collectText` and `streamToolCalls`: when the schema rejects a value, it tries the type slips models make (`"42"` ↔ `42`, `"true"` ↔ `true`, `"null"` → `null`) at the paths the schema's issues name, and keeps a change only when the issue at that path goes away. Each change is a new Issue `coerced` with the path and the types before and after. It works the same with Zod, Valibot and ArkType: only the issues' paths are read, never their messages.
- 9456c5e: JSON errors say where: `LlmmendJsonError` gains `at`, `line` and `column` (from 1, counting characters, so an emoji is one), and its message gives the line, the column and a one-line snippet of about 40 characters with a `^` under the place, newlines shown as `⏎`. `extractJson` failures `unparseable` and `truncated` gain `at`.
- db983f6: `done` carries `responseId`, the Provider's id of the response (Anthropic `msg_…`, Chat Completions `chatcmpl-…`, Responses `resp_…` for `previous_response_id`, Gemini `responseId`), and `collectText` and `streamToolCalls` return it. In OpenAI Responses streams, `tool_call_start` and `reasoning_signature` carry `itemId` (`fc_…`, `rs_…`), so a client that keeps the history itself can send those items back.
- f8612f8: Add `sseResponse` and `createSSEStream` to `llmmend/sse`, for serving server-sent events: an async iterable of events (`{ data, event?, id?, retry? }`) or plain values (sent as JSON) becomes a `text/event-stream` `Response` or byte stream, with optional keep-alive comments. A client that goes away calls `return()` on the source, so `sseResponse(streamLlm(upstream))` also stops the upstream request.
- 6de73df: New option `tokenizer` on `estimateTokens`, `chunkText`, `chunkDocuments` and `truncateToTokens`: `'o200k'` (the default, unchanged), `'claude'` or `'gemini'`. Each preset has its own weights per kind of character, fitted to exact Claude and Gemini counts of the calibration corpus, and is within ±15 % on every 1,000-character window of it, like `'o200k'`. This replaces the advice to divide the budget by 1.5 for Claude.

## 0.4.0

### Minor Changes

- 8b54dc4: Chunks in `markdown` mode carry `headings`: the path of headings in effect where the chunk's own text starts, for search context (ATX and setext headings, none from code fences; only the markers removed). New `chunkDocuments` splits several documents in one call and gives every chunk its document's position (`doc`) and typed `metadata`.
- f59de27: Add `extractCodeBlocks` to `llmmend/json`: every fenced code block in a Reply with its language, info string, content, position and `complete: false` for a block cut off at the end; the `lang` filter matches common aliases (`ts`/`typescript`, `sh`/`bash`…). `extractTag` now skips code with the same fence scanner.

### Patch Changes

- 380f4f6: `streamJson` parses incrementally: a text event costs about its own length instead of re-parsing the whole Reply, so a Reply of 100 kB streams in tens of milliseconds instead of seconds to minutes. Every yielded item is the same as before; successive `partial` values now share the parts that ended, so treat them as read-only. A cut-off `-Inf` (for `-Infinity`) is now a Truncation, like a cut-off `tru`, instead of failing the value. The parser grows by about 0.35 kB (min+brotli), `streamJson` by about 1 kB.

## 0.3.0

### Minor Changes

- c242a79: Add `extractTag` and `extractAllTags` to `llmmend/json`, for answers in tags such as `<answer>…</answer>`: attributes are returned, the closing tag may differ in case (new Issue `tag_case_mismatch`), nested tags of the same name match by depth, tags inside fenced code blocks don't count, and a tag cut off after the last closed one is `truncated` with its text so far.
- d01f260: Add `streamToolCalls` to `llmmend/sse`, for UIs that render a tool call while the model writes it: yields each piece of text and each change of a call's Partial value (an unfinished number never shows; with `tools`, `partial` is typed as a deep partial of the tool schema's input, by name), then one final item with what `collectText` returns.
- f18797f: `collectText` returns the answer's tool calls in `toolCalls`, in Block order: arguments get syntax Repair and come as `args`, cut-off arguments are reported as `truncated` and never completed, and with `tools` (a Standard Schema per tool name) each call is validated, typed by its name, and a call to an unlisted tool fails with `unknown_tool`. `tool_call_start` carries `custom: true` for OpenAI Responses custom tools, whose free-form input `toolCalls` returns as `input`.

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
