import { fromGemini, type GeminiUsage } from '../../shared/usage'
import type { LlmEvent, ProviderAdapter, StopReason } from '../events'
import type { SSEEvent } from '../parse'
import { done, parseObject } from './shared'

interface RawPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id?: string; name?: string; args?: unknown }
}

/** The fields of a `streamGenerateContent` chunk this adapter reads. */
interface RawChunk {
  responseId?: string
  candidates?: { content?: { parts?: RawPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: GeminiUsage
  error?: { message?: string }
}

const REFUSED = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'ESCALATION',
  'PUP_LIMITED_DISABLED',
])
const FAILED = new Set([
  'MALFORMED_FUNCTION_CALL',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS',
  'MISSING_THOUGHT_SIGNATURE',
  'MALFORMED_RESPONSE',
])

// A function, not a Map built at module level, so bundlers can drop the adapter when unused.
function stopReason(raw: string, calledTools: boolean): StopReason {
  // Gemini ends an answer with function calls as `STOP` too.
  if (raw === 'STOP') return calledTools ? 'tool_use' : 'end'
  if (raw === 'MAX_TOKENS') return 'max_tokens'
  if (raw === 'CONTINUATION') return 'paused'
  if (REFUSED.has(raw)) return 'refused'
  return FAILED.has(raw) ? 'error' : 'unknown'
}

function create(): (event: SSEEvent) => LlmEvent[] {
  // Blocks follow Gemini's part order: a new one starts whenever the kind of part changes, and
  // every function call is its own, so a signature points at exactly one part.
  let blocks = 0
  let kind: 'text' | 'reasoning' | undefined
  let index = 0
  let calledTools = false
  let responseId: string | undefined

  return (sse) => {
    const raw = parseObject<RawChunk>(sse.data)
    if (raw?.error) return [{ type: 'error', message: raw.error.message ?? 'Provider error', raw }]
    if (!raw || (!raw.candidates && !raw.usageMetadata && !raw.promptFeedback)) {
      return [{ type: 'other', raw: sse }]
    }

    responseId ??= raw.responseId
    const events: LlmEvent[] = []
    // Only one answer per stream (ADR 0001): alternative candidates are ignored.
    const candidate = raw.candidates?.[0]
    let unknownPart = false
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        const call = part.functionCall
        index = blocks++
        kind = undefined
        calledTools = true
        events.push(
          { type: 'tool_call_start', index, id: call.id ?? '', name: call.name ?? '' },
          { type: 'tool_call_delta', index, argsDelta: JSON.stringify(call.args ?? {}) },
        )
      } else if (typeof part.text === 'string') {
        // Gemini ends a stream with an empty text part; only a signature gives it a meaning.
        if (!part.text && !part.thoughtSignature) continue
        const partKind = part.thought ? 'reasoning' : 'text'
        if (partKind !== kind) {
          kind = partKind
          index = blocks++
        }
        if (part.text) events.push({ type: partKind, index, text: part.text })
      } else if (!part.thoughtSignature) {
        unknownPart = true
        continue
      }
      if (part.thoughtSignature) {
        events.push({ type: 'reasoning_signature', index, signature: part.thoughtSignature })
      }
    }
    if (unknownPart) events.push({ type: 'other', raw: sse })

    if (raw.usageMetadata) events.push({ type: 'usage', ...fromGemini(raw.usageMetadata) })

    // The stream has no final event: the chunk with the finish reason is the last one.
    const blocked = raw.promptFeedback?.blockReason
    if (candidate?.finishReason) {
      const finish = candidate.finishReason
      events.push(...done(stopReason(finish, calledTools), finish, responseId))
    } else if (blocked && !candidate) {
      events.push(...done('refused', blocked, responseId))
    }
    return events
  }
}

/** Adapter for Google Gemini `streamGenerateContent` (`?alt=sse`). */
export const gemini: ProviderAdapter = { name: 'gemini', create }
