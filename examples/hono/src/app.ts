import { Hono } from 'hono'
import { extractJson } from 'llmmend/json'
import { collectText } from 'llmmend/sse'
import { z } from 'zod'

const Recipe = z.object({
  title: z.string(),
  minutes: z.number().int().positive(),
  ingredients: z.array(z.string()).min(1),
})

// Any OpenAI-compatible server: OpenAI, OpenRouter, Groq, or a local Ollama
// (OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:3b).
const API = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5-mini'

export const app = new Hono()

// Asks the model for a recipe, then extracts, repairs and validates the JSON in its reply.
// 200 with the typed recipe, or 422 with what went wrong, ready to send back to the model.
app.post('/recipe', async (c) => {
  const { dish } = await c.req.json<{ dish: string }>()
  const response = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        {
          role: 'user',
          content: `A recipe for ${dish} as JSON with "title", "minutes" and "ingredients".`,
        },
      ],
    }),
  })
  if (!response.ok) return c.json({ error: `provider returned ${response.status}` }, 502)

  const { text, stopReason } = await collectText(response)
  const result = extractJson(text, { schema: Recipe })
  if (!result.ok)
    return c.json(
      {
        error: result.error,
        stopReason,
        schemaIssues: result.error === 'schema_mismatch' ? result.schemaIssues : undefined,
      },
      422,
    )
  // `repaired` and `issues` say what was fixed: worth logging to see how often a model slips.
  return c.json({ recipe: result.value, repaired: result.repaired, issues: result.issues })
})
