# Examples

Small, complete apps that use `llmmend` the way you would in production. Each one runs as it is after `npm i llmmend` and the framework's own install; in this repo they use the local package (`workspace:*`), and CI runs every one against a stand-in for the provider API ([mock-fetch.ts](./mock-fetch.ts)), with no keys and no network.

| Example              | Runtime            | Shows                                                                                                                 |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [nextjs](./nextjs)   | Next.js App Router | A route handler streams Claude's JSON as partial values (`streamJson`); a client component renders them as they grow. |
| [hono](./hono)       | Node, Bun, Deno    | An endpoint extracts, repairs and validates the JSON in a reply with Zod (`collectText`, `extractJson`).              |
| [workers](./workers) | Cloudflare Workers | One proxy for any provider that keeps the key on the server and streams back plain text (`streamText`, `'auto'`).     |
| [deno](./deno)       | Deno Deploy        | RAG preparation: Markdown into token-sized chunks (`chunkText`), and a Gemini summary streamed back.                  |

## Running one

```bash
# Next.js: http://localhost:3000
cd examples/nextjs && ANTHROPIC_API_KEY=... npm run dev

# Hono on Node: POST http://localhost:3000/recipe {"dish": "pancakes"}
# Any OpenAI-compatible server, e.g. Ollama: OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:3b
cd examples/hono && OPENAI_API_KEY=... npm start

# Workers: set the key once, then run locally or deploy
cd examples/workers && npx wrangler secret put API_KEY && npm run dev

# Deno
cd examples/deno && GEMINI_API_KEY=... deno task start
```

Outside this repo, replace `"llmmend": "workspace:*"` with `"llmmend": "^0.2.0"` in `package.json`.

## Checks

`pnpm examples:check` (after `pnpm build`) type-checks the Node examples and runs each `check.ts` against the stand-in. The Deno example runs in CI's Deno job with `ci.imports.json`, which points `llmmend` at this repo's build:

```bash
cd examples/deno && deno run --import-map=ci.imports.json --allow-read --allow-env=GEMINI_API_KEY check.ts
```
