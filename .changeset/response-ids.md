---
'llmmend': minor
---

`done` carries `responseId`, the Provider's id of the response (Anthropic `msg_…`, Chat Completions `chatcmpl-…`, Responses `resp_…` for `previous_response_id`, Gemini `responseId`), and `collectText` and `streamToolCalls` return it. In OpenAI Responses streams, `tool_call_start` and `reasoning_signature` carry `itemId` (`fc_…`, `rs_…`), so a client that keeps the history itself can send those items back.
