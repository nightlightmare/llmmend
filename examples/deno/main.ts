import { chunkText } from 'llmmend/chunk'
import { streamText } from 'llmmend/sse'

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash'

// Two endpoints for a small RAG service on Deno Deploy:
//   POST /chunks?maxTokens=300   Markdown in, chunks with token counts and offsets out
//   POST /summarize              text in, Gemini's summary streamed back as plain text
export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'POST') return new Response('Not found', { status: 404 })

  if (url.pathname === '/chunks') {
    const maxTokens = Number(url.searchParams.get('maxTokens') ?? 300)
    // Overlap keeps a sentence that straddles two chunks findable from either.
    const chunks = chunkText(await request.text(), {
      maxTokens,
      overlap: Math.floor(maxTokens / 10),
      mode: 'markdown',
    })
    return Response.json(chunks)
  }

  if (url.pathname === '/summarize') {
    const upstream = await fetch(`${GEMINI}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') ?? '',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Summarize:\n\n${await request.text()}` }] }],
      }),
    })
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status })
    const text = ReadableStream.from(streamText(upstream))
    return new Response(text.pipeThrough(new TextEncoderStream()), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response('Not found', { status: 404 })
}

if (import.meta.main) Deno.serve(handler)
