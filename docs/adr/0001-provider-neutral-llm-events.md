# Provider-neutral LLM events: stateful adapters, one Block sequence, no `n > 1`

`streamLlm` turns every Provider's stream into one sequence of LLM events, where `index` always means the Block's position in a single answer. Providers disagree on what `index` means (Anthropic: content block; OpenAI Chat Completions: alternative choice), so we picked the Block meaning and dropped alternative answers: the OpenAI adapter reads `choices[0]` only. Tool calls are split into `tool_call_start { index, id, name }` and `tool_call_delta { index, argsDelta }`, because OpenAI sends `id`/`name` only in the first delta and Anthropic in `content_block_start`.

Because adapters must remember earlier events of a stream (tool call ids, usage from `message_start`), a `ProviderAdapter` is a factory, `{ name, create(): (e: SSEEvent) => LlmEvent[] }`, called once per stream; a stateless `map(event)` would need shared mutable state and break under concurrent streams. Events an adapter does not recognise are emitted as `{ type: 'other', raw }` instead of being dropped, so new provider features reach users before llmmend ships support and the nightly real-API run can flag format drift.

## Considered Options

- **Support `n > 1`** by adding a `choice` dimension to every event: rejected, almost nobody streams multiple choices, and no other Provider has the concept.
- **One `tool_call` event carrying `id`/`name` on every delta**: rejected, redundant and hides the "tool call started" moment UIs need.
- **Silently drop unknown events**, or an `onUnknown` callback: rejected, the first hides breakage, the second keeps it out of the normal `switch`.
