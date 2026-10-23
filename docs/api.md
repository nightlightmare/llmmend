**English** | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/api.zh-CN.md) | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/api.ru.md)

# API reference

`llmmend` has two modules. Import from the module, or from the root: both are tree-shakeable.

```ts
import { extractJson } from 'llmmend/json'
import { streamLlm } from 'llmmend/sse'
import { collectText, repairJson } from 'llmmend'
```

A few words used below:

- **Reply**: the full text a model returned, with whatever surrounds the JSON.
- **Candidate**: an object or array found in a Reply. A bare string or number is never a Candidate.
- **Issue**: a record of one thing llmmend fixed or skipped to get the value.
- **Block**: one part of a streamed answer (text, reasoning or a tool call), numbered from 0.

## llmmend/json

### extractJson

```ts
import { extractJson } from 'llmmend/json'

const res = extractJson('Here you go: {"city": "Paris", "temp": 21,}')
if (res.ok) console.log(res.value, res.issues)
else console.log(res.error)
```

`extractJson(text, options?)` finds the JSON in a Reply, repairs it and, given a schema, validates it. It never throws on bad input.

Options:

| Option   | Values                                            | Default  | Meaning                                                                                                                                         |
| -------- | ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | any [Standard Schema](https://standardschema.dev) | none     | Validate the value; `value` gets the schema's output type.                                                                                      |
| `pick`   | `'first'`, `'last'`, `'largest'`                  | `'last'` | Which Candidate to use when the Reply has several.                                                                                              |
| `repair` | `'full'`, `'syntax'`, `'none'`                    | `'full'` | `'full'` fixes syntax and closes a cut-off value; `'syntax'` fixes syntax but reports a cut-off value as `truncated`; `'none'` parses strictly. |
| `expect` | `'object'`, `'array'`, `'any'`                    | `'any'`  | Only consider objects, or only arrays.                                                                                                          |

The result is one of:

- `{ ok: true, value, repaired, issues, raw }`: `repaired` is true when anything beyond stripping the surrounding text was fixed; `raw` is the Candidate's text.
- `{ ok: false, error: 'schema_mismatch', issues, schemaIssues, value }`: the JSON parsed but the schema rejected it. `schemaIssues` come from the schema, so you can send them back to the model.
- `{ ok: false, error, issues }` with `error` one of `not_found`, `unparseable`, `truncated`, `max_depth`.

If the Reply cuts off an object or array after the last complete Candidate, the cut-off one is the real answer: with `repair: 'syntax'` the result is `truncated`, never an earlier Candidate (often a format example from the prompt).

```ts
import { extractJson } from 'llmmend/json'

const reply = 'Format: {"x": 0}. Answer: {"x": 1, "y": [1, 2'

extractJson(reply) // ok, value { x: 1, y: [1, 2] }, issues include truncated_closed
extractJson(reply, { repair: 'syntax' }) // { ok: false, error: 'truncated', issues: [] }
```

Nesting deeper than 512 levels gives `max_depth`.

### extractJsonAsync

```ts
import { extractJsonAsync } from 'llmmend/json'
import { z } from 'zod'

const schema = z.object({ user: z.string() }).refine(async (v) => v.user !== 'admin')
const res = await extractJsonAsync('{"user": "ada"}', { schema })
```

The same as `extractJson`, for schemas that validate asynchronously. `extractJson` throws `LlmmendError` with code `async_schema` when it meets one.

### extractJsonOrThrow

```ts
import { extractJsonOrThrow, LlmmendJsonError } from 'llmmend/json'

try {
  const value = extractJsonOrThrow('no JSON here')
  console.log(value)
} catch (error) {
  if (error instanceof LlmmendJsonError) console.log(error.code) // 'not_found'
}
```

Returns the value or throws `LlmmendJsonError`, whose `code` is the `error` above, with `issues` and, for `schema_mismatch`, `schemaIssues`.

### extractAllJson

```ts
import { extractAllJson } from 'llmmend/json'

extractAllJson('First {"a": 1}, then [2, 3] and {"b": 2}') // [{ a: 1 }, [2, 3], { b: 2 }]
```

Every Candidate in the Reply, in order. Takes the same options except `pick`; with a schema, only the values that pass it are returned.

### repairJson

```ts
import { repairJson } from 'llmmend/json'

const { json, issues } = repairJson("{'a': NaN, b: None, // note\n}")
console.log(json) // {"a":null,"b":null}
console.log(issues.map((issue) => issue.code))
```

Repairs JSON text and returns valid JSON as a string, plus the Issues fixed. The whole text must be one value: use `extractJson` for a Reply with text around it. Throws `LlmmendJsonError` when the text cannot be repaired.

### parsePartialJson

```ts
import { parsePartialJson } from 'llmmend/json'

parsePartialJson('{"title": "Hel') // { value: { title: 'Hel' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 4') // { value: { title: 'Hello' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 42}') // { value: { title: 'Hello', count: 42 }, complete: true }
```

Reads JSON that is still arriving, for progressive UIs. It skips the preamble and code fence of the Reply and returns the first object or array as far as it goes:

- an unfinished string is shown as is, so it grows as text arrives;
- an unfinished number or literal, and a key without a value, are left out until they finish;
- a value once shown as finished never changes later.

`complete` turns true when the closing bracket arrives. `value` is `undefined` until an object or array starts. It never throws.

### Issues

Every result lists what was done to the Reply, in order.

| `code`                   | Extra field | What was fixed                                                                      |
| ------------------------ | ----------- | ----------------------------------------------------------------------------------- |
| `stripped_wrapper`       | `detail`    | Text or a code fence around the JSON was skipped, e.g. `'code fence, text before'`. |
| `trailing_comma`         | `at`        | A comma before `}` or `]`.                                                          |
| `single_quotes`          | `at`        | A string in single quotes.                                                          |
| `unquoted_key`           | `at`        | A key without quotes.                                                               |
| `python_literal`         | `at`        | `True`, `False` or `None`.                                                          |
| `non_finite_number`      | `at`        | `NaN` or `Infinity`, replaced with `null`.                                          |
| `unescaped_control_char` | `at`        | A raw newline or tab inside a string.                                               |
| `comment_removed`        | `at`        | A `//` or `/* */` comment.                                                          |
| `truncated_closed`       | `closed`    | A cut-off value was closed with the brackets in `closed`.                           |

`at` is the position in the text.

## llmmend/sse

### parseSSE

```ts
import { parseSSE } from 'llmmend/sse'

const res = await fetch('https://example.com/events')
for await (const event of parseSSE(res.body ?? new ReadableStream())) {
  console.log(event.event, event.data, event.id)
}
```

A [WHATWG-compliant](https://html.spec.whatwg.org/multipage/server-sent-events.html) server-sent events parser. It takes a `ReadableStream<Uint8Array>` or an async iterable of bytes or strings, and yields `{ event, data, id?, retry? }`:

- `event` is `'message'` when the event names none;
- `data` lines are joined with `\n`;
- `id` and `retry` persist across events, as the spec requires.

Chunks may split lines and UTF-8 characters anywhere. CRLF, LF and CR line endings and a leading BOM are handled. An event still incomplete when the stream ends is dropped. The `signal` option cancels the source and makes the loop throw an `AbortError`; leaving the loop early cancels the source too.

### streamLlm

```ts
import { streamLlm } from 'llmmend/sse'

const res = await fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen2.5:3b',
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: 'user', content: 'Hi!' }],
  }),
})

for await (const ev of streamLlm(res, { provider: 'openai' })) {
  if (ev.type === 'text') process.stdout.write(ev.text)
  if (ev.type === 'usage') console.log('\ntokens in:', ev.inputTokens, 'out:', ev.outputTokens)
}
```

`streamLlm(source, { provider, signal? })` turns a Provider's stream into one sequence of LLM events. `source` is a `fetch` `Response` or its body.

Providers:

- `'anthropic'`: the Anthropic Messages API.
- `'openai'`: OpenAI Chat Completions and the APIs that copy its format: OpenRouter, Groq, Ollama, DeepSeek, vLLM, LM Studio. Only the first choice is read; `n > 1` is not supported. OpenAI sends token usage only with `stream_options: { include_usage: true }`.
- a custom adapter, see below.

### LLM events

```ts
import type { LlmEvent } from 'llmmend/sse'

function show(ev: LlmEvent): string {
  switch (ev.type) {
    case 'text':
      return ev.text
    case 'reasoning':
      return ev.text
    case 'tool_call_start':
      return `${ev.name}(`
    case 'tool_call_delta':
      return ev.argsDelta
    case 'done':
      return `[${ev.stopReason}]`
    default:
      return ''
  }
}
```

| `type`                | Fields                                                                                       | Meaning                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `text`                | `index`, `text`                                                                              | A piece of the answer's text.                                                                                  |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | A piece of reasoning. `redacted` holds Anthropic's encrypted `redacted_thinking` data; send it back unchanged. |
| `reasoning_signature` | `index`, `signature`                                                                         | Anthropic's thinking signature, needed to send thinking back during tool use.                                  |
| `tool_call_start`     | `index`, `id`, `name`                                                                        | A tool call begins.                                                                                            |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | A piece of the tool call's JSON arguments; join them in order.                                                 |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | Token counts so far.                                                                                           |
| `done`                | `stopReason`, `rawStopReason?`                                                               | The end of the stream.                                                                                         |
| `error`               | `message`, `raw`                                                                             | The Provider reported an error mid-stream.                                                                     |
| `other`               | `raw`                                                                                        | An event the adapter does not know, as parsed by `parseSSE`.                                                   |

`index` is the Block: text, reasoning and each tool call get their own number, the same way for every Provider. `tool_call_delta` always comes after the `tool_call_start` with the same `index`.

`usage` is a snapshot of the totals: use the latest one, never add them up. `inputTokens` always includes cached tokens.

Stop reasons:

| `stopReason`    | Anthropic                                     | OpenAI                        |
| --------------- | --------------------------------------------- | ----------------------------- |
| `end`           | `end_turn`                                    | `stop`                        |
| `max_tokens`    | `max_tokens`, `model_context_window_exceeded` | `length`                      |
| `tool_use`      | `tool_use`                                    | `tool_calls`, `function_call` |
| `stop_sequence` | `stop_sequence`                               |                               |
| `refused`       | `refusal`                                     | `content_filter`              |
| `paused`        | `pause_turn`                                  |                               |
| `error`         | an `error` event                              | an `error` payload            |
| `unknown`       | anything else, or no final event              | anything else, or no `[DONE]` |

`rawStopReason` keeps the Provider's own string.

Errors and the end of the stream:

- A `Response` whose status is not 2xx throws `LlmmendHttpError` with `status`, `headers` and the response `body` before any event.
- `done` arrives exactly once and always last. A Provider error mid-stream arrives as `error`, then `done` with `stopReason: 'error'`; nothing is thrown. A stream that ends without a final event gets `done` with `stopReason: 'unknown'`.
- Aborting through `signal` throws an `AbortError` and cancels the source.

New event types and stop reasons may be added in minor releases: keep a `default` branch in your `switch`.

### streamText

```ts
import { streamText } from 'llmmend/sse'

const res = await fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen2.5:3b',
    stream: true,
    messages: [{ role: 'user', content: 'Hi!' }],
  }),
})
for await (const text of streamText(res, { provider: 'openai' })) process.stdout.write(text)
```

Yields only the answer's text. Use `collectText` or `streamLlm` to learn why it stopped.

### collectText

```ts
import { collectText } from 'llmmend/sse'

const res = await fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen2.5:3b',
    stream: true,
    messages: [{ role: 'user', content: 'Hi!' }],
  }),
})
const { text, stopReason, usage } = await collectText(res, { provider: 'openai' })
console.log(text, stopReason, usage?.outputTokens)
```

Reads the whole stream and returns `{ text, stopReason, usage? }`, with the last usage snapshot.

### Custom Provider adapters

```ts
import { type ProviderAdapter, streamLlm } from 'llmmend/sse'

// A Provider that sends {"t": "..."} pieces and {"end": true} at the end.
const myProvider: ProviderAdapter = {
  name: 'my-provider',
  create() {
    const index = 0
    return (event) => {
      const data = JSON.parse(event.data) as { t?: string; end?: boolean }
      if (data.end) return [{ type: 'done', stopReason: 'end' }]
      return data.t ? [{ type: 'text', index, text: data.t }] : []
    }
  },
}

const res = await fetch('https://example.com/stream')
for await (const ev of streamLlm(res, { provider: myProvider })) console.log(ev)
```

An adapter turns each parsed SSE event into zero or more LLM events. `create()` runs once per stream, so keep per-stream state in its closure. `streamLlm` adds the guarantees on top: it stops after `done`, follows `error` with `done`, and adds `done` if the stream ends without one.

## Errors

```ts
import { LlmmendError, LlmmendHttpError } from 'llmmend'

function describe(error: unknown): string {
  if (error instanceof LlmmendHttpError) return `HTTP ${error.status}: ${error.body}`
  if (error instanceof LlmmendError) return error.code
  return String(error)
}
```

Every error llmmend throws extends `LlmmendError`, which has a `code`:

| Class              | `code`                                                                  | Extra fields                |
| ------------------ | ----------------------------------------------------------------------- | --------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`   |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body` |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                             |

Each class has its own `name`, so errors can be told apart without `instanceof` when two copies of the package are loaded.

## Versioning

The unions you `switch` on (`Issue['code']`, `ExtractError`, `StopReason`, `LlmEvent['type']`, `LlmmendError['code']`) are closed, so TypeScript checks your `switch`. Adding a member is a minor release; removing or renaming one is a major release. Keep a `default` branch.
