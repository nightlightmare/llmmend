---
'llmmend': minor
---

Add `sseResponse` and `createSSEStream` to `llmmend/sse`, for serving server-sent events: an async iterable of events (`{ data, event?, id?, retry? }`) or plain values (sent as JSON) becomes a `text/event-stream` `Response` or byte stream, with optional keep-alive comments. A client that goes away calls `return()` on the source, so `sseResponse(streamLlm(upstream))` also stops the upstream request.
