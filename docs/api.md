**English** | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/api.zh-CN.md) | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/api.ru.md)

# API reference

`llmmend` has three modules. Import from the module, or from the root: both are tree-shakeable.

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

| Option   | Values                                            | Default  | Meaning                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | any [Standard Schema](https://standardschema.dev) | none     | Validate the value; `value` gets the schema's output type.                                                                                                                                                              |
| `pick`   | `'first'`, `'last'`, `'largest'`                  | `'last'` | Which Candidate to use when the Reply has several.                                                                                                                                                                      |
| `repair` | `'full'`, `'syntax'`, `'none'`                    | `'full'` | `'full'` fixes syntax and closes a cut-off value; `'syntax'` fixes syntax but reports a cut-off value as `truncated`; `'none'` parses strictly.                                                                         |
| `expect` | `'object'`, `'array'`, `'any'`                    | `'any'`  | Only consider objects, or only arrays.                                                                                                                                                                                  |
| `coerce` | `true`, `false`                                   | `false`  | With a schema: when it rejects the value, try `"42"` ↔ `42`, `"true"` ↔ `true` and `"null"` → `null` at the paths it names; a change stays only if the issue at that path goes away. Each change is an Issue `coerced`. |

The result is one of:

- `{ ok: true, value, repaired, issues, raw }`: `repaired` is true when anything beyond stripping the surrounding text was fixed; `raw` is the Candidate's text.
- `{ ok: false, error: 'schema_mismatch', issues, schemaIssues, value }`: the JSON parsed but the schema rejected it. `schemaIssues` come from the schema, so you can send them back to the model.
- `{ ok: false, error, issues, at? }` with `error` one of `not_found`, `unparseable`, `truncated`, `max_depth`; for `unparseable` and `truncated`, `at` is where parsing failed in the Reply.

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

Returns the value or throws `LlmmendJsonError`, whose `code` is the `error` above, with `issues` and, for `schema_mismatch`, `schemaIssues`. When the result has `at`, the error has it too, with `line` and `column` (from 1, counting characters), and its message shows the place: newlines in the snippet show as `⏎`, so it stays on one line with the `^` under it.

```text
Cannot extract JSON: unparseable at line 5, column 8
…⏎{⏎  "a": 1,⏎  "b": x⏎}
                     ^
```

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

### extractTag

```ts
import { extractTag } from 'llmmend/json'

const reply = 'Format: <answer>X</answer>\n<thinking>…</thinking>\n<answer lang="en">Paris</answer>'

const res = extractTag(reply, 'answer')
if (res.ok) console.log(res.value, res.attributes.lang) // 'Paris', 'en'
else if (res.error === 'truncated') console.log(res.partial) // the tag was cut off: its text so far
else console.log(res.error) // 'not_found'
```

`extractTag(text, name, { pick? })` finds a tag such as `<answer>…</answer>` in a Reply and returns its text, trimmed at its edges. It never throws. The result is one of:

- `{ ok: true, value, attributes, issues }`: `attributes` of the opening tag (a bare one is `''`); `issues` has `tag_case_mismatch` when the closing tag differs in case (`<Answer>…</answer>`).
- `{ ok: false, error: 'truncated', partial }`: the tag opened after the last closed one and the Reply ended first, usually at `max_tokens`; `partial` is its text so far. An earlier closed tag is never returned instead.
- `{ ok: false, error: 'not_found' }`.

`pick` chooses among several closed tags: `'last'` (default, so a format example in the prompt never wins over the answer) or `'first'`. Tags inside fenced code blocks don't count. Nested tags of the same name match by depth, so the outer one wins. The name matches in any case; entities such as `&lt;` are left as they are.

### extractAllTags

```ts
import { extractAllTags } from 'llmmend/json'

const reply = '<step>Read the file</step>\n<step>Fix the bug</step>\n<answer>Done</answer>'
console.log(extractAllTags(reply, 'step').map((t) => t.value)) // ['Read the file', 'Fix the bug']
```

Every closed top-level tag in the Reply, in order, as `{ name, value, attributes, start, end }`; `start` and `end` span the whole tag. With a `name`, only tags of that name (the outermost when they nest). The same rules as `extractTag` apply.

### extractCodeBlocks

````ts
import { extractCodeBlocks } from 'llmmend/json'

const reply =
  'Install:\n```bash\nnpm i llmmend\n```\nThen:\n```typescript title="app.ts"\nextractJson(reply)\n```'

extractCodeBlocks(reply).map((b) => b.lang) // ['bash', 'typescript']
extractCodeBlocks(reply, { lang: 'ts' })[0]?.code // 'extractJson(reply)'
````

`extractCodeBlocks(text, { lang? })` returns every fenced code block in a Reply, in order, as `{ lang, info, code, start, end, complete }`:

- `lang` is the first word of the info string in lower case (`''` without one), and `info` the whole string (`typescript title="app.ts"`).
- `code` is the content as written, without the line breaks next to the fences; `start` and `end` span the block from the opening fence line to the closing one.
- `complete: false` marks a block the Reply ends inside, usually at `max_tokens`: decide whether half a file is any use.

The `lang` filter ignores case and matches common aliases: `ts`/`typescript`, `js`/`javascript`, `py`/`python`, `sh`/`bash`/`shell`/`zsh`, `yml`/`yaml`, `md`/`markdown`. Fences are ` ``` ` or `~~~`, closed only by the same character at least as long, so a block can show another block inside a longer fence. Indented code blocks and ` ```inline``` ` on one line don't count. `extractTag` uses the same rules to skip tags inside code.

### Issues

Every result lists what was done to the Reply, in order.

| `code`                   | Extra field          | What was fixed                                                                                                  |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `stripped_wrapper`       | `detail`             | Text or a code fence around the JSON was skipped, e.g. `'code fence, text before'`.                             |
| `trailing_comma`         | `at`                 | A comma before `}` or `]`.                                                                                      |
| `single_quotes`          | `at`                 | A string in single quotes.                                                                                      |
| `unquoted_key`           | `at`                 | A key without quotes.                                                                                           |
| `python_literal`         | `at`                 | `True`, `False` or `None`.                                                                                      |
| `non_finite_number`      | `at`                 | `NaN` or `Infinity`, replaced with `null`.                                                                      |
| `unescaped_control_char` | `at`                 | A raw newline or tab inside a string.                                                                           |
| `comment_removed`        | `at`                 | A `//` or `/* */` comment.                                                                                      |
| `truncated_closed`       | `closed`             | A cut-off value was closed with the brackets in `closed`.                                                       |
| `tag_case_mismatch`      | `at`                 | `extractTag`: the closing tag differs in case from the opening one.                                             |
| `coerced`                | `path`, `from`, `to` | With `coerce`: the value at `path` changed type, from `from` to `to` (`string`, `number`, `boolean` or `null`). |

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

`streamLlm(source, { provider?, signal? })` turns a Provider's stream into one sequence of LLM events. `source` is a `fetch` `Response` or its body.

Providers:

- `'auto'` (the default): picks the adapter from the first event that shows the format (`message_*` events: Anthropic; `response.*`: OpenAI Responses; `choices`: Chat Completions; `candidates`: Gemini). Undecided events such as `ping` are held back, at most 20, and replayed once the format is clear; an error payload before the answer arrives as `error` in any of these shapes. A stream that never shows its format ends with `done { stopReason: 'unknown' }`; 20 undecided events throw `LlmmendError` with code `unknown_provider`. Pass a Provider to skip the detection.
- `'anthropic'`: the Anthropic Messages API.
- `'openai'`: OpenAI Chat Completions and the APIs that copy its format: OpenRouter, Groq, Ollama, DeepSeek, vLLM, LM Studio. Only the first choice is read; `n > 1` is not supported. OpenAI sends token usage only with `stream_options: { include_usage: true }`.
- `'openai-responses'`: the OpenAI Responses API (also served by Ollama at `/v1/responses`). Each output item is one Block, numbered by `output_index`; reasoning summaries are `reasoning`, and `encrypted_content` (with `include: ['reasoning.encrypted_content']`) is a `reasoning_signature` to send back with that Block. `function_call` and `custom_tool_call` items are tool calls; built-in tools such as web search arrive as `other`. Stop reasons: `response.completed` is `end` (`tool_use` after tool calls, `refused` after a refusal), `response.incomplete` maps its reason (`max_output_tokens` → `max_tokens`, `content_filter` → `refused`), `response.failed` is `error`.
- `'gemini'`: Google Gemini `streamGenerateContent` (`?alt=sse`). Only the first candidate is read. A new Block starts whenever the kind of part changes (thought ↔ text), and every function call is its own Block, so Blocks follow Gemini's part order. Function calls arrive whole: `tool_call_start`, then one `tool_call_delta`.
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

| `type`                | Fields                                                                                       | Meaning                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | `index`, `text`                                                                              | A piece of the answer's text.                                                                                                                                                                                                                                 |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | A piece of reasoning. `redacted` holds Anthropic's encrypted `redacted_thinking` data; send it back unchanged.                                                                                                                                                |
| `reasoning_signature` | `index`, `signature`, `itemId?`                                                              | Data to send back unchanged with Block `index` when you continue the conversation: Anthropic’s thinking signature, or Gemini’s `thoughtSignature`, which can sit on any part (often a function call). `itemId`: the OpenAI Responses reasoning item (`rs_…`). |
| `tool_call_start`     | `index`, `id`, `name`, `custom?`, `itemId?`                                                  | A tool call begins. `custom: true`: an OpenAI Responses custom tool, whose input is free-form text, not JSON. `itemId`: the OpenAI Responses function call item (`fc_…`).                                                                                     |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | A piece of the tool call's JSON arguments; join them in order.                                                                                                                                                                                                |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | Token counts so far.                                                                                                                                                                                                                                          |
| `done`                | `stopReason`, `rawStopReason?`, `responseId?`                                                | The end of the stream. `responseId`: the Provider’s id of the response.                                                                                                                                                                                       |
| `error`               | `message`, `raw`                                                                             | The Provider reported an error mid-stream.                                                                                                                                                                                                                    |
| `other`               | `raw`                                                                                        | An event the adapter does not know, as parsed by `parseSSE`.                                                                                                                                                                                                  |

`index` is the Block: text, reasoning and each tool call get their own number, the same way for every Provider. `tool_call_delta` always comes after the `tool_call_start` with the same `index`.

`usage` is a snapshot of the totals: use the latest one, never add them up. `inputTokens` always includes cached tokens.

Stop reasons:

| `stopReason`    | Anthropic                                     | OpenAI                        | Gemini                                                                                 |
| --------------- | --------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `end`           | `end_turn`                                    | `stop`                        | `STOP`                                                                                 |
| `max_tokens`    | `max_tokens`, `model_context_window_exceeded` | `length`                      | `MAX_TOKENS`                                                                           |
| `tool_use`      | `tool_use`                                    | `tool_calls`, `function_call` | `STOP` after function calls                                                            |
| `stop_sequence` | `stop_sequence`                               |                               |                                                                                        |
| `refused`       | `refusal`                                     | `content_filter`              | `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, …; a blocked prompt |
| `paused`        | `pause_turn`                                  |                               | `CONTINUATION`                                                                         |
| `error`         | an `error` event                              | an `error` payload            | an `error` payload; `MALFORMED_FUNCTION_CALL`, `MISSING_THOUGHT_SIGNATURE`, …          |
| `unknown`       | anything else, or no final event              | anything else, or no `[DONE]` | anything else, or no finish reason                                                     |

`rawStopReason` keeps the Provider's own string. `responseId` is the Provider's id of the response: Anthropic `msg_…`, Chat Completions `chatcmpl-…` (other ids from compatible APIs), Responses `resp_…` (for `previous_response_id`), Gemini `responseId`. It comes with the Provider's own final event, so a `done` that `streamLlm` adds after an error or a stream that broke off has none. With `itemId` on `tool_call_start` and `reasoning_signature`, a client that keeps the Responses history itself can send those items back.

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

Reads the whole stream and returns `{ text, stopReason, usage?, responseId?, toolCalls }`, with the last usage snapshot.

#### Tool calls

```ts
import { collectText } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  get_weather: z.object({ city: z.string(), days: z.number().int().default(1) }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })
const { toolCalls, stopReason } = await collectText(res, { tools })

for (const call of toolCalls) {
  if (!call.ok) console.log(call.name, call.error) // send back as an error tool_result
  else if (!call.custom && call.name === 'get_weather') console.log(call.args.city, call.args.days) // typed by the schema
}
```

`toolCalls` lists the answer's tool calls in Block order. A usable call is `{ ok: true, index, id, name, args, issues }`: the arguments get syntax Repair (as with `repair: 'syntax'`) and `issues` lists what was fixed; empty arguments are `{}`. With `tools` (any Standard Schema per tool name, async ones too), `args` is the schema's output, typed by `name`. With `coerce: true`, arguments the schema rejects are coerced as `extractJson`'s `coerce` does, and each change is in `issues`.

A call that cannot be used is `{ ok: false, index, id, name, error, argsText, issues }`, with the arguments as the model wrote them in `argsText`:

| `error`           | Meaning                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `truncated`       | The arguments were cut off, usually at `stopReason: 'max_tokens'`; never completed, since half a call is unsafe to run. |
| `unparseable`     | Not JSON even after syntax Repair.                                                                                      |
| `max_depth`       | Nested deeper than 512 levels.                                                                                          |
| `schema_mismatch` | The tool's schema rejected the arguments; `schemaIssues` say why.                                                       |
| `unknown_tool`    | `tools` was given and does not list this name.                                                                          |

An OpenAI Responses custom tool takes free-form text instead of JSON: its call is `{ ok: true, custom: true, …, input }` with the text as written, and its schema, if any, validates that text.

### streamJson

```ts
import { streamJson } from 'llmmend/sse'
import { z } from 'zod'

const res = await fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen2.5:3b',
    stream: true,
    messages: [{ role: 'user', content: 'A pancake recipe as JSON with "title" and "steps".' }],
  }),
})
const schema = z.object({ title: z.string(), steps: z.array(z.string()) })

for await (const item of streamJson(res, { provider: 'openai', schema })) {
  if (!item.done) console.log(item.partial) // grows as the model writes
  else if (item.result.ok) console.log(item.result.value.steps) // typed by the schema
  else console.log(item.result.error, item.stopReason) // e.g. schema_mismatch, max_tokens
}
```

Streams a Reply that contains JSON. While it arrives, `streamJson` yields `{ done: false, partial, complete }` each time the Partial value changes. The Partial value is the Candidate that `pick` would choose from the text so far (by default the last one, so a format example in the preamble never wins over the answer), read the way `parsePartialJson` reads it. Nothing is yielded before an object or array starts.

Then it yields exactly one final item, `done: true`, with:

- `result`: `extractJsonAsync` over the whole Reply with the same options (`schema`, `pick`, `repair`, `expect`), so a schema mismatch or a cut-off value is a result, not an exception, and async schemas work;
- `partial` and `complete`: the last Partial value;
- `text`: the whole Reply;
- `stopReason`, `rawStopReason?`, `usage?`, and `error?` with the message of a mid-stream Provider error.

Only text counts: reasoning and tool call arguments are ignored, and all text Blocks form one Reply. It throws only what `streamLlm` throws. Parsing is incremental: a text event costs about its own length, plus a shallow copy of the open arrays and objects when the value changes, so even hundreds of kilobytes stream quickly. Successive `partial` values share the parts that ended; treat them as read-only.

### streamToolCalls

```ts
import { streamToolCalls } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  show_gauge: z.object({ value: z.number(), max: z.number() }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })

for await (const item of streamToolCalls(res, { tools })) {
  if (item.done) console.log(item.toolCalls) // what collectText returns
  else if (item.type === 'text') console.log(item.text) // the answer’s text, piece by piece
  else if (item.name === 'show_gauge') console.log(item.partial.value, item.partial.max) // number | undefined, never half-written
}
```

Streams an answer with tool calls, for UIs that render a call while the model writes it. It yields:

- `{ done: false, type: 'text', text }` for each piece of the answer's text;
- `{ done: false, type: 'tool_call', index, id, name, custom?, partial }` each time a call's Partial value changes. `partial` is read the way `parsePartialJson` reads JSON, so an unfinished number never shows; a custom tool's `partial` is its text so far.

With `tools`, `partial` is typed as a deep partial of the tool schema's input, narrowed by `name` (defaults and transforms apply only to the final `args`), and a call to a tool not in `tools` yields nothing until it ends as `unknown_tool`.

Then it yields one final item: `{ done: true }` with everything `collectText` returns. Reasoning is not yielded: read it with `streamLlm`. Each argument delta re-parses that call's arguments, which is fine for arguments of a few kilobytes.

### sseResponse

```ts
import { sseResponse, streamLlm } from 'llmmend/sse'

// A server route that passes the model's stream on to the browser as LLM events.
export async function POST(request: Request): Promise<Response> {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': '…',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: await request.text(),
    signal: request.signal,
  })
  return sseResponse(streamLlm(upstream), { keepAlive: 15_000 })
}
```

```ts
import { type LlmEvent, parseSSE } from 'llmmend/sse'

// In the browser.
const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: [] }) })
for await (const event of parseSSE(res.body!)) {
  const ev = JSON.parse(event.data) as LlmEvent
  if (ev.type === 'text') console.log(ev.text)
}
```

`sseResponse(source, init?)` streams an async iterable as server-sent events, in a `Response` with `content-type: text/event-stream`, `cache-control: no-cache` and `x-accel-buffering: no` (so nginx does not hold events back), unless `init` sets them. `init` is a `ResponseInit` plus `keepAlive`. `createSSEStream(source, { keepAlive? })` gives the same stream as a `ReadableStream<Uint8Array>`, for servers that take a body rather than a `Response`.

Each item of `source` is an event `{ data, event?, id?, retry? }` or a plain value. A string `data` goes as is, anything else through `JSON.stringify`; multi-line data becomes several `data:` lines, which `parseSSE` joins again. An object is an event only when it has `data` and no keys but `event`, `id` and `retry`, so LLM events go as JSON. An `event` or `id` with a line break, a `retry` that is not a whole number, or an error from the source errors the stream.

`keepAlive` (milliseconds, off by default) sends a `:` comment after that long without an event, so proxies don't drop a quiet connection, for example while the model thinks. When the client goes away, the stream calls `return()` on the source: `streamLlm` then cancels the upstream request as soon as its next chunk arrives.

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

## llmmend/chunk

### chunkText

```ts
import { chunkText } from 'llmmend/chunk'

const text = 'One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.'
chunkText(text, { maxTokens: 10 }).map((c) => c.text)
// ['One two three. Four five six.\n\n', 'Seven eight nine. Ten eleven twelve.']
```

`chunkText(text, options)` splits a text into chunks of at most `maxTokens` tokens and returns `{ text, start, end, tokens, index, oversized?, headings? }[]`.

| Option        | Default          | Meaning                                                                                    |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `maxTokens`   | (required)       | The budget per chunk.                                                                      |
| `overlap`     | `0`              | Tokens to repeat from the end of the previous chunk.                                       |
| `countTokens` | `estimateTokens` | Count with a real tokenizer for exact budgets.                                             |
| `separators`  | see below        | Strings or regular expressions, coarsest first; `''` cuts between grapheme clusters.       |
| `mode`        | `'text'`         | `'markdown'` starts chunks at headings and keeps code fences and tables whole if they fit. |

Default separators: paragraphs (`\n\n`), lines, sentences (`.`, `!`, `?`, `…` followed by whitespace, or `。！？`), words, then grapheme clusters. In `markdown` mode, headings (`#` to `####`) come first. The text is cut at the coarsest separator that fits, and the pieces are merged back as long as they fit together.

Guarantees:

- `chunk.text === text.slice(chunk.start, chunk.end)`, and `tokens` is `countTokens(chunk.text)`.
- `tokens <= maxTokens`, unless a chunk is `oversized`: no separator could cut it smaller (with the default separators, a single grapheme cluster).
- Chunks are in order without gaps; without overlap each starts where the previous ended, and joining them gives the text back. With overlap, a chunk starts inside the previous one, at the separator that gives the longest overlap within both `overlap` and `maxTokens`.
- A grapheme cluster (an emoji with modifiers, a letter with accents) is never split.

#### Heading paths

```ts
import { chunkText } from 'llmmend/chunk'

const doc = '# Install\n\nPick your system.\n\n## Linux\n\nRun the script.'
for (const chunk of chunkText(doc, { maxTokens: 8, mode: 'markdown' })) {
  const context = chunk.headings?.join(' › ') // 'Install' first, then 'Install › Linux'
  console.log(`${context}\n\n${chunk.text}`)
}
```

In `markdown` mode every chunk has `headings`: the headings in effect where its own text starts, outermost first. A chunk that starts with a heading includes it; a chunk holding several small sections gets the first one's path; the Overlap at a chunk's start doesn't count. ATX headings of every level (`#` to `######`, also those finer than the separators) and setext headings (a line of `===` or `---` under the text) count; headings inside code fences don't. Only the markers are removed: inline Markdown stays as written. To give an embedding model that context, put the path before the chunk's text, as above: the chunk itself, its offsets and its token count stay unchanged.

### chunkDocuments

```ts
import { chunkDocuments } from 'llmmend/chunk'

const pages = [
  { text: 'First page…', metadata: { source: 'guide.pdf', page: 1 } },
  { text: 'Second page…', metadata: { source: 'guide.pdf', page: 2 } },
]
for (const chunk of chunkDocuments(pages, { maxTokens: 500 })) {
  console.log(chunk.doc, chunk.index, chunk.metadata.page) // 0 0 1, then 1 0 2
}
```

`chunkDocuments(docs, options)` splits several documents with `chunkText` and returns all their chunks in one array. Each chunk also has `doc`, the document's position in `docs`, and `metadata`, passed through as is and typed from the input. `index` counts within each document, `start` and `end` are offsets in that document, and options apply to each document (`headings` included). Chunks never overlap across documents: when a sentence may run across pages, join the pages before splitting.

### estimateTokens

```ts
import { estimateTokens } from 'llmmend/chunk'

estimateTokens('Hello, world!') // 3
```

Estimates tokens without a vocabulary, from the kinds of characters in the text. See the README for its measured accuracy against OpenAI, Gemini and Claude tokenizers; Claude's produces about 1.5× as many tokens.

### truncateToTokens

```ts
import { truncateToTokens } from 'llmmend/chunk'

truncateToTokens('The quick brown fox jumps over the lazy dog', 5, {
  from: 'middle',
  ellipsis: ' … ',
})
// 'The quick … lazy dog'
```

`truncateToTokens(text, max, { from?, ellipsis?, countTokens? })` shortens a text to at most `max` tokens without splitting a grapheme cluster. `from` says where to cut: `'end'` (default) keeps the beginning, `'start'` keeps the end, `'middle'` keeps both. The `ellipsis` (default `''`) marks the cut and counts against `max`; if not even it fits, the result is `''`.

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

| Class              | `code`                                                                  | Extra fields                                         |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`, `at?`, `line?`, `column?` |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body`                          |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                                                      |

Each class has its own `name`, so errors can be told apart without `instanceof` when two copies of the package are loaded.

## Versioning

The unions you `switch` on (`Issue['code']`, `ExtractError`, `StopReason`, `LlmEvent['type']`, `LlmmendError['code']`) are closed, so TypeScript checks your `switch`. Adding a member is a minor release; removing or renaming one is a major release. Keep a `default` branch.
