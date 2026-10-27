import { type AnthropicUsage, fromAnthropic } from '../../shared/usage'
import type { LlmEvent, ProviderAdapter, StopReason } from '../events'
import type { SSEEvent } from '../parse'
import { done, mapStop, parseObject } from './shared'

/** The fields of the Messages API stream events this adapter reads. */
interface RawEvent {
  type?: string
  index?: number
  message?: { id?: string; usage?: AnthropicUsage }
  content_block?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    data?: string
    id?: string
    name?: string
  }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    partial_json?: string
    stop_reason?: string | null
  }
  usage?: AnthropicUsage
  error?: { message?: string }
}

const STOP_REASONS = new Map<string, StopReason>([
  ['end_turn', 'end'],
  ['max_tokens', 'max_tokens'],
  ['model_context_window_exceeded', 'max_tokens'],
  ['tool_use', 'tool_use'],
  ['stop_sequence', 'stop_sequence'],
  ['refusal', 'refused'],
  ['pause_turn', 'paused'],
])

function create(): (event: SSEEvent) => LlmEvent[] {
  // Blocks started as tool calls, so their argument deltas can be told from unknown Blocks.
  const toolBlocks = new Set<number>()
  // `message_delta` may repeat only some counts, so each one keeps its latest value.
  let counts: AnthropicUsage = {}
  let rawStopReason: string | undefined
  let responseId: string | undefined

  const usage = (raw: AnthropicUsage | undefined): LlmEvent[] => {
    if (!raw) return []
    // A count missing from this event (or `null`) keeps its earlier value.
    const latest = Object.entries(raw).filter(([, value]) => value != null)
    counts = { ...counts, ...Object.fromEntries(latest) }
    return [{ type: 'usage', ...fromAnthropic(counts) }]
  }

  return (sse) => {
    const raw = parseObject<RawEvent>(sse.data)
    const other: LlmEvent[] = [{ type: 'other', raw: sse }]
    if (!raw) return other
    const index = raw.index ?? 0
    switch (raw.type) {
      case 'message_start':
        responseId = raw.message?.id
        return usage(raw.message?.usage)
      case 'content_block_start': {
        const block = raw.content_block
        switch (block?.type) {
          case 'text':
            return block.text ? [{ type: 'text', index, text: block.text }] : []
          case 'thinking': {
            const events: LlmEvent[] = []
            if (block.thinking) events.push({ type: 'reasoning', index, text: block.thinking })
            if (block.signature)
              events.push({ type: 'reasoning_signature', index, signature: block.signature })
            return events
          }
          case 'redacted_thinking':
            return [{ type: 'reasoning', index, text: '', redacted: block.data ?? '' }]
          case 'tool_use':
            toolBlocks.add(index)
            return [{ type: 'tool_call_start', index, id: block.id ?? '', name: block.name ?? '' }]
          default:
            return other
        }
      }
      case 'content_block_delta': {
        const delta = raw.delta
        switch (delta?.type) {
          case 'text_delta':
            return delta.text ? [{ type: 'text', index, text: delta.text }] : []
          case 'thinking_delta':
            return delta.thinking ? [{ type: 'reasoning', index, text: delta.thinking }] : []
          case 'signature_delta':
            return delta.signature
              ? [{ type: 'reasoning_signature', index, signature: delta.signature }]
              : []
          case 'input_json_delta':
            // Server tools stream arguments too, but their Blocks surface as `other`.
            if (!toolBlocks.has(index)) return other
            return delta.partial_json
              ? [{ type: 'tool_call_delta', index, argsDelta: delta.partial_json }]
              : []
          default:
            return other
        }
      }
      case 'message_delta':
        rawStopReason = raw.delta?.stop_reason ?? rawStopReason
        return usage(raw.usage)
      case 'message_stop':
        return done(mapStop(rawStopReason, STOP_REASONS), rawStopReason, responseId)
      case 'error':
        return [{ type: 'error', message: raw.error?.message ?? 'Provider error', raw }]
      case 'ping':
      case 'content_block_stop':
        return []
      default:
        return other
    }
  }
}

/** Adapter for the Anthropic Messages API stream. */
export const anthropic: ProviderAdapter = { name: 'anthropic', create }
