**English** | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/README.zh-CN.md) | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/README.ru.md)

# 🩹 llmmend

[![npm](https://img.shields.io/npm/v/llmmend)](https://www.npmjs.com/package/llmmend)
[![bundle size](https://img.shields.io/bundlejs/size/llmmend)](https://bundlejs.com/?q=llmmend)
[![CI](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml/badge.svg)](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/llmmend#provenance)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/llmmend?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/llmmend)](https://github.com/nightlightmare/llmmend/blob/main/LICENSE)

**Fix what your LLM returns.** Extract and repair JSON, parse streaming responses from any provider. Zero dependencies. Works in Node, Bun, Deno, browsers and edge runtimes.

```bash
npm i llmmend
```

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

for await (const ev of streamLlm(res, { provider: 'anthropic' })) {
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

Supports Anthropic and OpenAI-compatible Chat Completions APIs (OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio). Bring your own format with a 10-line adapter. `done` always arrives exactly once, last; mid-stream provider errors arrive as an `error` event, not an exception.

> **OpenAI usage:** pass `stream_options: { include_usage: true }` in the request, or OpenAI won't send token usage at all.

## API

| Import         | Functions                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `llmmend/json` | `extractJson`, `extractJsonAsync`, `extractJsonOrThrow`, `extractAllJson`, `repairJson`, `parsePartialJson` |
| `llmmend/sse`  | `parseSSE`, `streamLlm`, `streamText`, `collectText`, `streamJson`                                          |

Everything is also re-exported from the root: `import { extractJson } from 'llmmend'` stays tree-shakeable.

Full reference: [docs/api.md](https://github.com/nightlightmare/llmmend/blob/main/docs/api.md)

## Size

| Module         | min+brotli                         |
| -------------- | ---------------------------------- |
| `llmmend/json` | ~3.5 kB                            |
| `llmmend/sse`  | ~2.4 kB (`parseSSE` alone ~0.9 kB) |

## Contributing

Found a model reply that `llmmend` can't handle? [Open an issue](https://github.com/nightlightmare/llmmend/issues/new?template=broken-reply.md) with the raw text: it becomes a test fixture.

## License

MIT © nightlightmare
