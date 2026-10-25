---
'llmmend': minor
---

Add `streamToolCalls` to `llmmend/sse`, for UIs that render a tool call while the model writes it: yields each piece of text and each change of a call's Partial value (an unfinished number never shows; with `tools`, `partial` is typed as a deep partial of the tool schema's input, by name), then one final item with what `collectText` returns.
