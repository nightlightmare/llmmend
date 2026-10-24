[English](https://github.com/nightlightmare/llmmend/blob/main/README.md) | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/README.zh-CN.md) | **Русский**

<img src="https://raw.githubusercontent.com/nightlightmare/llmmend/main/docs/logo.png" alt="llmmend logo" width="96" align="right">

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

**Чинит то, что вернула LLM.** Достаёт и исправляет JSON, разбирает потоковые ответы любого провайдера, режет текст на куски по токенам. Без зависимостей. Работает в Node, Bun, Deno, браузерах и edge-средах.

```bash
npm i llmmend
```

Попробуйте в браузере, данные никуда не уходят: [playground](https://nightlightmare.github.io/llmmend/ru/) для починки JSON, SSE-потоков и разбиения на чанки.

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
      break // новые типы событий могут появиться в минорных релизах
  }
}
```

Поддерживаются Anthropic, Google Gemini, OpenAI Responses API и API, совместимые с OpenAI Chat Completions (OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio). Формат определяется по самому стриму; чтобы пропустить определение, передайте `{ provider }`. Свой формат подключается адаптером строк на десять. `done` всегда приходит ровно один раз и последним; ошибка провайдера посреди стрима приходит событием `error`, а не исключением.

> **Usage у OpenAI:** передайте в запросе `stream_options: { include_usage: true }`, иначе OpenAI вообще не пришлёт расход токенов.

## Текст, который влезет в контекст

```ts
import { chunkText, truncateToTokens } from 'llmmend/chunk'

const doc = '# Guide\n\nWhat it does.\n\n## Install\n\nRun the installer, then restart.\n'

for (const chunk of chunkText(doc, { maxTokens: 500, overlap: 50, mode: 'markdown' })) {
  console.log(chunk.index, chunk.start, chunk.end, chunk.tokens) // 0 0 69 19: руководство влезает в один чанк
}

truncateToTokens('A title far too long for the card it has to fit on', 8, { ellipsis: '…' }) // 'A title far too long for the …'
```

`chunkText` режет по самому крупному разделителю, при котором куски влезают: абзацы, затем строки, предложения, слова и, в крайнем случае, кластеры графем. Каждый чанк — это срез текста со своими `start` и `end`, а склейка чанков даёт исходный текст. В режиме `markdown` чанки начинаются с заголовков, а блоки кода и таблицы остаются целыми, если влезают.

Токены считаются без словаря. Оценка минус настоящее число:

| Текст        | `o200k_base` (OpenAI) | Gemini 3.8 Flash | Claude Opus 5.5 |
| ------------ | --------------------- | ---------------- | --------------- |
| Английский   | +5 %                  | −5 %             | −33 %           |
| Русский      | +5 %                  | −2 %             | −34 %           |
| Китайский    | −1 %                  | +2 %             | −34 %           |
| Японский     | −11 %                 | +22 %            | −25 %           |
| Корейский    | −5 %                  | +3 %             | −46 %           |
| Код          | −2 %                  | −15 %            | −36 %           |
| Чат с эмодзи | −5 %                  | −9 %             | −38 %           |

Токенизатор Claude даёт примерно в 1,5 раза больше токенов: для Claude делите бюджет на 1,5 или передайте точный `countTokens`.

## Сравнение с другими пакетами

|                                                                  | llmmend    | jsonrepair | partial-json | best-effort-json-parser | eventsource-parser | ai       | @langchain/textsplitters |
| ---------------------------------------------------------------- | ---------- | ---------- | ------------ | ----------------------- | ------------------ | -------- | ------------------------ |
| **JSON**                                                         |            |            |              |                         |                    |          |                          |
| Находит JSON в тексте, блоках кода и `<think>`                   | ✅         | ⚠️ ¹       | ❌           | ⚠️ ²                    |                    | ❌       |                          |
| Чинит кавычки, комментарии, висячие запятые, константы Python    | ✅         | ✅         | ❌           | ⚠️ ³                    |                    | ❌       |                          |
| Читает обрезанный JSON как частичное значение                    | ✅         | ✅         | ✅           | ✅                      |                    | ✅       |                          |
| Сообщает, что было исправлено                                    | ✅         | ❌         | ❌           | ❌                      |                    | ⚠️ ⁴     |                          |
| Проверяет через Zod, Valibot, ArkType (Standard Schema)          | ✅         | ❌         | ❌           | ❌                      |                    | ⚠️ ⁵     |                          |
| **Потоки**                                                       |            |            |              |                         |                    |          |                          |
| Разбирает SSE                                                    | ✅         |            |              |                         | ✅                 | ✅       |                          |
| Один формат событий для Anthropic, OpenAI, Gemini, любой `fetch` | ✅         |            |              |                         | ❌                 | ⚠️ ⁶     |                          |
| Определяет провайдера                                            | ✅         |            |              |                         | ❌                 | ❌       |                          |
| Частичные значения JSON, пока ответ идёт                         | ✅         |            |              |                         | ❌                 | ⚠️ ⁶     |                          |
| **Чанки**                                                        |            |            |              |                         |                    |          |                          |
| Чанки по токенам без загрузки токенизатора                       | ✅         |            |              |                         |                    |          | ⚠️ ⁷                     |
| Не режет блоки кода и таблицы, если они помещаются               | ✅         |            |              |                         |                    |          | ⚠️ ⁸                     |
| Перекрытие между чанками                                         | ✅         |            |              |                         |                    |          | ✅                       |
| **Пакет**                                                        |            |            |              |                         |                    |          |                          |
| Зависимости                                                      | 0          | 0          | 0            | 0                       | 0                  | 3        | 1 + `@langchain/core`    |
| Размер одной функции, min+brotli                                 | 0.9–3.6 kB | 2.7 kB     | 1.4 kB       | 1.7 kB                  | 1.6 kB             | 31–81 kB | 106 kB                   |

1. Только если весь ответ — один блок кода: текст вокруг блока превращает результат в массив строк.
2. Только JSON в блоке кода: для JSON внутри предложения возвращает первое слово.
3. Комментарий `//` ломает остаток объекта.
4. `parsePartialJson` сообщает `repaired-parse`, но не что изменилось.
5. Только внутри собственных вызовов модели (`generateObject`), не для уже полученного ответа.
6. Через собственные пакеты провайдеров, только для запросов, которые делает сам SDK.
7. `TokenTextSplitter` скачивает токенизатор с `tiktoken.pages.dev` во время работы; `RecursiveCharacterTextSplitter` считает символы.
8. В нашем тесте на 42 размерах чанка его Markdown-сплиттер разрезал помещавшийся блок в 16 случаях.

Проверено 2026-10-24 на jsonrepair 3.15.0, partial-json 0.1.7, best-effort-json-parser 1.5.1, eventsource-parser 4.1.2, ai 7.0.152, @langchain/textsplitters 1.0.2. Размеры: один импорт, собранный rolldown, минифицированный и сжатый brotli; для llmmend — от `parseSSE` до `streamText`, для ai — от `parsePartialJson` до `streamText`. Пустая ячейка: пакет такой задачи не решает.

## API

| Импорт          | Функции                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `llmmend/json`  | `extractJson`, `extractJsonAsync`, `extractJsonOrThrow`, `extractAllJson`, `repairJson`, `parsePartialJson` |
| `llmmend/sse`   | `parseSSE`, `streamLlm`, `streamText`, `collectText`, `streamJson`                                          |
| `llmmend/chunk` | `chunkText`, `estimateTokens`, `truncateToTokens`                                                           |

Всё также реэкспортируется из корня: `import { extractJson } from 'llmmend'` по-прежнему поддерживает tree-shaking.

Полный справочник: [docs/api.ru.md](https://github.com/nightlightmare/llmmend/blob/main/docs/api.ru.md)

Для ИИ-ассистентов в редакторе: [llms.txt](https://github.com/nightlightmare/llmmend/blob/main/llms.txt) и [llms-full.txt](https://github.com/nightlightmare/llmmend/blob/main/llms-full.txt) (на английском), они есть и в пакете.

## Размер

| Модуль          | min+brotli                        |
| --------------- | --------------------------------- |
| `llmmend/json`  | ~3.5 kB                           |
| `llmmend/sse`   | ~3.6 kB (один `parseSSE` ~0.9 kB) |
| `llmmend/chunk` | ~1.5 kB                           |

## Участие

Нашли ответ модели, с которым `llmmend` не справляется? [Откройте issue](https://github.com/nightlightmare/llmmend/issues/new?template=broken-reply.md) с исходным текстом: он станет тестовой фикстурой.

## Лицензия

MIT © nightlightmare
