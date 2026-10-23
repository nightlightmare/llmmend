# Fixture requests

Each `<provider>/<case>.json` describes one real request that `scripts/record-fixture.mjs` sends to record a fixture.

```json
{
  "description": "What this case covers",
  "save": "sse",
  "body": { "model": "...", "stream": true }
}
```

- `body` is sent as-is, except that `{{filler:N}}` inside any string becomes N deterministic words (used to get a prompt long enough to cache).
- `save: "sse"` (default) writes the raw response bytes to `test/fixtures/sse/<provider>/<case>.sse`.
- `save: "reply"` sends a non-streaming request and writes the reply text to `test/fixtures/llm-replies/real-<provider>-<case>.txt` for the `json` corpus; write its `.expected.json` by hand.
- Every recording gets a sidecar `.meta.json` (model, date, `synthetic: false`). Hand-written fixtures set `synthetic: true` and a `source` link.

Cases run in alphabetical order, so `cache-1-write` runs before `cache-2-read`.

## Recording

```sh
# keys in the environment or in .env (git-ignored)
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... OPENROUTER_API_KEY=... pnpm record
pnpm record --list            # show all cases
pnpm record anthropic         # one provider
pnpm record openai/text       # one case
```

Without an Anthropic key, record the `anthropic` cases through Claude in Amazon Bedrock, which serves the same Messages API and SSE: `ANTHROPIC_VIA=bedrock pnpm record anthropic`. The script takes temporary credentials from the AWS CLI (`aws configure export-credentials`, so `aws login`, SSO or a profile all work), signs with `curl --aws-sigv4`, and marks the fixtures `via: "bedrock"`. `AWS_REGION` defaults to `us-east-1`.

Ollama needs no key; it must be running locally with the models named in `ollama/*.json` pulled (`OLLAMA_BASE_URL` overrides `http://localhost:11434`). A provider whose key is missing is skipped.

Recording costs a few cents per run. Re-record a case when a Provider changes its format, and review the diff of the `.sse` file before committing.
