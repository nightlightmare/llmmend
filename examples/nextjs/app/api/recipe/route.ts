import { streamJson } from 'llmmend/sse'

export interface Recipe {
  title: string
  ingredients: string[]
  steps: string[]
}

/** One line of the response: the recipe so far, or the final result. */
export type RecipeLine =
  | { partial: Partial<Recipe> }
  | { recipe: Recipe; stopReason: string }
  | { error: string }

const API = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'

// Asks Claude for a recipe as JSON and streams it to the browser as it is written: one NDJSON
// line per change of the Partial value, then the repaired, complete recipe.
export async function POST(request: Request): Promise<Response> {
  const { dish } = (await request.json()) as { dish: string }
  const upstream = await fetch(`${API}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      stream: true,
      messages: [
        {
          role: 'user',
          content: `A recipe for ${dish} as JSON: {"title": string, "ingredients": string[], "steps": string[]}.`,
        },
      ],
    }),
    signal: request.signal,
  })
  if (!upstream.ok) return new Response(await upstream.text(), { status: 502 })

  const encoder = new TextEncoder()
  const send = (line: RecipeLine) => encoder.encode(`${JSON.stringify(line)}\n`)
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The model may wrap the JSON in prose or a code fence: streamJson finds it either way.
      for await (const item of streamJson<Recipe>(upstream, { expect: 'object' })) {
        if (!item.done) controller.enqueue(send({ partial: item.partial as Partial<Recipe> }))
        else if (item.result.ok)
          controller.enqueue(send({ recipe: item.result.value, stopReason: item.stopReason }))
        else controller.enqueue(send({ error: item.error ?? item.result.error }))
      }
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
}
