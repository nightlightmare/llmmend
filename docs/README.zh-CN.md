[English](https://github.com/nightlightmare/llmmend/blob/main/README.md) | **简体中文** | [Русский](https://github.com/nightlightmare/llmmend/blob/main/docs/README.ru.md)

# 🩹 llmmend

[![npm](https://img.shields.io/npm/v/llmmend)](https://www.npmjs.com/package/llmmend)
[![bundle size](https://img.shields.io/bundlejs/size/llmmend)](https://bundlejs.com/?q=llmmend)
[![CI](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml/badge.svg)](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/llmmend#provenance)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/llmmend?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/llmmend)](https://github.com/nightlightmare/llmmend/blob/main/LICENSE)

**修复 LLM 返回的内容。** 提取并修复 JSON，解析任意提供商的流式响应。零依赖。可在 Node、Bun、Deno、浏览器和边缘运行时中使用。

```bash
npm i llmmend
```

## 为什么

每个 LLM 项目最终都会写出同样脆弱的代码：用正则去掉 ` ```json ` 代码围栏，手写的 SSE 解析器一遇到被拆开的 UTF-8 字节就出错。`llmmend` 把这些代码一次写好，并用一套损坏的模型回复和录制的提供商流进行测试。

## 从杂乱的回复中提取 JSON

```ts
import { extractJson } from 'llmmend/json'
import { z } from 'zod'

const reply = `Sure! Here's the data:
\`\`\`json
{ name: 'Ada', skills: ['math', 'code',], active: True
` // 因 max_tokens 被截断

const res = extractJson(reply, {
  schema: z.object({ name: z.string(), skills: z.array(z.string()), active: z.boolean() }),
})

if (res.ok) {
  console.log(res.value) // { name: 'Ada', skills: ['math', 'code'], active: true }，类型完整
  console.log(res.issues.map((issue) => issue.code))
  // stripped_wrapper, unquoted_key, single_quotes, trailing_comma, python_literal, truncated_closed
}
```

支持任何 [Standard Schema](https://standardschema.dev) 库：zod、valibot、arktype。

## 所有提供商，同一种流格式

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
      break // 次版本可能新增事件类型
  }
}
```

支持 Anthropic、Google Gemini、OpenAI Responses API 以及兼容 OpenAI Chat Completions 的 API（OpenAI、OpenRouter、Groq、Ollama、vLLM、LM Studio）。其他格式只需一个约 10 行的适配器。`done` 总是恰好出现一次，且在最后；流中途的提供商错误以 `error` 事件送达，而不是抛出异常。

> **OpenAI 用量：** 请在请求中传入 `stream_options: { include_usage: true }`，否则 OpenAI 根本不会返回 token 用量。

## API

| 导入           | 函数                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `llmmend/json` | `extractJson`, `extractJsonAsync`, `extractJsonOrThrow`, `extractAllJson`, `repairJson`, `parsePartialJson` |
| `llmmend/sse`  | `parseSSE`, `streamLlm`, `streamText`, `collectText`, `streamJson`                                          |

所有内容也从根模块重新导出：`import { extractJson } from 'llmmend'` 依然支持 tree-shaking。

完整参考：[docs/api.zh-CN.md](https://github.com/nightlightmare/llmmend/blob/main/docs/api.zh-CN.md)

## 体积

| 模块           | min+brotli                         |
| -------------- | ---------------------------------- |
| `llmmend/json` | ~3.5 kB                            |
| `llmmend/sse`  | ~2.9 kB（仅 `parseSSE` 约 0.9 kB） |

## 参与贡献

遇到 `llmmend` 处理不了的模型回复？[提交 issue](https://github.com/nightlightmare/llmmend/issues/new?template=broken-reply.md) 并附上原始文本：它会成为一个测试用例。

## 许可证

MIT © nightlightmare
