// Each Provider's token usage as `LlmUsage`, shared by the stream adapters and `toUsage`.
import type { LlmUsage } from '../sse/events'

export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  output_tokens_details?: { thinking_tokens?: number } | null
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number } | null
  completion_tokens_details?: { reasoning_tokens?: number } | null
}

export interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number } | null
  output_tokens_details?: { reasoning_tokens?: number } | null
}

export interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
}

// Only numbers count: a Provider may send `null` for a count it has nothing for.
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

function usage(
  input: unknown,
  output: unknown,
  read: unknown,
  write: unknown,
  reasoning: unknown,
): LlmUsage {
  const out: LlmUsage = {}
  if (num(input) !== undefined) out.inputTokens = num(input)!
  if (num(output) !== undefined) out.outputTokens = num(output)!
  if (num(read) !== undefined) out.cacheReadTokens = num(read)!
  if (num(write) !== undefined) out.cacheWriteTokens = num(write)!
  if (num(reasoning) !== undefined) out.reasoningTokens = num(reasoning)!
  return out
}

/** Anthropic counts cached tokens apart from `input_tokens`; `inputTokens` includes them. */
export function fromAnthropic(raw: AnthropicUsage): LlmUsage {
  const read = num(raw.cache_read_input_tokens)
  const write = num(raw.cache_creation_input_tokens)
  const input = num(raw.input_tokens)
  return usage(
    input === undefined ? undefined : input + (read ?? 0) + (write ?? 0),
    raw.output_tokens,
    read,
    write,
    raw.output_tokens_details?.thinking_tokens,
  )
}

/** `prompt_tokens` already includes cached tokens, `completion_tokens` reasoning ones. */
export const fromChat = (raw: ChatUsage): LlmUsage =>
  usage(
    raw.prompt_tokens,
    raw.completion_tokens,
    raw.prompt_tokens_details?.cached_tokens,
    undefined,
    raw.completion_tokens_details?.reasoning_tokens,
  )

/** `input_tokens` already includes cached tokens, `output_tokens` reasoning ones. */
export const fromResponses = (raw: ResponsesUsage): LlmUsage =>
  usage(
    raw.input_tokens,
    raw.output_tokens,
    raw.input_tokens_details?.cached_tokens,
    undefined,
    raw.output_tokens_details?.reasoning_tokens,
  )

/** `promptTokenCount` already includes cached tokens; output includes thoughts, as elsewhere. */
export function fromGemini(raw: GeminiUsage): LlmUsage {
  const candidates = num(raw.candidatesTokenCount)
  const thoughts = num(raw.thoughtsTokenCount)
  return usage(
    raw.promptTokenCount,
    candidates === undefined && thoughts === undefined
      ? undefined
      : (candidates ?? 0) + (thoughts ?? 0),
    raw.cachedContentTokenCount,
    undefined,
    thoughts,
  )
}
