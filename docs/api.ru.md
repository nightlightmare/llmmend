[English](https://github.com/nightlightmare/llmmend/blob/main/docs/api.md) | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/api.zh-CN.md) | **Русский**

# Справочник API

В `llmmend` два модуля. Импортируйте из модуля или из корня: tree-shaking работает в обоих случаях.

```ts
import { extractJson } from 'llmmend/json'
import { streamLlm } from 'llmmend/sse'
import { collectText, repairJson } from 'llmmend'
```

Несколько терминов, которые встречаются ниже:

- **Reply** (ответ): весь текст, который вернула модель, вместе со всем, что окружает JSON.
- **Candidate** (кандидат): объект или массив, найденный в ответе. Отдельная строка или число кандидатом не бывает.
- **Issue**: запись об одной вещи, которую llmmend исправил или пропустил, чтобы получить значение.
- **Block** (блок): одна часть ответа в стриме (текст, рассуждение или вызов инструмента), нумерация с 0.

## llmmend/json

### extractJson

```ts
import { extractJson } from 'llmmend/json'

const res = extractJson('Here you go: {"city": "Paris", "temp": 21,}')
if (res.ok) console.log(res.value, res.issues)
else console.log(res.error)
```

`extractJson(text, options?)` находит JSON в ответе, чинит его и, если передана схема, валидирует. На плохих входных данных никогда не бросает исключений.

Опции:

| Опция    | Значения                                            | По умолчанию | Смысл                                                                                                                                                                         |
| -------- | --------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | любая [Standard Schema](https://standardschema.dev) | нет          | Проверить значение; `value` получает выходной тип схемы.                                                                                                                      |
| `pick`   | `'first'`, `'last'`, `'largest'`                    | `'last'`     | Какого кандидата брать, если в ответе их несколько.                                                                                                                           |
| `repair` | `'full'`, `'syntax'`, `'none'`                      | `'full'`     | `'full'` исправляет синтаксис и закрывает обрезанное значение; `'syntax'` исправляет синтаксис, но обрезанное значение возвращает как `truncated`; `'none'` разбирает строго. |
| `expect` | `'object'`, `'array'`, `'any'`                      | `'any'`      | Рассматривать только объекты или только массивы.                                                                                                                              |

Результат — одно из:

- `{ ok: true, value, repaired, issues, raw }`: `repaired` равно true, если исправлено что-то кроме срезания окружающего текста; `raw` — текст кандидата.
- `{ ok: false, error: 'schema_mismatch', issues, schemaIssues, value }`: JSON разобран, но схема его отвергла. `schemaIssues` приходят от схемы, их можно отправить обратно модели.
- `{ ok: false, error, issues }`, где `error` — одно из `not_found`, `unparseable`, `truncated`, `max_depth`.

Если ответ обрывает объект или массив после последнего полного кандидата, настоящий ответ — именно обрезанный: с `repair: 'syntax'` результат будет `truncated`, а не более ранний кандидат (часто это пример формата из промпта).

```ts
import { extractJson } from 'llmmend/json'

const reply = 'Format: {"x": 0}. Answer: {"x": 1, "y": [1, 2'

extractJson(reply) // ok, value { x: 1, y: [1, 2] }, в issues есть truncated_closed
extractJson(reply, { repair: 'syntax' }) // { ok: false, error: 'truncated', issues: [] }
```

Вложенность глубже 512 уровней даёт `max_depth`.

### extractJsonAsync

```ts
import { extractJsonAsync } from 'llmmend/json'
import { z } from 'zod'

const schema = z.object({ user: z.string() }).refine(async (v) => v.user !== 'admin')
const res = await extractJsonAsync('{"user": "ada"}', { schema })
```

То же, что `extractJson`, для схем с асинхронной валидацией. Встретив такую схему, `extractJson` бросает `LlmmendError` с кодом `async_schema`.

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

Возвращает значение или бросает `LlmmendJsonError`, у которого `code` — это `error` из описания выше, плюс `issues` и, для `schema_mismatch`, `schemaIssues`.

### extractAllJson

```ts
import { extractAllJson } from 'llmmend/json'

extractAllJson('First {"a": 1}, then [2, 3] and {"b": 2}') // [{ a: 1 }, [2, 3], { b: 2 }]
```

Все кандидаты ответа по порядку. Принимает те же опции, кроме `pick`; со схемой возвращает только значения, которые её прошли.

### repairJson

```ts
import { repairJson } from 'llmmend/json'

const { json, issues } = repairJson("{'a': NaN, b: None, // note\n}")
console.log(json) // {"a":null,"b":null}
console.log(issues.map((issue) => issue.code))
```

Чинит текст JSON и возвращает валидный JSON строкой вместе с исправленными Issues. Весь текст должен быть одним значением: для ответа с текстом вокруг используйте `extractJson`. Бросает `LlmmendJsonError`, если текст починить нельзя.

### parsePartialJson

```ts
import { parsePartialJson } from 'llmmend/json'

parsePartialJson('{"title": "Hel') // { value: { title: 'Hel' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 4') // { value: { title: 'Hello' }, complete: false }
parsePartialJson('{"title": "Hello", "count": 42}') // { value: { title: 'Hello', count: 42 }, complete: true }
```

Читает JSON, который ещё приходит, для интерфейсов, показывающих ответ по мере генерации. Пропускает вступление и ограждение кода в ответе и возвращает первый объект или массив настолько, насколько он уже пришёл:

- недописанная строка показывается как есть и растёт по мере прихода текста;
- недописанное число или литерал и ключ без значения не показываются, пока не допишутся;
- значение, однажды показанное законченным, потом не меняется.

`complete` становится true, когда приходит закрывающая скобка. `value` равно `undefined`, пока не начался объект или массив. Никогда не бросает исключений.

### Issues

Каждый результат перечисляет по порядку, что было сделано с ответом.

| `code`                   | Доп. поле | Что исправлено                                                                        |
| ------------------------ | --------- | ------------------------------------------------------------------------------------- |
| `stripped_wrapper`       | `detail`  | Пропущен текст или ограждение кода вокруг JSON, например `'code fence, text before'`. |
| `trailing_comma`         | `at`      | Запятая перед `}` или `]`.                                                            |
| `single_quotes`          | `at`      | Строка в одинарных кавычках.                                                          |
| `unquoted_key`           | `at`      | Ключ без кавычек.                                                                     |
| `python_literal`         | `at`      | `True`, `False` или `None`.                                                           |
| `non_finite_number`      | `at`      | `NaN` или `Infinity`, заменены на `null`.                                             |
| `unescaped_control_char` | `at`      | Сырой перевод строки или табуляция внутри строки.                                     |
| `comment_removed`        | `at`      | Комментарий `//` или `/* */`.                                                         |
| `truncated_closed`       | `closed`  | Обрезанное значение закрыто скобками из `closed`.                                     |

`at` — позиция в тексте.

## llmmend/sse

### parseSSE

```ts
import { parseSSE } from 'llmmend/sse'

const res = await fetch('https://example.com/events')
for await (const event of parseSSE(res.body ?? new ReadableStream())) {
  console.log(event.event, event.data, event.id)
}
```

Парсер server-sent events, [соответствующий стандарту WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html). Принимает `ReadableStream<Uint8Array>` или асинхронный итератор байтов либо строк и выдаёт `{ event, data, id?, retry? }`:

- `event` равно `'message'`, если у события нет имени;
- строки `data` склеиваются через `\n`;
- `id` и `retry` сохраняются между событиями, как требует стандарт.

Чанки могут разрезать строки и символы UTF-8 где угодно. Поддерживаются окончания строк CRLF, LF и CR и BOM в начале. Событие, не законченное к концу стрима, отбрасывается. Опция `signal` отменяет источник, и цикл бросает `AbortError`; ранний выход из цикла тоже отменяет источник.

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

`streamLlm(source, { provider, signal? })` превращает стрим провайдера в одну последовательность LLM-событий. `source` — это `Response` от `fetch` или его тело.

Провайдеры:

- `'anthropic'`: Anthropic Messages API.
- `'openai'`: OpenAI Chat Completions и API, повторяющие его формат: OpenRouter, Groq, Ollama, DeepSeek, vLLM, LM Studio. Читается только первый вариант ответа; `n > 1` не поддерживается. OpenAI присылает расход токенов только с `stream_options: { include_usage: true }`.
- `'gemini'`: Google Gemini `streamGenerateContent` (`?alt=sse`). Читается только первый кандидат. Новый блок начинается, когда меняется вид части (рассуждение ↔ текст), и у каждого вызова функции свой блок, поэтому блоки идут в том же порядке, что части у Gemini. Вызовы функций приходят целиком: `tool_call_start`, затем один `tool_call_delta`.
- свой адаптер, см. ниже.

### LLM-события

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

| `type`                | Поля                                                                                         | Смысл                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | `index`, `text`                                                                              | Кусок текста ответа.                                                                                                                                                                                                          |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | Кусок рассуждения. В `redacted` лежат зашифрованные данные `redacted_thinking` от Anthropic; отправляйте их обратно без изменений.                                                                                            |
| `reasoning_signature` | `index`, `signature`                                                                         | Данные, которые нужно вернуть без изменений вместе с блоком `index`, продолжая разговор: подпись рассуждения от Anthropic или `thoughtSignature` от Gemini, который может оказаться на любой части (часто на вызове функции). |
| `tool_call_start`     | `index`, `id`, `name`                                                                        | Начало вызова инструмента.                                                                                                                                                                                                    |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | Кусок JSON-аргументов вызова; склеивайте по порядку.                                                                                                                                                                          |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | Расход токенов на текущий момент.                                                                                                                                                                                             |
| `done`                | `stopReason`, `rawStopReason?`                                                               | Конец стрима.                                                                                                                                                                                                                 |
| `error`               | `message`, `raw`                                                                             | Провайдер сообщил об ошибке посреди стрима.                                                                                                                                                                                   |
| `other`               | `raw`                                                                                        | Событие, которого адаптер не знает, в том виде, в каком его разобрал `parseSSE`.                                                                                                                                              |

`index` — это номер блока: текст, рассуждение и каждый вызов инструмента получают свой номер, одинаково для всех провайдеров. `tool_call_delta` всегда приходит после `tool_call_start` с тем же `index`.

`usage` — это снимок итогов: берите последний, никогда не складывайте. `inputTokens` всегда включает закэшированные токены.

Причины остановки:

| `stopReason`    | Anthropic                                     | OpenAI                         | Gemini                                                                                       |
| --------------- | --------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `end`           | `end_turn`                                    | `stop`                         | `STOP`                                                                                       |
| `max_tokens`    | `max_tokens`, `model_context_window_exceeded` | `length`                       | `MAX_TOKENS`                                                                                 |
| `tool_use`      | `tool_use`                                    | `tool_calls`, `function_call`  | `STOP` после вызовов функций                                                                 |
| `stop_sequence` | `stop_sequence`                               |                                |                                                                                              |
| `refused`       | `refusal`                                     | `content_filter`               | `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, …; заблокированный промпт |
| `paused`        | `pause_turn`                                  |                                | `CONTINUATION`                                                                               |
| `error`         | событие `error`                               | объект `error` в данных        | объект `error` в данных; `MALFORMED_FUNCTION_CALL`, `MISSING_THOUGHT_SIGNATURE`, …           |
| `unknown`       | что-то другое или нет финального события      | что-то другое или нет `[DONE]` | что-то другое или нет причины остановки                                                      |

`rawStopReason` хранит исходную строку провайдера.

Ошибки и конец стрима:

- `Response` со статусом не 2xx бросает `LlmmendHttpError` со `status`, `headers` и телом ответа в `body` ещё до первого события.
- `done` приходит ровно один раз и всегда последним. Ошибка провайдера посреди стрима приходит как `error`, затем `done` со `stopReason: 'error'`; исключение не бросается. Стрим, закончившийся без финального события, получает `done` со `stopReason: 'unknown'`.
- Прерывание через `signal` бросает `AbortError` и отменяет источник.

Новые типы событий и причины остановки могут появиться в минорных релизах: оставляйте ветку `default` в своём `switch`.

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

Выдаёт только текст ответа. Чтобы узнать, почему ответ закончился, используйте `collectText` или `streamLlm`.

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

Читает стрим целиком и возвращает `{ text, stopReason, usage? }` с последним снимком расхода токенов.

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
  if (!item.done) console.log(item.partial) // растёт по мере того, как модель пишет
  else if (item.result.ok) console.log(item.result.value.steps) // типизировано схемой
  else console.log(item.result.error, item.stopReason) // например schema_mismatch, max_tokens
}
```

Стримит ответ, в котором есть JSON. Пока ответ приходит, `streamJson` выдаёт `{ done: false, partial, complete }` каждый раз, когда меняется частичное значение. Частичное значение — это кандидат, которого `pick` выбрал бы из текста на данный момент (по умолчанию последний, поэтому пример формата во вступлении не перебивает ответ), прочитанный так, как читает `parsePartialJson`. Пока не начался объект или массив, ничего не выдаётся.

Затем выдаётся ровно один финальный элемент, `done: true`, в котором:

- `result`: `extractJsonAsync` по всему ответу с теми же опциями (`schema`, `pick`, `repair`, `expect`), поэтому несовпадение со схемой или обрезанное значение — это результат, а не исключение, и асинхронные схемы работают;
- `partial` и `complete`: последнее частичное значение;
- `text`: весь ответ;
- `stopReason`, `rawStopReason?`, `usage?` и `error?` с сообщением об ошибке провайдера посреди стрима.

Учитывается только текст: рассуждения и аргументы вызовов инструментов пропускаются, а все текстовые блоки образуют один ответ. Бросает только то, что бросает `streamLlm`. Каждое текстовое событие заново разбирает весь ответ, поэтому затраты растут с квадратом его длины: для обычного структурированного вывода это незаметно, для сотен килобайт — медленно.

### Свои адаптеры провайдеров

```ts
import { type ProviderAdapter, streamLlm } from 'llmmend/sse'

// Провайдер, который шлёт куски {"t": "..."} и {"end": true} в конце.
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

Адаптер превращает каждое разобранное SSE-событие в ноль или больше LLM-событий. `create()` вызывается один раз на стрим, поэтому состояние стрима храните в его замыкании. Гарантии добавляет `streamLlm`: останавливается после `done`, ставит `done` после `error` и добавляет `done`, если стрим закончился без него.

## Ошибки

```ts
import { LlmmendError, LlmmendHttpError } from 'llmmend'

function describe(error: unknown): string {
  if (error instanceof LlmmendHttpError) return `HTTP ${error.status}: ${error.body}`
  if (error instanceof LlmmendError) return error.code
  return String(error)
}
```

Все ошибки, которые бросает llmmend, наследуют `LlmmendError` с полем `code`:

| Класс              | `code`                                                                  | Доп. поля                   |
| ------------------ | ----------------------------------------------------------------------- | --------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`   |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body` |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                             |

У каждого класса свой `name`, поэтому ошибки можно различить и без `instanceof`, когда загружены две копии пакета.

## Версионирование

Объединения, по которым вы делаете `switch` (`Issue['code']`, `ExtractError`, `StopReason`, `LlmEvent['type']`, `LlmmendError['code']`), закрыты, поэтому TypeScript проверяет ваш `switch`. Добавление варианта — минорный релиз; удаление или переименование — мажорный. Оставляйте ветку `default`.
