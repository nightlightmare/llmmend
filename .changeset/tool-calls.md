---
'llmmend': minor
---

`collectText` returns the answer's tool calls in `toolCalls`, in Block order: arguments get syntax Repair and come as `args`, cut-off arguments are reported as `truncated` and never completed, and with `tools` (a Standard Schema per tool name) each call is validated, typed by its name, and a call to an unlisted tool fails with `unknown_tool`. `tool_call_start` carries `custom: true` for OpenAI Responses custom tools, whose free-form input `toolCalls` returns as `input`.
