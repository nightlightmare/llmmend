import type { LlmEvent, LlmUsage, ProviderAdapter, StopReason } from '../events'
import type { SSEEvent } from '../parse'
import { parseObject } from './shared'

interface RawItem {
  type?: string
  call_id?: string
  name?: string
  encrypted_content?: string
}

interface RawResponse {
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number } | null
    output_tokens_details?: { reasoning_tokens?: number } | null
  } | null
  incomplete_details?: { reason?: string } | null
  error?: { message?: string } | null
}

/** The fields of a Responses API stream event this adapter reads. */
interface RawEvent {
  type?: string
  output_index?: number
  summary_index?: number
  delta?: string
  item?: RawItem
  response?: RawResponse
  message?: string
}

/** Events that carry nothing an LLM event needs: lifecycle, and `*.done` repeats of deltas. */
const IGNORED = new Set([
  'response.created',
  'response.in_progress',
  'response.queued',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.done',
  'response.refusal.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.done',
  'response.function_call_arguments.done',
  'response.custom_tool_call_input.done',
])

function usage(raw: RawResponse['usage']): LlmEvent[] {
  if (!raw) return []
  const event: { type: 'usage' } & LlmUsage = { type: 'usage' }
  // `input_tokens` already includes cached tokens, `output_tokens` reasoning ones.
  if (raw.input_tokens !== undefined) event.inputTokens = raw.input_tokens
  if (raw.output_tokens !== undefined) event.outputTokens = raw.output_tokens
  const cached = raw.input_tokens_details?.cached_tokens
  if (cached !== undefined) event.cacheReadTokens = cached
  const reasoning = raw.output_tokens_details?.reasoning_tokens
  if (reasoning !== undefined) event.reasoningTokens = reasoning
  return [event]
}

function create(): (event: SSEEvent) => LlmEvent[] {
  // Every output item is one Block and keeps its `output_index`, so only the tool call items and
  // the last summary part per reasoning item need remembering.
  const tools = new Set<number>()
  const summaryParts = new Map<number, number>()
  let refused = false

  return (sse) => {
    const raw = parseObject<RawEvent>(sse.data)
    const other: LlmEvent[] = [{ type: 'other', raw: sse }]
    if (!raw) return other
    const type = raw.type ?? sse.event
    if (IGNORED.has(type)) return []
    const index = raw.output_index ?? 0
    const delta = raw.delta ?? ''
    switch (type) {
      case 'response.output_item.added': {
        const item = raw.item
        if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
          tools.add(index)
          return [{ type: 'tool_call_start', index, id: item.call_id ?? '', name: item.name ?? '' }]
        }
        return item?.type === 'message' || item?.type === 'reasoning' ? [] : other
      }
      case 'response.output_item.done': {
        const item = raw.item
        if (item?.type === 'reasoning' && item.encrypted_content)
          return [{ type: 'reasoning_signature', index, signature: item.encrypted_content }]
        return item?.type === 'message' || item?.type === 'reasoning' || tools.has(index)
          ? []
          : other
      }
      case 'response.refusal.delta':
        refused = true
        return delta ? [{ type: 'text', index, text: delta }] : []
      case 'response.output_text.delta':
        return delta ? [{ type: 'text', index, text: delta }] : []
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        if (!delta) return []
        // Summary parts of one reasoning item form one Block, a blank line apart.
        const part = raw.summary_index
        const last = summaryParts.get(index)
        if (part !== undefined) summaryParts.set(index, part)
        const text =
          last !== undefined && part !== undefined && part !== last ? `\n\n${delta}` : delta
        return [{ type: 'reasoning', index, text }]
      }
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta':
        if (!tools.has(index)) return other
        return delta ? [{ type: 'tool_call_delta', index, argsDelta: delta }] : []
      case 'response.completed': {
        const stopReason: StopReason = tools.size ? 'tool_use' : refused ? 'refused' : 'end'
        return [
          ...usage(raw.response?.usage),
          { type: 'done', stopReason, rawStopReason: 'completed' },
        ]
      }
      case 'response.incomplete': {
        const reason = raw.response?.incomplete_details?.reason ?? 'incomplete'
        const stopReason: StopReason =
          reason === 'max_output_tokens'
            ? 'max_tokens'
            : reason === 'content_filter'
              ? 'refused'
              : 'unknown'
        return [...usage(raw.response?.usage), { type: 'done', stopReason, rawStopReason: reason }]
      }
      case 'response.failed':
        return [{ type: 'error', message: raw.response?.error?.message ?? 'Provider error', raw }]
      case 'error':
        return [{ type: 'error', message: raw.message ?? 'Provider error', raw }]
      default:
        // Built-in tools (web search, file search, code interpreter, …) and anything new.
        return other
    }
  }
}

/** Adapter for the OpenAI Responses API stream. */
export const openaiResponses: ProviderAdapter = { name: 'openai-responses', create }
