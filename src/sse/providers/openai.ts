import { type ChatUsage, fromChat } from '../../shared/usage'
import type { LlmEvent, ProviderAdapter, StopReason } from '../events'
import type { SSEEvent } from '../parse'
import { done, mapStop, parseObject } from './shared'

interface RawToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** The fields of a Chat Completions stream chunk this adapter reads. */
interface RawChunk {
  id?: string
  choices?: {
    delta?: {
      content?: string | null
      refusal?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: RawToolCall[] | null
    }
    finish_reason?: string | null
  }[]
  usage?: ChatUsage | null
  error?: { message?: string }
}

const STOP_REASONS = new Map<string, StopReason>([
  ['stop', 'end'],
  ['length', 'max_tokens'],
  ['tool_calls', 'tool_use'],
  ['function_call', 'tool_use'],
  ['content_filter', 'refused'],
])

function create(): (event: SSEEvent) => LlmEvent[] {
  // Chat Completions has no Blocks, so they are numbered here in order of first appearance:
  // reasoning, text and each tool call (keyed by its `tool_calls[].index`) get one Block each.
  let blocks = 0
  let reasoningBlock: number | undefined
  let textBlock: number | undefined
  const toolBlocks = new Map<number, number>()
  let rawStopReason: string | undefined
  let refused = false
  let responseId: string | undefined

  return (sse) => {
    if (sse.data === '[DONE]') {
      // A refusal (structured outputs) ends with `stop`; it still is a refusal.
      const stopReason =
        refused && rawStopReason === 'stop' ? 'refused' : mapStop(rawStopReason, STOP_REASONS)
      return done(stopReason, rawStopReason, responseId)
    }
    const raw = parseObject<RawChunk>(sse.data)
    if (raw?.error) {
      return [{ type: 'error', message: raw.error.message ?? 'Provider error', raw }]
    }
    if (!raw || (!raw.choices && !raw.usage)) return [{ type: 'other', raw: sse }]
    responseId ??= raw.id

    const events: LlmEvent[] = []
    // Only one answer per stream (ADR 0001): alternative choices are ignored.
    const choice = raw.choices?.[0]
    const delta = choice?.delta
    const reasoning = delta?.reasoning_content || delta?.reasoning
    if (reasoning) {
      reasoningBlock ??= blocks++
      events.push({ type: 'reasoning', index: reasoningBlock, text: reasoning })
    }
    const text = delta?.content || delta?.refusal
    if (text) {
      if (delta?.refusal) refused = true
      textBlock ??= blocks++
      events.push({ type: 'text', index: textBlock, text })
    }
    for (const [i, call] of (delta?.tool_calls ?? []).entries()) {
      const key = call.index ?? i
      let index = toolBlocks.get(key)
      if (index === undefined) {
        index = blocks++
        toolBlocks.set(key, index)
        const fn = call.function
        events.push({ type: 'tool_call_start', index, id: call.id ?? '', name: fn?.name ?? '' })
      }
      const args = call.function?.arguments
      if (args) events.push({ type: 'tool_call_delta', index, argsDelta: args })
    }
    rawStopReason = choice?.finish_reason ?? rawStopReason

    if (raw.usage) events.push({ type: 'usage', ...fromChat(raw.usage) })
    return events
  }
}

/** Adapter for OpenAI Chat Completions and the OpenAI-compatible APIs that share its format. */
export const openai: ProviderAdapter = { name: 'openai', create }
