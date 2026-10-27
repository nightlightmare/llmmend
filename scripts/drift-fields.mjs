// The field comparison behind the drift check (drift.mjs), kept apart so it can run without Ollama.
import { readdir, readFile } from 'node:fs/promises'
import { parseSSE } from '../dist/sse/index.js'

/** The key paths of a JSON value, with array items as `[]`: `choices[].delta.content`. */
export function paths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) for (const item of value) paths(item, `${prefix}[]`, out)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      out.add(path)
      paths(item, path, out)
    }
  }
  return out
}

/** Every key path in the JSON data of an SSE stream. */
export async function payloadPaths(stream, out = new Set()) {
  for await (const event of parseSSE(stream)) {
    try {
      paths(JSON.parse(event.data), '', out)
    } catch {
      // `[DONE]` and other non-JSON data have no fields.
    }
  }
  return out
}

/**
 * The key paths of every recorded (not synthetic) fixture in one directory: what that API is
 * known to send. A fresh stream is compared with all of them, not just its own case, because a
 * model's output varies (a reply that stopped inside reasoning has no message fields).
 */
export async function knownFields(dir) {
  const known = new Set()
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sse'))) {
    const meta = JSON.parse(
      await readFile(new URL(file.replace(/\.sse$/, '.meta.json'), dir), 'utf8'),
    )
    if (meta.synthetic) continue
    await payloadPaths(new Response(await readFile(new URL(file, dir))).body, known)
  }
  return known
}

/** Fields in `fresh` that no recorded fixture of the API has. */
export const newFields = (fresh, known) => [...fresh].filter((path) => !known.has(path))
