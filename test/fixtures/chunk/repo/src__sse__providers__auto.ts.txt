import { LlmmendError } from '../../shared/errors'
import type { LlmEvent, ProviderAdapter } from '../events'
import type { SSEEvent } from '../parse'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import { openai } from './openai'
import { openaiResponses } from './openai-responses'
import { parseObject } from './shared'

/** How many undecided events to buffer before giving up. */
const MAX_UNDECIDED = 20

interface RawProbe {
  type?: unknown
  choices?: unknown
  candidates?: unknown
  promptFeedback?: unknown
  error?: { message?: string }
  message?: string
}

/** The adapter a payload's shape belongs to, `error` for an error in any known shape. */
function detect(raw: RawProbe): ProviderAdapter | 'error' | undefined {
  const { type } = raw
  if (type === 'error' || raw.error) return 'error'
  if (typeof type === 'string') {
    if (type.startsWith('response.')) return openaiResponses
    if (type.startsWith('message_') || type.startsWith('content_block_')) return anthropic
  }
  if (raw.choices) return openai
  if (raw.candidates || raw.promptFeedback) return gemini
  return undefined
}

function create(): (event: SSEEvent) => LlmEvent[] {
  let adapter: ((event: SSEEvent) => LlmEvent[]) | undefined
  // Events seen before the format was clear (`ping`, empty or non-JSON data), replayed later.
  const undecided: SSEEvent[] = []

  return (sse) => {
    if (adapter) return adapter(sse)
    const raw = parseObject<RawProbe>(sse.data)
    const found = raw && detect(raw)
    if (found === 'error') {
      // An error before the answer started looks alike for every Provider.
      return [
        { type: 'error', message: raw?.error?.message ?? raw?.message ?? 'Provider error', raw },
      ]
    }
    if (!found) {
      undecided.push(sse)
      if (undecided.length < MAX_UNDECIDED) return []
      throw new LlmmendError(
        'unknown_provider',
        `Cannot detect the Provider from the first ${MAX_UNDECIDED} events: pass \`provider\``,
      )
    }
    adapter = found.create()
    const decided = adapter
    return [...undecided.splice(0), sse].flatMap((event) => decided(event))
  }
}

/** Picks the adapter from the first event that shows the stream's format. */
export const auto: ProviderAdapter = { name: 'auto', create }
