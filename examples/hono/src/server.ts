// Node entry point. On Bun, Deno or Cloudflare Workers, export `app` as the default instead.
import { serve } from '@hono/node-server'
import { app } from './app.ts'

serve({ fetch: app.fetch, port: 3000 }, (info) =>
  console.log(`POST http://localhost:${info.port}/recipe {"dish": "pancakes"}`),
)
