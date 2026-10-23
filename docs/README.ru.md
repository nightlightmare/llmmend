[English](https://github.com/nightlightmare/llmmend/blob/main/README.md) | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/README.zh-CN.md) | **Русский**

# 🩹 llmmend

[![npm](https://img.shields.io/npm/v/llmmend)](https://www.npmjs.com/package/llmmend)
[![bundle size](https://img.shields.io/bundlejs/size/llmmend)](https://bundlejs.com/?q=llmmend)
[![CI](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml/badge.svg)](https://github.com/nightlightmare/llmmend/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/llmmend#provenance)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/llmmend?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/llmmend)](https://github.com/nightlightmare/llmmend/blob/main/LICENSE)

**Чинит то, что вернула LLM.** Достаёт и исправляет JSON, разбирает потоковые ответы любого провайдера. Без зависимостей. Работает в Node, Bun, Deno, браузерах и edge-средах.

```bash
npm i llmmend
```

## Зачем

В каждом проекте с LLM рано или поздно появляется один и тот же хрупкий код: регулярки, которые срезают ограждения ` ```json `, и самописный SSE-парсер, который ломается на разрезанном байте UTF-8. `llmmend` — это такой код, написанный один раз и проверенный на корпусе сломанных ответов моделей и записанных стримов провайдеров.

## JSON из неряшливых ответов

```ts
import { extractJson } from 'llmmend/json'
import { z } from 'zod'

const reply = `Sure! Here's the data:
\`\`\`json
{ name: 'Ada', skills: ['math', 'code',], active: True
` // обрезано по max_tokens

const res = extractJson(reply, {
  schema: z.object({ name: z.string(), skills: z.array(z.string()), active: z.boolean() }),
})

if (res.ok) {
  console.log(res.value) // { name: 'Ada', skills: ['math', 'code'], active: true }, полностью типизировано
  console.log(res.issues.map((issue) => issue.code))
  // stripped_wrapper, unquoted_key, single_quotes, trailing_comma, python_literal, truncated_closed
}
```

Подходит любая библиотека со [Standard Schema](https://standardschema.dev): zod, valibot, arktype.

## Один формат стрима для всех провайдеров

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
      break // новые типы событий могут появиться в минорных релизах
  }
}
```

Поддерживаются Anthropic, Google Gemini и API, совместимые с OpenAI Chat Completions (OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio). Свой формат подключается адаптером строк на десять. `done` всегда приходит ровно один раз и последним; ошибка провайдера посреди стрима приходит событием `error`, а не исключением.

> **Usage у OpenAI:** передайте в запросе `stream_options: { include_usage: true }`, иначе OpenAI вообще не пришлёт расход токенов.

## API

| Импорт         | Функции                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `llmmend/json` | `extractJson`, `extractJsonAsync`, `extractJsonOrThrow`, `extractAllJson`, `repairJson`, `parsePartialJson` |
| `llmmend/sse`  | `parseSSE`, `streamLlm`, `streamText`, `collectText`, `streamJson`                                          |

Всё также реэкспортируется из корня: `import { extractJson } from 'llmmend'` по-прежнему поддерживает tree-shaking.

Полный справочник: [docs/api.ru.md](https://github.com/nightlightmare/llmmend/blob/main/docs/api.ru.md)

## Размер

| Модуль         | min+brotli                        |
| -------------- | --------------------------------- |
| `llmmend/json` | ~3.5 kB                           |
| `llmmend/sse`  | ~2.9 kB (один `parseSSE` ~0.9 kB) |

## Участие

Нашли ответ модели, с которым `llmmend` не справляется? [Откройте issue](https://github.com/nightlightmare/llmmend/issues/new?template=broken-reply.md) с исходным текстом: он станет тестовой фикстурой.

## Лицензия

MIT © nightlightmare
