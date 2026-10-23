# llmmend

## 0.1.1

### Patch Changes

- Show the English README on npmjs.com: 0.1.0 shipped with the Chinese translation as the package README. The translations moved to `docs/`.

## 0.1.0

### Minor Changes

- First release.
  
  - `llmmend/json`: `extractJson`, `extractJsonAsync`, `extractJsonOrThrow` and `extractAllJson` find JSON in a model reply, repair it (trailing commas, single quotes, unquoted keys, Python literals, `NaN`, raw control characters, comments, cut-off values) and validate it with any Standard Schema; `repairJson` repairs bare JSON text; `parsePartialJson` reads JSON that is still streaming in.
  - `llmmend/sse`: `parseSSE`, a WHATWG-compliant server-sent events parser; `streamLlm`, `streamText` and `collectText` turn Anthropic and OpenAI-compatible Chat Completions streams into one sequence of LLM events, with `done` exactly once and last.
  - Zero dependencies, ESM and CommonJS, TypeScript types; tested on Node 20+, Bun, Deno, WebKit and Cloudflare Workers.
