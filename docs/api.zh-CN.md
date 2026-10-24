[English](https://github.com/nightlightmare/llmmend/blob/main/docs/api.md) | **简体中文** | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/api.ru.md)

# API 参考

`llmmend` 有三个模块。可以从模块导入，也可以从根导入：两种方式都支持 tree-shaking。

```ts
import { extractJson } from 'llmmend/json'
import { streamLlm } from 'llmmend/sse'
import { collectText, repairJson } from 'llmmend'
```

下文用到的几个术语：

- **Reply**（回复）：模型返回的完整文本，包括 JSON 周围的所有内容。
- **Candidate**（候选）：在回复中找到的对象或数组。单独的字符串或数字不会成为候选。
- **Issue**：llmmend 为得到结果而修复或跳过的一处内容的记录。
- **Block**（块）：流式回答中的一部分（文本、推理或一次工具调用），从 0 开始编号。

## llmmend/json

### extractJson

```ts
import { extractJson } from 'llmmend/json'

const res = extractJson('Here you go: {"city": "Paris", "temp": 21,}')
if (res.ok) console.log(res.value, res.issues)
else console.log(res.error)
```

`extractJson(text, options?)` 在回复中找到 JSON，修复它，并在提供 schema 时进行校验。遇到错误输入时从不抛出异常。

选项：

| 选项     | 取值                                               | 默认值   | 含义                                                                                                          |
| -------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `schema` | 任意 [Standard Schema](https://standardschema.dev) | 无       | 校验结果；`value` 获得 schema 的输出类型。                                                                    |
| `pick`   | `'first'`、`'last'`、`'largest'`                   | `'last'` | 回复中有多个候选时使用哪一个。                                                                                |
| `repair` | `'full'`、`'syntax'`、`'none'`                     | `'full'` | `'full'` 修复语法并补全被截断的值；`'syntax'` 修复语法，但把被截断的值报告为 `truncated`；`'none'` 严格解析。 |
| `expect` | `'object'`、`'array'`、`'any'`                     | `'any'`  | 只考虑对象，或只考虑数组。                                                                                    |

结果是以下之一：

- `{ ok: true, value, repaired, issues, raw }`：只要修复了去掉外围文本之外的任何内容，`repaired` 就为 true；`raw` 是候选的原文。
- `{ ok: false, error: 'schema_mismatch', issues, schemaIssues, value }`：JSON 解析成功，但被 schema 拒绝。`schemaIssues` 来自 schema，可以直接发回给模型。
- `{ ok: false, error, issues }`，其中 `error` 为 `not_found`、`unparseable`、`truncated`、`max_depth` 之一。

如果回复在最后一个完整候选之后截断了一个对象或数组，那么被截断的才是真正的答案：使用 `repair: 'syntax'` 时结果为 `truncated`，而不会退回到更早的候选（那往往是提示词里的格式示例）。

```ts
import { extractJson } from 'llmmend/json'

const reply = 'Format: {"x": 0}. Answer: {"x": 1, "y": [1, 2'

extractJson(reply) // ok，value 为 { x: 1, y: [1, 2] }，issues 中含 truncated_closed
extractJson(reply, { repair: 'syntax' }) // { ok: false, error: 'truncated', issues: [] }
```

嵌套超过 512 层会得到 `max_depth`。

### extractJsonAsync

```ts
import { extractJsonAsync } from 'llmmend/json'
import { z } from 'zod'

const schema = z.object({ user: z.string() }).refine(async (v) => v.user !== 'admin')
const res = await extractJsonAsync('{"user": "ada"}', { schema })
```

与 `extractJson` 相同，用于异步校验的 schema。`extractJson` 遇到这类 schema 时会抛出代码为 `async_schema` 的 `LlmmendError`。

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

返回值，或抛出 `LlmmendJsonError`：其 `code` 即上文的 `error`，并带有 `issues`，在 `schema_mismatch` 时还有 `schemaIssues`。

### extractAllJson

```ts
import { extractAllJson } from 'llmmend/json'

extractAllJson('First {"a": 1}, then [2, 3] and {"b": 2}') // [{ a: 1 }, [2, 3], { b: 2 }]
```

按顺序返回回复中的所有候选。接受除 `pick` 以外的相同选项；提供 schema 时只返回通过校验的值。

### repairJson

```ts
import { repairJson } from 'llmmend/json'

const { json, issues } = repairJson("{'a': NaN, b: None, // note\n}")
console.log(json) // {"a":null,"b":null}
console.log(issues.map((issue) => issue.code))
```

修复 JSON 文本，以字符串形式返回合法的 JSON 以及修复过的 Issues。整个文本必须是一个值：带有外围文本的回复请使用 `extractJson`。无法修复时抛出 `LlmmendJsonError`。

### parsePartialJson

```ts
import { parsePartialJson } from 'llmmend/json'

parsePartialJson('{"title": "Hel') // { value: { title: 'Hel' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 4') // { value: { title: 'Hello' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 42}') // { value: { title: 'Hello', count: 42 }, complete: true }
```

读取仍在传输中的 JSON，用于渐进式界面。它会跳过回复中的开场白和代码围栏，返回第一个对象或数组目前已到达的部分：

- 未写完的字符串原样显示，随着文本到达而变长；
- 未写完的数字或字面量，以及没有值的键，在写完之前不会出现；
- 一旦显示为已完成的值，之后不会再改变。

收到右括号时 `complete` 变为 true。在对象或数组开始之前，`value` 为 `undefined`。从不抛出异常。

### Issues

每个结果都按顺序列出对回复做了什么。

| `code`                   | 附加字段 | 修复了什么                                                           |
| ------------------------ | -------- | -------------------------------------------------------------------- |
| `stripped_wrapper`       | `detail` | 跳过了 JSON 周围的文本或代码围栏，例如 `'code fence, text before'`。 |
| `trailing_comma`         | `at`     | `}` 或 `]` 前的逗号。                                                |
| `single_quotes`          | `at`     | 用单引号括起的字符串。                                               |
| `unquoted_key`           | `at`     | 没有引号的键。                                                       |
| `python_literal`         | `at`     | `True`、`False` 或 `None`。                                          |
| `non_finite_number`      | `at`     | `NaN` 或 `Infinity`，替换为 `null`。                                 |
| `unescaped_control_char` | `at`     | 字符串中的原始换行符或制表符。                                       |
| `comment_removed`        | `at`     | `//` 或 `/* */` 注释。                                               |
| `truncated_closed`       | `closed` | 用 `closed` 中的括号补全了被截断的值。                               |

`at` 是在文本中的位置。

## llmmend/sse

### parseSSE

```ts
import { parseSSE } from 'llmmend/sse'

const res = await fetch('https://example.com/events')
for await (const event of parseSSE(res.body ?? new ReadableStream())) {
  console.log(event.event, event.data, event.id)
}
```

一个[符合 WHATWG 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)的 server-sent events 解析器。接受 `ReadableStream<Uint8Array>`，或产出字节或字符串的异步可迭代对象，并产出 `{ event, data, id?, retry? }`：

- 事件没有名称时，`event` 为 `'message'`；
- 多行 `data` 用 `\n` 连接；
- `id` 和 `retry` 按规范在事件之间保留。

数据块可以在任何位置切断行和 UTF-8 字符。支持 CRLF、LF 和 CR 换行以及开头的 BOM。流结束时仍未完成的事件会被丢弃。`signal` 选项会取消数据源，并使循环抛出 `AbortError`；提前退出循环同样会取消数据源。

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

`streamLlm(source, { provider?, signal? })` 把提供商的流转换为统一的 LLM 事件序列。`source` 是 `fetch` 返回的 `Response` 或其 body。

提供商：

- `'auto'`（默认）：根据第一个能显示格式的事件选择适配器（`message_*` 事件：Anthropic；`response.*`：OpenAI Responses；`choices`：Chat Completions；`candidates`：Gemini）。`ping` 等无法判断的事件会被暂存（最多 20 个），在格式明确后重新交给适配器；回答开始前的错误无论哪种格式都以 `error` 送达。始终无法判断格式的流以 `done { stopReason: 'unknown' }` 结束；连续 20 个无法判断的事件会抛出代码为 `unknown_provider` 的 `LlmmendError`。显式传入提供商即可跳过检测。
- `'anthropic'`：Anthropic Messages API。
- `'openai'`：OpenAI Chat Completions 以及沿用其格式的 API：OpenRouter、Groq、Ollama、DeepSeek、vLLM、LM Studio。只读取第一个候选回答；不支持 `n > 1`。OpenAI 只有在设置 `stream_options: { include_usage: true }` 时才会发送 token 用量。
- `'openai-responses'`：OpenAI Responses API（Ollama 也在 `/v1/responses` 提供）。每个输出项是一个块，编号为 `output_index`；推理摘要以 `reasoning` 送达，`encrypted_content`（需设置 `include: ['reasoning.encrypted_content']`）以 `reasoning_signature` 送达，需随该块发回。`function_call` 和 `custom_tool_call` 项是工具调用；网页搜索等内置工具以 `other` 送达。停止原因：`response.completed` 为 `end`（有工具调用时为 `tool_use`，有拒绝时为 `refused`），`response.incomplete` 按其原因映射（`max_output_tokens` → `max_tokens`，`content_filter` → `refused`），`response.failed` 为 `error`。
- `'gemini'`：Google Gemini `streamGenerateContent`（`?alt=sse`）。只读取第一个候选。每当部分的类型变化（推理 ↔ 文本）时开始一个新块，每次函数调用各占一个块，因此块的顺序与 Gemini 的部分顺序一致。函数调用整体到达：先 `tool_call_start`，再一个 `tool_call_delta`。
- 自定义适配器，见下文。

### LLM 事件

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

| `type`                | 字段                                                                                         | 含义                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`                | `index`, `text`                                                                              | 回答文本的一个片段。                                                                                                                       |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | 推理的一个片段。`redacted` 保存 Anthropic 加密的 `redacted_thinking` 数据；请原样发回。                                                    |
| `reasoning_signature` | `index`, `signature`                                                                         | 继续对话时需要随块 `index` 原样发回的数据：Anthropic 的推理签名，或 Gemini 的 `thoughtSignature`（可能出现在任何部分上，通常是函数调用）。 |
| `tool_call_start`     | `index`, `id`, `name`                                                                        | 一次工具调用开始。                                                                                                                         |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | 工具调用 JSON 参数的一个片段；按顺序拼接。                                                                                                 |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | 截至目前的 token 用量。                                                                                                                    |
| `done`                | `stopReason`, `rawStopReason?`                                                               | 流结束。                                                                                                                                   |
| `error`               | `message`, `raw`                                                                             | 提供商在流中途报告了错误。                                                                                                                 |
| `other`               | `raw`                                                                                        | 适配器不认识的事件，即 `parseSSE` 解析出的原样事件。                                                                                       |

`index` 是块的编号：文本、推理和每次工具调用各有自己的编号，所有提供商都一样。`tool_call_delta` 总是在相同 `index` 的 `tool_call_start` 之后到达。

`usage` 是总量的快照：使用最新的一个，不要累加。`inputTokens` 始终包含缓存的 token。

停止原因：

| `stopReason`    | Anthropic                                     | OpenAI                        | Gemini                                                                               |
| --------------- | --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `end`           | `end_turn`                                    | `stop`                        | `STOP`                                                                               |
| `max_tokens`    | `max_tokens`, `model_context_window_exceeded` | `length`                      | `MAX_TOKENS`                                                                         |
| `tool_use`      | `tool_use`                                    | `tool_calls`, `function_call` | 函数调用之后的 `STOP`                                                                |
| `stop_sequence` | `stop_sequence`                               |                               |                                                                                      |
| `refused`       | `refusal`                                     | `content_filter`              | `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, …；被拦截的提示词 |
| `paused`        | `pause_turn`                                  |                               | `CONTINUATION`                                                                       |
| `error`         | `error` 事件                                  | 数据中的 `error` 对象         | 数据中的 `error` 对象；`MALFORMED_FUNCTION_CALL`, `MISSING_THOUGHT_SIGNATURE`, …     |
| `unknown`       | 其他值，或没有最终事件                        | 其他值，或没有 `[DONE]`       | 其他值，或没有停止原因                                                               |

`rawStopReason` 保留提供商的原始字符串。

错误与流的结束：

- 状态码不是 2xx 的 `Response` 会在任何事件之前抛出 `LlmmendHttpError`，带有 `status`、`headers` 和响应体 `body`。
- `done` 恰好出现一次，且总在最后。流中途的提供商错误以 `error` 到达，随后是 `stopReason: 'error'` 的 `done`；不会抛出异常。没有最终事件就结束的流会得到 `stopReason: 'unknown'` 的 `done`。
- 通过 `signal` 中止会抛出 `AbortError` 并取消数据源。

次版本可能新增事件类型和停止原因：请在 `switch` 中保留 `default` 分支。

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

只产出回答的文本。想知道回答为何结束，请使用 `collectText` 或 `streamLlm`。

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

读取整个流，返回 `{ text, stopReason, usage? }`，其中是最后一次用量快照。

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
  if (!item.done) console.log(item.partial) // 随着模型输出而增长
  else if (item.result.ok) console.log(item.result.value.steps) // 类型由 schema 决定
  else console.log(item.result.error, item.stopReason) // 例如 schema_mismatch、max_tokens
}
```

流式读取包含 JSON 的回复。在回复到达的过程中，每当部分值发生变化，`streamJson` 就产出 `{ done: false, partial, complete }`。部分值是 `pick` 会从目前已到达的文本中选出的候选（默认是最后一个，因此开场白里的格式示例不会盖过真正的答案），并按 `parsePartialJson` 的方式读取。在对象或数组开始之前不会产出任何内容。

随后恰好产出一个最终项 `done: true`，其中包含：

- `result`：对整个回复使用相同选项（`schema`、`pick`、`repair`、`expect`）调用 `extractJsonAsync` 的结果，因此 schema 不匹配或被截断的值都是结果而不是异常，异步 schema 也能使用；
- `partial` 和 `complete`：最后一次的部分值；
- `text`：完整的回复；
- `stopReason`、`rawStopReason?`、`usage?`，以及带有流中途提供商错误信息的 `error?`。

只计算文本：推理和工具调用参数会被忽略，所有文本块组成同一个回复。它只抛出 `streamLlm` 会抛出的异常。每个文本事件都会重新解析整个回复，因此开销随回复长度的平方增长：对常见的结构化输出没有影响，对数百 KB 的内容则会变慢。

### 自定义提供商适配器

```ts
import { type ProviderAdapter, streamLlm } from 'llmmend/sse'

// 一个发送 {"t": "..."} 片段、最后发送 {"end": true} 的提供商。
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

适配器把每个解析后的 SSE 事件转换为零个或多个 LLM 事件。`create()` 每个流调用一次，所以请把流的状态保存在它的闭包里。保证由 `streamLlm` 提供：遇到 `done` 后停止，在 `error` 之后补上 `done`，流没有 `done` 就结束时也会补上。

## llmmend/chunk

### chunkText

```ts
import { chunkText } from 'llmmend/chunk'

const text = 'One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.'
chunkText(text, { maxTokens: 10 }).map((c) => c.text)
// ['One two three. Four five six.\n\n', 'Seven eight nine. Ten eleven twelve.']
```

`chunkText(text, options)` 把文本切成每块最多 `maxTokens` 个 token 的块，返回 `{ text, start, end, tokens, index, oversized? }[]`。

| 选项          | 默认值           | 含义                                                            |
| ------------- | ---------------- | --------------------------------------------------------------- |
| `maxTokens`   | （必填）         | 每块的预算。                                                    |
| `overlap`     | `0`              | 从上一块末尾重复的 token 数。                                   |
| `countTokens` | `estimateTokens` | 使用真实分词器计数以获得精确预算。                              |
| `separators`  | 见下文           | 字符串或正则表达式，从粗到细；`''` 在字素簇之间切分。           |
| `mode`        | `'text'`         | `'markdown'` 让块从标题开始，并在放得下时保持代码块和表格完整。 |

默认分隔符：段落（`\n\n`）、行、句子（`.`、`!`、`?`、`…` 后跟空白，或 `。！？`）、单词，最后是字素簇。在 `markdown` 模式下，标题（`#` 到 `####`）排在最前。文本在能放下的最粗粒度分隔符处切分，然后只要放得下就把片段重新合并。

保证：

- `chunk.text === text.slice(chunk.start, chunk.end)`，`tokens` 即 `countTokens(chunk.text)`。
- `tokens <= maxTokens`，除非块被标记为 `oversized`：没有任何分隔符能把它切得更小（使用默认分隔符时，即单个字素簇）。
- 块按顺序排列且没有空隙；没有重叠时，每块都从上一块结束处开始，拼接起来即还原原文。有重叠时，块从上一块内部开始，位于在 `overlap` 和 `maxTokens` 两个预算内重叠最长的分隔符处。
- 字素簇（带修饰符的表情、带重音的字母）永远不会被切开。

### estimateTokens

```ts
import { estimateTokens } from 'llmmend/chunk'

estimateTokens('Hello, world!') // 3
```

无需词表，根据文本中的字符种类估算 token 数。它相对 OpenAI、Gemini 和 Claude 分词器的实测精度见 README；Claude 的分词器产生的 token 约为 1.5 倍。

### truncateToTokens

```ts
import { truncateToTokens } from 'llmmend/chunk'

truncateToTokens('The quick brown fox jumps over the lazy dog', 5, {
  from: 'middle',
  ellipsis: ' … ',
})
// 'The quick … lazy dog'
```

`truncateToTokens(text, max, { from?, ellipsis?, countTokens? })` 把文本缩短到最多 `max` 个 token，且不切开字素簇。`from` 指定切的位置：`'end'`（默认）保留开头，`'start'` 保留结尾，`'middle'` 两端都保留。`ellipsis`（默认 `''`）标记切分处并计入 `max`；如果连它都放不下，结果为 `''`。

## 错误

```ts
import { LlmmendError, LlmmendHttpError } from 'llmmend'

function describe(error: unknown): string {
  if (error instanceof LlmmendHttpError) return `HTTP ${error.status}: ${error.body}`
  if (error instanceof LlmmendError) return error.code
  return String(error)
}
```

llmmend 抛出的所有错误都继承自带有 `code` 的 `LlmmendError`：

| 类                 | `code`                                                                  | 附加字段                    |
| ------------------ | ----------------------------------------------------------------------- | --------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`   |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body` |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                             |

每个类都有自己的 `name`，因此在加载了两份包副本时，不用 `instanceof` 也能区分错误。

## 版本策略

你会 `switch` 的联合类型（`Issue['code']`、`ExtractError`、`StopReason`、`LlmEvent['type']`、`LlmmendError['code']`）是封闭的，因此 TypeScript 会检查你的 `switch`。新增成员属于次版本；删除或重命名属于主版本。请保留 `default` 分支。
