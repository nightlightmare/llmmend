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

| 选项     | 取值                                               | 默认值   | 含义                                                                                                                                                                              |
| -------- | -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | 任意 [Standard Schema](https://standardschema.dev) | 无       | 校验结果；`value` 获得 schema 的输出类型。                                                                                                                                        |
| `pick`   | `'first'`、`'last'`、`'largest'`                   | `'last'` | 回复中有多个候选时使用哪一个。                                                                                                                                                    |
| `repair` | `'full'`、`'syntax'`、`'none'`                     | `'full'` | `'full'` 修复语法并补全被截断的值；`'syntax'` 修复语法，但把被截断的值报告为 `truncated`；`'none'` 严格解析。                                                                     |
| `expect` | `'object'`、`'array'`、`'any'`                     | `'any'`  | 只考虑对象，或只考虑数组。                                                                                                                                                        |
| `coerce` | `true`、`false`                                    | `false`  | 配合 schema：当它拒绝该值时，在其问题所指的路径上尝试 `"42"` ↔ `42`、`"true"` ↔ `true` 和 `"null"` → `null`；只有该路径上的问题消失时才保留修改。每次修改都记为 Issue `coerced`。 |

结果是以下之一：

- `{ ok: true, value, repaired, issues, raw }`：只要修复了去掉外围文本之外的任何内容，`repaired` 就为 true；`raw` 是候选的原文。
- `{ ok: false, error: 'schema_mismatch', issues, schemaIssues, value }`：JSON 解析成功，但被 schema 拒绝。`schemaIssues` 来自 schema，可以直接发回给模型。
- `{ ok: false, error, issues, at? }`，其中 `error` 为 `not_found`、`unparseable`、`truncated`、`max_depth` 之一；对于 `unparseable` 和 `truncated`，`at` 是回复中解析失败的位置。

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

返回值，或抛出 `LlmmendJsonError`：其 `code` 即上文的 `error`，并带有 `issues`，在 `schema_mismatch` 时还有 `schemaIssues`。结果带有 `at` 时，错误也带有它，以及 `line` 和 `column`（从 1 开始，按字符计数），错误消息会指出该位置：片段中的换行显示为 `⏎`，因此片段保持为一行，下方用 `^` 标出位置。

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

### extractTag

```ts
import { extractTag } from 'llmmend/json'

const reply = 'Format: <answer>X</answer>\n<thinking>…</thinking>\n<answer lang="en">Paris</answer>'

const res = extractTag(reply, 'answer')
if (res.ok) console.log(res.value, res.attributes.lang) // 'Paris', 'en'
else if (res.error === 'truncated') console.log(res.partial) // 标签被截断：目前已写出的文本
else console.log(res.error) // 'not_found'
```

`extractTag(text, name, { pick? })` 在回复中查找 `<answer>…</answer>` 这样的标签，返回其文本（去掉首尾空白）。从不抛出异常。结果为以下之一：

- `{ ok: true, value, attributes, issues }`：`attributes` 是开始标签的属性（没有值的属性为 `''`）；当结束标签大小写不同（`<Answer>…</answer>`）时，`issues` 中有 `tag_case_mismatch`。
- `{ ok: false, error: 'truncated', partial }`：标签在最后一个闭合标签之后打开，回复却先结束了，通常是因为 `max_tokens`；`partial` 是目前已写出的文本。不会用更早的闭合标签代替它。
- `{ ok: false, error: 'not_found' }`。

`pick` 在多个闭合标签中选择：`'last'`（默认，这样提示词中的格式示例不会胜过真正的回答）或 `'first'`。代码块内的标签不计入。同名嵌套标签按深度匹配，外层的胜出。名称匹配不区分大小写；`&lt;` 之类的实体保持原样。

### extractAllTags

```ts
import { extractAllTags } from 'llmmend/json'

const reply = '<step>Read the file</step>\n<step>Fix the bug</step>\n<answer>Done</answer>'
console.log(extractAllTags(reply, 'step').map((t) => t.value)) // ['Read the file', 'Fix the bug']
```

按顺序返回回复中所有闭合的顶层标签，形如 `{ name, value, attributes, start, end }`；`start` 和 `end` 覆盖整个标签。提供 `name` 时只返回该名称的标签（嵌套时取最外层）。规则与 `extractTag` 相同。

### extractCodeBlocks

````ts
import { extractCodeBlocks } from 'llmmend/json'

const reply =
  'Install:\n```bash\nnpm i llmmend\n```\nThen:\n```typescript title="app.ts"\nextractJson(reply)\n```'

extractCodeBlocks(reply).map((b) => b.lang) // ['bash', 'typescript']
extractCodeBlocks(reply, { lang: 'ts' })[0]?.code // 'extractJson(reply)'
````

`extractCodeBlocks(text, { lang? })` 按顺序返回回复中的所有围栏代码块，形如 `{ lang, info, code, start, end, complete }`：

- `lang` 是 info 字符串的第一个词（小写，没有时为 `''`），`info` 是整个字符串（`typescript title="app.ts"`）。
- `code` 是原样的内容，不含紧挨围栏的换行；`start` 和 `end` 覆盖从开始围栏行到结束围栏行的整个代码块。
- `complete: false` 表示回复在该代码块中途结束，通常是因为 `max_tokens`：请自行判断半个文件是否有用。

`lang` 过滤不区分大小写，并识别常见别名：`ts`/`typescript`、`js`/`javascript`、`py`/`python`、`sh`/`bash`/`shell`/`zsh`、`yml`/`yaml`、`md`/`markdown`。围栏为 ` ``` ` 或 `~~~`，只能由相同字符且长度不短于开始围栏的围栏关闭，因此可以在更长的围栏中展示另一个代码块。缩进代码块和写在一行里的 ` ```inline``` ` 不计入。`extractTag` 按同样的规则跳过代码中的标签。

### Issues

每个结果都按顺序列出对回复做了什么。

| `code`                   | 附加字段             | 修复了什么                                                                                          |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------- |
| `stripped_wrapper`       | `detail`             | 跳过了 JSON 周围的文本或代码围栏，例如 `'code fence, text before'`。                                |
| `trailing_comma`         | `at`                 | `}` 或 `]` 前的逗号。                                                                               |
| `single_quotes`          | `at`                 | 用单引号括起的字符串。                                                                              |
| `unquoted_key`           | `at`                 | 没有引号的键。                                                                                      |
| `python_literal`         | `at`                 | `True`、`False` 或 `None`。                                                                         |
| `non_finite_number`      | `at`                 | `NaN` 或 `Infinity`，替换为 `null`。                                                                |
| `unescaped_control_char` | `at`                 | 字符串中的原始换行符或制表符。                                                                      |
| `comment_removed`        | `at`                 | `//` 或 `/* */` 注释。                                                                              |
| `truncated_closed`       | `closed`             | 用 `closed` 中的括号补全了被截断的值。                                                              |
| `tag_case_mismatch`      | `at`                 | `extractTag`：结束标签与开始标签大小写不同。                                                        |
| `coerced`                | `path`、`from`、`to` | 使用 `coerce` 时：`path` 处的值类型从 `from` 变为 `to`（`string`、`number`、`boolean` 或 `null`）。 |

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

| `type`                | 字段                                                                                         | 含义                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | `index`, `text`                                                                              | 回答文本的一个片段。                                                                                                                                                                      |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | 推理的一个片段。`redacted` 保存 Anthropic 加密的 `redacted_thinking` 数据；请原样发回。                                                                                                   |
| `reasoning_signature` | `index`, `signature`, `itemId?`                                                              | 继续对话时需要随块 `index` 原样发回的数据：Anthropic 的推理签名，或 Gemini 的 `thoughtSignature`（可能出现在任何部分上，通常是函数调用）。`itemId`：OpenAI Responses 的推理项（`rs_…`）。 |
| `tool_call_start`     | `index`, `id`, `name`, `custom?`, `itemId?`                                                  | 一次工具调用开始。`custom: true`：OpenAI Responses 的 custom tool，其输入是自由文本而不是 JSON。`itemId`：OpenAI Responses 的函数调用项（`fc_…`）。                                       |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | 工具调用 JSON 参数的一个片段；按顺序拼接。                                                                                                                                                |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | 截至目前的 token 用量。                                                                                                                                                                   |
| `done`                | `stopReason`, `rawStopReason?`, `responseId?`                                                | 流结束。`responseId`：提供商对该响应的 id。                                                                                                                                               |
| `error`               | `message`, `raw`                                                                             | 提供商在流中途报告了错误。                                                                                                                                                                |
| `other`               | `raw`                                                                                        | 适配器不认识的事件，即 `parseSSE` 解析出的原样事件。                                                                                                                                      |

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

`rawStopReason` 保留提供商的原始字符串。`responseId` 是提供商对该响应的 id：Anthropic 为 `msg_…`，Chat Completions 为 `chatcmpl-…`（兼容 API 可能不同），Responses 为 `resp_…`（用于 `previous_response_id`），Gemini 为 `responseId`。它随提供商自己的结束事件到来，因此 `streamLlm` 在错误或流中断后补上的 `done` 不带它。配合 `tool_call_start` 和 `reasoning_signature` 上的 `itemId`，自行保存 Responses 历史的客户端可以把这些项发回。

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

读取整个流，返回 `{ text, stopReason, usage?, responseId?, toolCalls }`，其中是最后一次用量快照。

#### 工具调用

```ts
import { collectText } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  get_weather: z.object({ city: z.string(), days: z.number().int().default(1) }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })
const { toolCalls, stopReason } = await collectText(res, { tools })

for (const call of toolCalls) {
  if (!call.ok) console.log(call.name, call.error) // 作为错误的 tool_result 发回模型
  else if (!call.custom && call.name === 'get_weather') console.log(call.args.city, call.args.days) // 类型来自 schema
}
```

`toolCalls` 按 Block 顺序列出回复中的工具调用。可用的调用为 `{ ok: true, index, id, name, args, issues }`：参数经过语法修复（与 `repair: 'syntax'` 相同），`issues` 列出修复了什么；空参数为 `{}`。提供 `tools`（每个工具名对应任意 Standard Schema，异步的也可以）时，`args` 是 schema 的输出，类型按 `name` 推断。使用 `coerce: true` 时，schema 拒绝的参数会像 `extractJson` 的 `coerce` 那样转换类型，每次修改都记在 `issues` 中。

不可用的调用为 `{ ok: false, index, id, name, error, argsText, issues }`，模型写出的原始参数在 `argsText` 中：

| `error`           | 含义                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `truncated`       | 参数被截断，通常发生在 `stopReason: 'max_tokens'` 时；不会补全，因为执行半个调用不安全。 |
| `unparseable`     | 即使修复语法后也不是 JSON。                                                              |
| `max_depth`       | 嵌套超过 512 层。                                                                        |
| `schema_mismatch` | 工具的 schema 拒绝了参数；原因见 `schemaIssues`。                                        |
| `unknown_tool`    | 提供了 `tools`，但其中没有这个名字。                                                     |

OpenAI Responses 的 custom tool 接收自由文本而不是 JSON：其调用为 `{ ok: true, custom: true, …, input }`，文本保持原样；若提供了 schema，则用它校验该文本。

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

只计算文本：推理和工具调用参数会被忽略，所有文本块组成同一个回复。它只抛出 `streamLlm` 会抛出的异常。解析是增量的：一个文本事件的开销大致与其自身长度相当，值发生变化时再加上对尚未结束的数组和对象做一次浅拷贝，因此即使是数百 KB 的内容也能快速完成流式处理。相邻的 `partial` 值会共享已经结束的部分，请将它们视为只读。

### streamToolCalls

```ts
import { streamToolCalls } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  show_gauge: z.object({ value: z.number(), max: z.number() }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })

for await (const item of streamToolCalls(res, { tools })) {
  if (item.done) console.log(item.toolCalls) // 即 collectText 的返回值
  else if (item.type === 'text') console.log(item.text) // 回复文本，逐段输出
  else if (item.name === 'show_gauge') console.log(item.partial.value, item.partial.max) // number | undefined，绝不会是写了一半的数字
}
```

以流的方式输出带工具调用的回复，适用于在模型编写调用时就渲染它的界面。它会输出：

- `{ done: false, type: 'text', text }`：回复文本的每一段；
- `{ done: false, type: 'tool_call', index, id, name, custom?, partial }`：每当某个调用的部分值发生变化时输出。`partial` 的读取方式与 `parsePartialJson` 读取 JSON 相同，因此不会显示未写完的数字；custom tool 的 `partial` 是目前已写出的文本。

提供 `tools` 时，`partial` 的类型是工具 schema 输入类型的深层 partial，并按 `name` 收窄（默认值和转换只作用于最终的 `args`）；调用 `tools` 中没有的工具不会输出任何内容，直到它以 `unknown_tool` 结束。

最后输出一个最终项：`{ done: true }`，包含 `collectText` 返回的全部内容。推理内容不会输出：请用 `streamLlm` 读取。每个参数增量都会重新解析该调用的参数，对于几 KB 的参数没有问题。

### sseResponse

```ts
import { sseResponse, streamLlm } from 'llmmend/sse'

// 服务器路由：把模型的流以 LLM 事件的形式转发给浏览器。
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

// 在浏览器中。
const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: [] }) })
for await (const event of parseSSE(res.body!)) {
  const ev = JSON.parse(event.data) as LlmEvent
  if (ev.type === 'text') console.log(ev.text)
}
```

`sseResponse(source, init?)` 把一个异步可迭代对象作为 server-sent events 输出到 `Response` 中，带有 `content-type: text/event-stream`、`cache-control: no-cache` 和 `x-accel-buffering: no`（让 nginx 不缓冲事件），除非 `init` 自己设置了它们。`init` 是 `ResponseInit` 加上 `keepAlive`。`createSSEStream(source, { keepAlive? })` 以 `ReadableStream<Uint8Array>` 的形式给出同样的流，适用于接收响应体而不是 `Response` 的服务器。

`source` 的每一项是一个事件 `{ data, event?, id?, retry? }` 或一个普通值。字符串 `data` 原样发送，其他值经过 `JSON.stringify`；多行数据会变成多条 `data:` 行，`parseSSE` 会再把它们拼接起来。只有含有 `data` 且除 `event`、`id`、`retry` 外没有其他键的对象才算事件，因此 LLM 事件以 JSON 发送。带换行的 `event` 或 `id`、不是整数的 `retry`，或来源抛出的错误，都会使流出错。

`keepAlive`（毫秒，默认关闭）在这么长时间没有事件后发送一条 `:` 注释，让代理不会断开安静的连接，例如模型思考时。客户端离开时，流会调用来源的 `return()`：`streamLlm` 会在上游的下一块数据到达时取消上游请求。

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

`chunkText(text, options)` 把文本切成每块最多 `maxTokens` 个 token 的块，返回 `{ text, start, end, tokens, index, oversized?, headings? }[]`。

| 选项          | 默认值           | 含义                                                                           |
| ------------- | ---------------- | ------------------------------------------------------------------------------ |
| `maxTokens`   | （必填）         | 每块的预算。                                                                   |
| `overlap`     | `0`              | 从上一块末尾重复的 token 数。                                                  |
| `countTokens` | `estimateTokens` | 使用真实分词器计数以获得精确预算；此时忽略 `tokenizer`。                       |
| `tokenizer`   | `'o200k'`        | `estimateTokens` 模拟的分词器：`'o200k'`（OpenAI）、`'claude'` 或 `'gemini'`。 |
| `separators`  | 见下文           | 字符串或正则表达式，从粗到细；`''` 在字素簇之间切分。                          |
| `mode`        | `'text'`         | `'markdown'` 让块从标题开始，并在放得下时保持代码块和表格完整。                |

默认分隔符：段落（`\n\n`）、行、句子（`.`、`!`、`?`、`…` 后跟空白，或 `。！？`）、单词，最后是字素簇。在 `markdown` 模式下，标题（`#` 到 `####`）排在最前。文本在能放下的最粗粒度分隔符处切分，然后只要放得下就把片段重新合并。

保证：

- `chunk.text === text.slice(chunk.start, chunk.end)`，`tokens` 即 `countTokens(chunk.text)`。
- `tokens <= maxTokens`，除非块被标记为 `oversized`：没有任何分隔符能把它切得更小（使用默认分隔符时，即单个字素簇）。
- 块按顺序排列且没有空隙；没有重叠时，每块都从上一块结束处开始，拼接起来即还原原文。有重叠时，块从上一块内部开始，位于在 `overlap` 和 `maxTokens` 两个预算内重叠最长的分隔符处。
- 字素簇（带修饰符的表情、带重音的字母）永远不会被切开。

#### 标题路径

```ts
import { chunkText } from 'llmmend/chunk'

const doc = '# Install\n\nPick your system.\n\n## Linux\n\nRun the script.'
for (const chunk of chunkText(doc, { maxTokens: 8, mode: 'markdown' })) {
  const context = chunk.headings?.join(' › ') // 先是 'Install'，然后是 'Install › Linux'
  console.log(`${context}\n\n${chunk.text}`)
}
```

在 `markdown` 模式下，每个块都有 `headings`：在其自身文本开始处生效的标题，从外到内。以标题开头的块包含该标题；包含多个小节的块取第一个小节的路径；块开头的重叠部分不计入。所有级别的 ATX 标题（`#` 到 `######`，包括比分隔符更细的级别）和 setext 标题（文本下方一行 `===` 或 `---`）都会计入；代码块中的标题不计入。只去掉标记，行内 Markdown 保持原样。若要把这个上下文提供给嵌入模型，像上面那样把路径放在块文本之前：块本身、偏移量和 token 数都不变。

### chunkDocuments

```ts
import { chunkDocuments } from 'llmmend/chunk'

const pages = [
  { text: 'First page…', metadata: { source: 'guide.pdf', page: 1 } },
  { text: 'Second page…', metadata: { source: 'guide.pdf', page: 2 } },
]
for (const chunk of chunkDocuments(pages, { maxTokens: 500 })) {
  console.log(chunk.doc, chunk.index, chunk.metadata.page) // 0 0 1，然后 1 0 2
}
```

`chunkDocuments(docs, options)` 用 `chunkText` 切分多个文档，并把所有块放在一个数组中返回。每个块还带有 `doc`（文档在 `docs` 中的位置）和 `metadata`（原样传递，类型由输入推断）。`index` 在每个文档内计数，`start` 和 `end` 是在该文档中的偏移量，选项作用于每个文档（包括 `headings`）。块不会跨文档重叠：如果句子可能跨页，请在切分前把各页拼接起来。

### estimateTokens

```ts
import { estimateTokens } from 'llmmend/chunk'

estimateTokens('Hello, world!') // 3
estimateTokens('Hello, world!', { tokenizer: 'claude' }) // 5
```

`estimateTokens(text, { tokenizer? })` 无需词表，根据文本中的字符种类估算 token 数，可针对 OpenAI 的 `o200k_base`（`'o200k'`，默认）、Claude（`'claude'`）或 Gemini（`'gemini'`）。每个预设都基于英文、俄文、中文、日文和韩文文本、代码、Markdown 和聊天的精确计数校准（日文和韩文各只有一篇短文）；实测精度见 README。

### truncateToTokens

```ts
import { truncateToTokens } from 'llmmend/chunk'

truncateToTokens('The quick brown fox jumps over the lazy dog', 5, {
  from: 'middle',
  ellipsis: ' … ',
})
// 'The quick … lazy dog'
```

`truncateToTokens(text, max, { from?, ellipsis?, countTokens?, tokenizer? })` 把文本缩短到最多 `max` 个 token，且不切开字素簇。`from` 指定切的位置：`'end'`（默认）保留开头，`'start'` 保留结尾，`'middle'` 两端都保留。`ellipsis`（默认 `''`）标记切分处并计入 `max`；如果连它都放不下，结果为 `''`。没有 `countTokens` 时，按 `tokenizer` 用 `estimateTokens` 计数。

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

| 类                 | `code`                                                                  | 附加字段                                             |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`, `at?`, `line?`, `column?` |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body`                          |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                                                      |

每个类都有自己的 `name`，因此在加载了两份包副本时，不用 `instanceof` 也能区分错误。

## 版本策略

你会 `switch` 的联合类型（`Issue['code']`、`ExtractError`、`StopReason`、`LlmEvent['type']`、`LlmmendError['code']`）是封闭的，因此 TypeScript 会检查你的 `switch`。新增成员属于次版本；删除或重命名属于主版本。请保留 `default` 分支。
