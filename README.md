**English** | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/README.zh-CN.md) | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/README.ru.md)

# llmmend

[![npm](https://img.shields.io/npm/v/llmmend)](https://www.npmjs.com/package/llmmend)
[![downloads](https://img.shields.io/npm/dm/llmmend)](https://www.npmjs.com/package/llmmend)
[![GitHub stars](https://img.shields.io/github/stars/nightlightmare/llmmend)](https://github.com/nightlightmare/llmmend/stargazers)
[![bundle size](https://img.shields.io/bundlejs/size/llmmend)](https://bundlejs.com/?q=llmmend)
[![CI](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml/badge.svg)](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnightlightmare%2Fllmmend%2Fbadges%2Fcoverage.json)](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/llmmend#provenance)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/llmmend?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/llmmend)](https://github.com/nightlightmare/llmmend/blob/main/LICENSE)

**Fix what your LLM returns.** Extract and repair JSON, parse streaming responses from any provider, split text into token-sized chunks. Zero dependencies. Works in Node, Bun, Deno, browsers and edge runtimes.

```bash
npm i llmmend
```

Try it in the browser, nothing leaves your machine: [playground](https://nightlightmare.github.io/llmmend/) for JSON repair, SSE streams and chunking. Ready-to-run [examples](https://github.com/nightlightmare/llmmend/tree/main/examples) for Next.js, Hono, Cloudflare Workers and Deno.

## Why

Every LLM project ends up writing the same fragile code: regexes to strip ` ```json ` fences, a hand-rolled SSE parser that breaks on a split UTF-8 byte. `llmmend` is that code, done once and tested against a corpus of broken model replies and recorded provider streams.

## JSON from messy replies

```ts
import { extractJson } from 'llmmend/json'
import { z } from 'zod'

const reply = `Sure! Here's the data:
\`\`\`json
{ name: 'Ada', skills: ['math', 'code',], active: True
` // cut off by max_tokens

const res = extractJson(reply, {
  schema: z.object({ name: z.string(), skills: z.array(z.string()), active: z.boolean() }),
})

if (res.ok) {
  console.log(res.value) // { name: 'Ada', skills: ['math', 'code'], active: true }, fully typed
  console.log(res.issues.map((issue) => issue.code))
  // stripped_wrapper, unquoted_key, single_quotes, trailing_comma, python_literal, truncated_closed
}
```

Works with any [Standard Schema](https://standardschema.dev) library: zod, valibot, arktype.

## One stream format for every provider

```ts
import { streamLlm } from 'llmmend/sse'

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: 'Write a haiku about the sea.' }],
  }),
})

for await (const ev of streamLlm(res)) {
  switch (ev.type) {
    case 'text':
      process.stdout.write(ev.text)
      break
    case 'tool_call_start':
      console.log('\ncalling', ev.name)
      break
    case 'tool_call_delta':
      process.stdout.write(ev.argsDelta)
      break
    case 'done':
      console.log('\nstop:', ev.stopReason)
      break
    default:
      break // new event types may be added in minor releases
  }
}
```

Supports Anthropic, Google Gemini, the OpenAI Responses API and OpenAI-compatible Chat Completions APIs (OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio). The format is detected from the stream; pass `{ provider }` to skip that. Bring your own format with a 10-line adapter. `done` always arrives exactly once, last; mid-stream provider errors arrive as an `error` event, not an exception.

> **OpenAI usage:** pass `stream_options: { include_usage: true }` in the request, or OpenAI won't send token usage at all.

## Text that fits the context window

```ts
import { chunkText, truncateToTokens } from 'llmmend/chunk'

const doc = '# Guide\n\nWhat it does.\n\n## Install\n\nRun the installer, then restart.\n'

for (const chunk of chunkText(doc, { maxTokens: 500, overlap: 50, mode: 'markdown' })) {
  console.log(chunk.index, chunk.start, chunk.end, chunk.tokens) // 0 0 69 19: the guide fits in one chunk
}

truncateToTokens('A title far too long for the card it has to fit on', 8, { ellipsis: '…' }) // 'A title far too long for the …'
```

`chunkText` cuts at the coarsest separator that fits: paragraphs, then lines, sentences, words, and grapheme clusters as a last resort. Every chunk is a slice of the text with its `start` and `end`, and joining them gives the text back. In `markdown` mode chunks start at headings, and code fences and tables stay whole when they fit.

Tokens are estimated without a vocabulary. The estimate minus the real count:

| Text            | `o200k_base` (OpenAI) | Gemini 3.8 Flash | Claude Opus 5.5 |
| --------------- | --------------------- | ---------------- | --------------- |
| English         | +5 %                  | −5 %             | −33 %           |
| Russian         | +5 %                  | −2 %             | −34 %           |
| Chinese         | −1 %                  | +2 %             | −34 %           |
| Japanese        | −11 %                 | +22 %            | −25 %           |
| Korean          | −5 %                  | +3 %             | −46 %           |
| Code            | −2 %                  | −15 %            | −36 %           |
| Chat with emoji | −5 %                  | −9 %             | −38 %           |

Claude's tokenizer produces about 1.5× as many tokens: for Claude, divide the budget by 1.5 or pass an exact `countTokens`.

## Compared with other packages

|                                                             | llmmend    | jsonrepair | partial-json | best-effort-json-parser | eventsource-parser | ai       | @langchain/textsplitters |
| ----------------------------------------------------------- | ---------- | ---------- | ------------ | ----------------------- | ------------------ | -------- | ------------------------ |
| **JSON**                                                    |            |            |              |                         |                    |          |                          |
| Finds JSON in prose, code fences and `<think>` blocks       | Yes        | Partly ¹   | No           | Partly ²                |                    | No       |                          |
| Repairs quotes, comments, trailing commas, Python constants | Yes        | Yes        | No           | Partly ³                |                    | No       |                          |
| Reads truncated JSON as a partial value                     | Yes        | Yes        | Yes          | Yes                     |                    | Yes      |                          |
| Reports what was repaired                                   | Yes        | No         | No           | No                      |                    | Partly ⁴ |                          |
| Validates with Zod, Valibot, ArkType (Standard Schema)      | Yes        | No         | No           | No                      |                    | Partly ⁵ |                          |
| **Streams**                                                 |            |            |              |                         |                    |          |                          |
| Parses SSE                                                  | Yes        |            |              |                         | Yes                | Yes      |                          |
| One event format for Anthropic, OpenAI, Gemini, any `fetch` | Yes        |            |              |                         | No                 | Partly ⁶ |                          |
| Detects the provider                                        | Yes        |            |              |                         | No                 | No       |                          |
| Partial JSON values while the reply streams                 | Yes        |            |              |                         | No                 | Partly ⁶ |                          |
| **Chunks**                                                  |            |            |              |                         |                    |          |                          |
| Token-sized chunks without downloading a tokenizer          | Yes        |            |              |                         |                    |          | Partly ⁷                 |
| Keeps code fences and tables whole when they fit            | Yes        |            |              |                         |                    |          | Partly ⁸                 |
| Overlap between chunks                                      | Yes        |            |              |                         |                    |          | Yes                      |
| **Package**                                                 |            |            |              |                         |                    |          |                          |
| Dependencies                                                | 0          | 0          | 0            | 0                       | 0                  | 3        | 1 + `@langchain/core`    |
| Size of one function, min+brotli                            | 0.9–3.6 kB | 2.7 kB     | 1.4 kB       | 1.7 kB                  | 1.6 kB             | 31–81 kB | 106 kB                   |

1. Only a reply that is all one fence: text around the fence turns the result into an array of strings.
2. Fenced JSON only: for JSON inside a sentence it returns the first word.
3. A `//` comment breaks the rest of the object.
4. `parsePartialJson` says `repaired-parse`, not what changed.
5. Inside its own model calls (`generateObject`), not for a reply you already have.
6. Through its own provider packages, only for requests the SDK makes.
7. `TokenTextSplitter` fetches the tokenizer from `tiktoken.pages.dev` at run time; `RecursiveCharacterTextSplitter` counts characters.
8. In our test of 42 chunk sizes, its Markdown splitter cut a block that fit in 16.

Checked on 2026-10-24 with jsonrepair 3.15.0, partial-json 0.1.7, best-effort-json-parser 1.5.1, eventsource-parser 4.1.2, ai 7.0.152, @langchain/textsplitters 1.0.2. Sizes: one import bundled with rolldown, minified and brotli-compressed; for llmmend, `parseSSE` to `streamText`, for ai, `parsePartialJson` to `streamText`. An empty cell means the package does not try.

## API

| Import          | Functions                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `llmmend/json`  | `extractJson`, `extractJsonAsync`, `extractJsonOrThrow`, `extractAllJson`, `repairJson`, `parsePartialJson` |
| `llmmend/sse`   | `parseSSE`, `streamLlm`, `streamText`, `collectText`, `streamJson`                                          |
| `llmmend/chunk` | `chunkText`, `estimateTokens`, `truncateToTokens`                                                           |

Everything is also re-exported from the root: `import { extractJson } from 'llmmend'` stays tree-shakeable.

Full reference: [docs/api.md](https://github.com/nightlightmare/llmmend/blob/main/docs/api.md)

For AI coding assistants: [llms.txt](https://github.com/nightlightmare/llmmend/blob/main/llms.txt) and [llms-full.txt](https://github.com/nightlightmare/llmmend/blob/main/llms-full.txt), also shipped in the package.

## Size

| Module          | min+brotli                         |
| --------------- | ---------------------------------- |
| `llmmend/json`  | ~3.5 kB                            |
| `llmmend/sse`   | ~3.6 kB (`parseSSE` alone ~0.9 kB) |
| `llmmend/chunk` | ~1.5 kB                            |

## Contributing

Found a model reply that `llmmend` can't handle? [Open an issue](https://github.com/nightlightmare/llmmend/issues/new?template=broken-reply.md) with the raw text: it becomes a test fixture.

## License

MIT © nightlightmare
