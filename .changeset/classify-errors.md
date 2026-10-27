---
'llmmend': minor
---

New module `llmmend/retry`: `classifyError(error)` sorts a failed model call (an `LlmmendHttpError`, a stream `error` event, a `fetch` error, or an official SDK's API error) into one of eleven kinds with `retryable`, the Provider's `retryAfter` in milliseconds, `status` and the Provider's own `message`. It tells a 429 that means out of credit from a rate limit, and a 400 about prompt length from other bad requests.
