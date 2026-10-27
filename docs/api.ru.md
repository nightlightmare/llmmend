[English](https://github.com/nightlightmare/llmmend/blob/main/docs/api.md) | [简体中文](https://github.com/nightlightmare/llmmend/blob/main/docs/api.zh-CN.md) | **Русский**

# Справочник API

В `llmmend` три модуля. Импортируйте из модуля или из корня: tree-shaking работает в обоих случаях.

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
- `{ ok: false, error, issues, at? }`, где `error` — одно из `not_found`, `unparseable`, `truncated`, `max_depth`; для `unparseable` и `truncated` `at` — место в ответе, где разбор не удался.

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

Возвращает значение или бросает `LlmmendJsonError`, у которого `code` — это `error` из описания выше, плюс `issues` и, для `schema_mismatch`, `schemaIssues`. Если в результате есть `at`, он есть и у ошибки, вместе с `line` и `column` (с 1, в символах), а сообщение показывает это место: переводы строк во фрагменте показаны как `⏎`, так что он остаётся одной строкой, а под ним стоит `^`.

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

### extractTag

```ts
import { extractTag } from 'llmmend/json'

const reply = 'Format: <answer>X</answer>\n<thinking>…</thinking>\n<answer lang="en">Paris</answer>'

const res = extractTag(reply, 'answer')
if (res.ok) console.log(res.value, res.attributes.lang) // 'Paris', 'en'
else if (res.error === 'truncated') console.log(res.partial) // тег обрезан: его текст на данный момент
else console.log(res.error) // 'not_found'
```

`extractTag(text, name, { pick? })` находит в ответе тег вроде `<answer>…</answer>` и возвращает его текст без пробельных краёв. Никогда не бросает исключений. Результат — одно из:

- `{ ok: true, value, attributes, issues }`: `attributes` — атрибуты открывающего тега (атрибут без значения даёт `''`); в `issues` будет `tag_case_mismatch`, если закрывающий тег отличается регистром (`<Answer>…</answer>`).
- `{ ok: false, error: 'truncated', partial }`: тег открылся после последнего закрытого, а ответ закончился раньше, обычно на `max_tokens`; `partial` — его текст на данный момент. Более ранний закрытый тег вместо него не возвращается.
- `{ ok: false, error: 'not_found' }`.

`pick` выбирает среди нескольких закрытых тегов: `'last'` (по умолчанию, чтобы пример формата из промпта не победил ответ) или `'first'`. Теги внутри блоков кода не считаются. Вложенные теги с тем же именем сопоставляются по глубине, побеждает внешний. Имя сравнивается без учёта регистра; сущности вроде `&lt;` остаются как есть.

### extractAllTags

```ts
import { extractAllTags } from 'llmmend/json'

const reply = '<step>Read the file</step>\n<step>Fix the bug</step>\n<answer>Done</answer>'
console.log(extractAllTags(reply, 'step').map((t) => t.value)) // ['Read the file', 'Fix the bug']
```

Все закрытые теги верхнего уровня в ответе по порядку, как `{ name, value, attributes, start, end }`; `start` и `end` охватывают тег целиком. С `name` — только теги с этим именем (при вложении — внешние). Правила те же, что у `extractTag`.

### extractCodeBlocks

````ts
import { extractCodeBlocks } from 'llmmend/json'

const reply =
  'Install:\n```bash\nnpm i llmmend\n```\nThen:\n```typescript title="app.ts"\nextractJson(reply)\n```'

extractCodeBlocks(reply).map((b) => b.lang) // ['bash', 'typescript']
extractCodeBlocks(reply, { lang: 'ts' })[0]?.code // 'extractJson(reply)'
````

`extractCodeBlocks(text, { lang? })` возвращает все блоки кода из ответа по порядку, как `{ lang, info, code, start, end, complete }`:

- `lang` — первое слово info-строки в нижнем регистре (`''`, если его нет), `info` — вся строка (`typescript title="app.ts"`).
- `code` — содержимое как есть, без переводов строки рядом с ограничителями; `start` и `end` охватывают блок от строки открывающего ограничителя до закрывающего.
- `complete: false` — блок, на котором ответ оборвался, обычно на `max_tokens`: решите, нужна ли вам половина файла.

Фильтр `lang` не учитывает регистр и знает синонимы: `ts`/`typescript`, `js`/`javascript`, `py`/`python`, `sh`/`bash`/`shell`/`zsh`, `yml`/`yaml`, `md`/`markdown`. Ограничители — ` ``` ` или `~~~`, закрываются только тем же символом не короче открывающего, поэтому внутри более длинного ограничителя можно показать другой блок. Блоки с отступом и ` ```inline``` ` в одну строку не считаются. `extractTag` по тем же правилам пропускает теги внутри кода.

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
| `tag_case_mismatch`      | `at`      | `extractTag`: закрывающий тег отличается регистром от открывающего.                   |

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

`streamLlm(source, { provider?, signal? })` превращает стрим провайдера в одну последовательность LLM-событий. `source` — это `Response` от `fetch` или его тело.

Провайдеры:

- `'auto'` (по умолчанию): выбирает адаптер по первому событию, по которому виден формат (события `message_*` — Anthropic; `response.*` — OpenAI Responses; `choices` — Chat Completions; `candidates` — Gemini). Неопределённые события вроде `ping` придерживаются, не больше 20, и прогоняются через адаптер, когда формат стал ясен; ошибка до начала ответа в любом из этих форматов приходит как `error`. Стрим, так и не показавший формат, заканчивается `done { stopReason: 'unknown' }`; 20 неопределённых событий подряд бросают `LlmmendError` с кодом `unknown_provider`. Чтобы пропустить определение, передайте провайдера явно.
- `'anthropic'`: Anthropic Messages API.
- `'openai'`: OpenAI Chat Completions и API, повторяющие его формат: OpenRouter, Groq, Ollama, DeepSeek, vLLM, LM Studio. Читается только первый вариант ответа; `n > 1` не поддерживается. OpenAI присылает расход токенов только с `stream_options: { include_usage: true }`.
- `'openai-responses'`: OpenAI Responses API (его же отдаёт Ollama по `/v1/responses`). Каждый элемент ответа — один блок с номером `output_index`; сводки рассуждений приходят как `reasoning`, а `encrypted_content` (при `include: ['reasoning.encrypted_content']`) — как `reasoning_signature`, который нужно вернуть вместе с этим блоком. Элементы `function_call` и `custom_tool_call` — вызовы инструментов; встроенные инструменты вроде веб-поиска приходят как `other`. Причины остановки: `response.completed` — это `end` (`tool_use` после вызовов инструментов, `refused` после отказа), у `response.incomplete` берётся причина (`max_output_tokens` → `max_tokens`, `content_filter` → `refused`), `response.failed` — это `error`.
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

| `type`                | Поля                                                                                         | Смысл                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | `index`, `text`                                                                              | Кусок текста ответа.                                                                                                                                                                                                                                                                      |
| `reasoning`           | `index`, `text`, `redacted?`                                                                 | Кусок рассуждения. В `redacted` лежат зашифрованные данные `redacted_thinking` от Anthropic; отправляйте их обратно без изменений.                                                                                                                                                        |
| `reasoning_signature` | `index`, `signature`, `itemId?`                                                              | Данные, которые нужно вернуть без изменений вместе с блоком `index`, продолжая разговор: подпись рассуждения от Anthropic или `thoughtSignature` от Gemini, который может оказаться на любой части (часто на вызове функции). `itemId` — элемент рассуждения в OpenAI Responses (`rs_…`). |
| `tool_call_start`     | `index`, `id`, `name`, `custom?`, `itemId?`                                                  | Начало вызова инструмента. `custom: true` — custom tool из OpenAI Responses, его ввод — произвольный текст, а не JSON. `itemId` — элемент вызова функции в OpenAI Responses (`fc_…`).                                                                                                     |
| `tool_call_delta`     | `index`, `argsDelta`                                                                         | Кусок JSON-аргументов вызова; склеивайте по порядку.                                                                                                                                                                                                                                      |
| `usage`               | `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` | Расход токенов на текущий момент.                                                                                                                                                                                                                                                         |
| `done`                | `stopReason`, `rawStopReason?`, `responseId?`                                                | Конец стрима. `responseId` — id ответа у провайдера.                                                                                                                                                                                                                                      |
| `error`               | `message`, `raw`                                                                             | Провайдер сообщил об ошибке посреди стрима.                                                                                                                                                                                                                                               |
| `other`               | `raw`                                                                                        | Событие, которого адаптер не знает, в том виде, в каком его разобрал `parseSSE`.                                                                                                                                                                                                          |

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

`rawStopReason` хранит исходную строку провайдера. `responseId` — id ответа у провайдера: Anthropic `msg_…`, Chat Completions `chatcmpl-…` (у совместимых API бывают другие), Responses `resp_…` (для `previous_response_id`), Gemini `responseId`. Он приходит с финальным событием самого провайдера, поэтому у `done`, который `streamLlm` добавляет после ошибки или оборванного стрима, его нет. Вместе с `itemId` у `tool_call_start` и `reasoning_signature` это позволяет клиенту, который сам хранит историю Responses, отправить эти элементы обратно.

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

Читает стрим целиком и возвращает `{ text, stopReason, usage?, responseId?, toolCalls }` с последним снимком расхода токенов.

#### Вызовы инструментов

```ts
import { collectText } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  get_weather: z.object({ city: z.string(), days: z.number().int().default(1) }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })
const { toolCalls, stopReason } = await collectText(res, { tools })

for (const call of toolCalls) {
  if (!call.ok) console.log(call.name, call.error) // отправить модели как tool_result с ошибкой
  else if (!call.custom && call.name === 'get_weather') console.log(call.args.city, call.args.days) // тип из схемы
}
```

`toolCalls` — вызовы инструментов из ответа в порядке блоков. Пригодный вызов — `{ ok: true, index, id, name, args, issues }`: аргументы проходят починку синтаксиса (как при `repair: 'syntax'`), а `issues` перечисляет исправления; пустые аргументы дают `{}`. С опцией `tools` (любая Standard Schema для каждого имени инструмента, асинхронные тоже) `args` — выход схемы, а тип выводится по `name`.

Непригодный вызов — `{ ok: false, index, id, name, error, argsText, issues }`, аргументы в том виде, как их написала модель, лежат в `argsText`:

| `error`           | Значение                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `truncated`       | Аргументы обрезаны, обычно при `stopReason: 'max_tokens'`; не достраиваются, потому что выполнять половину вызова опасно. |
| `unparseable`     | Не JSON даже после починки синтаксиса.                                                                                    |
| `max_depth`       | Вложенность глубже 512 уровней.                                                                                           |
| `schema_mismatch` | Схема инструмента отвергла аргументы; причины в `schemaIssues`.                                                           |
| `unknown_tool`    | Опция `tools` задана, но такого имени в ней нет.                                                                          |

Custom tool из OpenAI Responses принимает произвольный текст вместо JSON: его вызов — `{ ok: true, custom: true, …, input }` с текстом как есть, а схема, если задана, проверяет этот текст.

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

Учитывается только текст: рассуждения и аргументы вызовов инструментов пропускаются, а все текстовые блоки образуют один ответ. Бросает только то, что бросает `streamLlm`. Разбор инкрементальный: текстовое событие стоит примерно столько, сколько его собственная длина, плюс поверхностная копия открытых массивов и объектов, когда значение меняется, поэтому даже сотни килобайт обрабатываются быстро. Последовательные значения `partial` разделяют уже завершённые части; не изменяйте их.

### streamToolCalls

```ts
import { streamToolCalls } from 'llmmend/sse'
import { z } from 'zod'

const tools = {
  show_gauge: z.object({ value: z.number(), max: z.number() }),
}
const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '…' })

for await (const item of streamToolCalls(res, { tools })) {
  if (item.done) console.log(item.toolCalls) // то, что вернул бы collectText
  else if (item.type === 'text') console.log(item.text) // текст ответа по кусочкам
  else if (item.name === 'show_gauge') console.log(item.partial.value, item.partial.max) // number | undefined, недописанным не бывает
}
```

Стримит ответ с вызовами инструментов — для интерфейсов, которые рисуют вызов, пока модель его пишет. Выдаёт:

- `{ done: false, type: 'text', text }` на каждый кусок текста ответа;
- `{ done: false, type: 'tool_call', index, id, name, custom?, partial }` каждый раз, когда частичное значение вызова меняется. `partial` читается так же, как JSON в `parsePartialJson`, поэтому недописанное число не показывается; у custom tool `partial` — текст, написанный на данный момент.

С опцией `tools` тип `partial` — глубокий partial от входного типа схемы инструмента с сужением по `name` (дефолты и преобразования применяются только к итоговым `args`), а вызов инструмента не из `tools` ничего не выдаёт, пока не закончится как `unknown_tool`.

В конце приходит один итоговый элемент: `{ done: true }` со всем, что возвращает `collectText`. Рассуждения модели не выдаются: их читает `streamLlm`. Каждая дельта аргументов заново разбирает аргументы своего вызова, для аргументов в несколько килобайт это нормально.

### sseResponse

```ts
import { sseResponse, streamLlm } from 'llmmend/sse'

// Серверный маршрут, который передаёт стрим модели в браузер в виде LLM-событий.
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

// В браузере.
const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: [] }) })
for await (const event of parseSSE(res.body!)) {
  const ev = JSON.parse(event.data) as LlmEvent
  if (ev.type === 'text') console.log(ev.text)
}
```

`sseResponse(source, init?)` отдаёт асинхронный итерируемый источник как server-sent events в `Response` с заголовками `content-type: text/event-stream`, `cache-control: no-cache` и `x-accel-buffering: no` (чтобы nginx не придерживал события), если `init` не задаёт их сам. `init` — это `ResponseInit` плюс `keepAlive`. `createSSEStream(source, { keepAlive? })` даёт тот же поток как `ReadableStream<Uint8Array>` — для серверов, которые принимают тело, а не `Response`.

Каждый элемент `source` — событие `{ data, event?, id?, retry? }` или просто значение. Строковый `data` уходит как есть, всё остальное — через `JSON.stringify`; многострочные данные становятся несколькими строками `data:`, которые `parseSSE` снова склеивает. Объект считается событием, только если в нём есть `data` и нет других ключей, кроме `event`, `id` и `retry`, поэтому LLM-события уходят как JSON. `event` или `id` с переводом строки, `retry`, не являющийся целым числом, или ошибка источника переводят поток в ошибку.

`keepAlive` (в миллисекундах, по умолчанию выключен) отправляет комментарий `:`, если столько времени не было событий, чтобы прокси не обрывали тихое соединение, например пока модель думает. Когда клиент уходит, поток вызывает у источника `return()`: `streamLlm` тогда отменяет запрос к провайдеру, как только придёт его следующий кусок.

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

## llmmend/chunk

### chunkText

```ts
import { chunkText } from 'llmmend/chunk'

const text = 'One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.'
chunkText(text, { maxTokens: 10 }).map((c) => c.text)
// ['One two three. Four five six.\n\n', 'Seven eight nine. Ten eleven twelve.']
```

`chunkText(text, options)` режет текст на чанки не больше `maxTokens` токенов и возвращает `{ text, start, end, tokens, index, oversized?, headings? }[]`.

| Опция         | По умолчанию     | Смысл                                                                                               |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `maxTokens`   | (обязательна)    | Бюджет на чанк.                                                                                     |
| `overlap`     | `0`              | Сколько токенов повторить с конца предыдущего чанка.                                                |
| `countTokens` | `estimateTokens` | Счёт настоящим токенизатором для точного бюджета.                                                   |
| `separators`  | см. ниже         | Строки или регулярные выражения, от крупных к мелким; `''` режет между кластерами графем.           |
| `mode`        | `'text'`         | `'markdown'` начинает чанки с заголовков и оставляет блоки кода и таблицы целыми, если они влезают. |

Разделители по умолчанию: абзацы (`\n\n`), строки, предложения (`.`, `!`, `?`, `…` с пробелом после или `。！？`), слова, затем кластеры графем. В режиме `markdown` первыми идут заголовки (от `#` до `####`). Текст режется по самому крупному разделителю, при котором куски влезают, а затем куски склеиваются обратно, пока влезают вместе.

Гарантии:

- `chunk.text === text.slice(chunk.start, chunk.end)`, а `tokens` — это `countTokens(chunk.text)`.
- `tokens <= maxTokens`, если только чанк не `oversized`: никакой разделитель не смог разрезать его мельче (с разделителями по умолчанию это один кластер графем).
- Чанки идут по порядку без пропусков; без перекрытия каждый начинается там, где кончился предыдущий, и склейка даёт исходный текст. С перекрытием чанк начинается внутри предыдущего, на разделителе, который даёт самое длинное перекрытие в пределах и `overlap`, и `maxTokens`.
- Кластер графем (эмодзи с модификаторами, буква с диакритикой) никогда не разрезается.

#### Пути заголовков

```ts
import { chunkText } from 'llmmend/chunk'

const doc = '# Install\n\nPick your system.\n\n## Linux\n\nRun the script.'
for (const chunk of chunkText(doc, { maxTokens: 8, mode: 'markdown' })) {
  const context = chunk.headings?.join(' › ') // сначала 'Install', затем 'Install › Linux'
  console.log(`${context}\n\n${chunk.text}`)
}
```

В режиме `markdown` у каждого чанка есть `headings`: заголовки, действующие там, где начинается его собственный текст, от внешнего к внутреннему. Чанк, который начинается с заголовка, включает его; чанк из нескольких маленьких разделов получает путь первого; перекрытие в начале чанка не учитывается. Учитываются ATX-заголовки всех уровней (от `#` до `######`, в том числе мельче разделителей) и setext-заголовки (строка `===` или `---` под текстом); заголовки внутри блоков кода — нет. Снимаются только маркеры, inline-разметка остаётся как есть. Чтобы дать этот контекст модели эмбеддингов, поставьте путь перед текстом чанка, как выше: сам чанк, его позиции и число токенов не меняются.

### chunkDocuments

```ts
import { chunkDocuments } from 'llmmend/chunk'

const pages = [
  { text: 'First page…', metadata: { source: 'guide.pdf', page: 1 } },
  { text: 'Second page…', metadata: { source: 'guide.pdf', page: 2 } },
]
for (const chunk of chunkDocuments(pages, { maxTokens: 500 })) {
  console.log(chunk.doc, chunk.index, chunk.metadata.page) // 0 0 1, затем 1 0 2
}
```

`chunkDocuments(docs, options)` разбивает несколько документов через `chunkText` и возвращает все их чанки одним массивом. У каждого чанка ещё есть `doc` — позиция документа в `docs` — и `metadata`, переданные как есть и типизированные по входу. `index` нумеруется внутри каждого документа, `start` и `end` — позиции в этом документе, опции применяются к каждому документу (включая `headings`). Перекрытия между документами нет: если предложение может переходить со страницы на страницу, склейте страницы до разбиения.

### estimateTokens

```ts
import { estimateTokens } from 'llmmend/chunk'

estimateTokens('Hello, world!') // 3
```

Оценивает число токенов без словаря, по видам символов в тексте. Измеренная точность против токенизаторов OpenAI, Gemini и Claude приведена в README; токенизатор Claude даёт примерно в 1,5 раза больше токенов.

### truncateToTokens

```ts
import { truncateToTokens } from 'llmmend/chunk'

truncateToTokens('The quick brown fox jumps over the lazy dog', 5, {
  from: 'middle',
  ellipsis: ' … ',
})
// 'The quick … lazy dog'
```

`truncateToTokens(text, max, { from?, ellipsis?, countTokens? })` укорачивает текст до `max` токенов, не разрезая кластеры графем. `from` говорит, где резать: `'end'` (по умолчанию) оставляет начало, `'start'` — конец, `'middle'` — и то и другое. `ellipsis` (по умолчанию `''`) отмечает место разреза и учитывается в `max`; если не влезает даже он, результат — `''`.

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

| Класс              | `code`                                                                  | Доп. поля                                            |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `LlmmendJsonError` | `not_found`, `unparseable`, `truncated`, `schema_mismatch`, `max_depth` | `issues`, `schemaIssues?`, `at?`, `line?`, `column?` |
| `LlmmendHttpError` | `http_error`                                                            | `status`, `headers`, `body`                          |
| `LlmmendError`     | `async_schema`, `unknown_provider`                                      |                                                      |

У каждого класса свой `name`, поэтому ошибки можно различить и без `instanceof`, когда загружены две копии пакета.

## Версионирование

Объединения, по которым вы делаете `switch` (`Issue['code']`, `ExtractError`, `StopReason`, `LlmEvent['type']`, `LlmmendError['code']`), закрыты, поэтому TypeScript проверяет ваш `switch`. Добавление варианта — минорный релиз; удаление или переименование — мажорный. Оставляйте ветку `default`.
