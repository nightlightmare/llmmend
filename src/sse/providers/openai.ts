import type { LlmEvent, LlmUsage, ProviderAdapter, StopReason } from '../events'
import type { SSEEvent } from '../parse'
import { done, parseObject } from './shared'

interface RawToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** The fields of a Chat Completions stream chunk this adapter reads. */
interface RawChunk {
  choices?: {
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: RawToolCall[] | null
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
    completion_tokens_details?: { reasoning_tokens?: number } | null
  } | null
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

  return (sse) => {
    if (sse.data === '[DONE]') {
      return done(rawStopReason, STOP_REASONS)
    }
    const raw = parseObject<RawChunk>(sse.data)
    if (raw?.error) {
      return [{ type: 'error', message: raw.error.message ?? 'Provider error', raw }]
    }
    if (!raw || (!raw.choices && !raw.usage)) return [{ type: 'other', raw: sse }]

    const events: LlmEvent[] = []
    // Only one answer per stream (ADR 0001): alternative choices are ignored.
    const choice = raw.choices?.[0]
    const delta = choice?.delta
    const reasoning = delta?.reasoning_content || delta?.reasoning
    if (reasoning) {
      reasoningBlock ??= blocks++
      events.push({ type: 'reasoning', index: reasoningBlock, text: reasoning })
    }
    if (delta?.content) {
      textBlock ??= blocks++
      events.push({ type: 'text', index: textBlock, text: delta.content })
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

    const usage = raw.usage
    if (usage) {
      const event: { type: 'usage' } & LlmUsage = { type: 'usage' }
      // `prompt_tokens` already includes cached tokens.
      if (usage.prompt_tokens !== undefined) event.inputTokens = usage.prompt_tokens
      if (usage.completion_tokens !== undefined) event.outputTokens = usage.completion_tokens
      const cached = usage.prompt_tokens_details?.cached_tokens
      if (cached !== undefined) event.cacheReadTokens = cached
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
      if (reasoningTokens !== undefined) event.reasoningTokens = reasoningTokens
      events.push(event)
    }
    return events
  }
}

/** Adapter for OpenAI Chat Completions and the OpenAI-compatible APIs that share its format. */
export const openai: ProviderAdapter = { name: 'openai', create }
