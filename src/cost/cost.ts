// The cost of a model call from its token usage. No price table ships: prices go stale within
// weeks, so the caller supplies them, per million tokens as Providers publish them.
import {
  type AnthropicUsage,
  type ChatUsage,
  fromAnthropic,
  fromChat,
  fromGemini,
  fromResponses,
  type GeminiUsage,
  type ResponsesUsage,
} from '../shared/usage'
import type { LlmUsage } from '../sse/events'

/** Prices per million tokens. Without `cacheRead` or `cacheWrite`, those tokens cost `input`. */
export interface PriceSet {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Prices for requests with more than `above` input tokens. */
export interface PriceTier extends Partial<PriceSet> {
  above: number
}

export interface Prices extends PriceSet {
  /**
   * Higher prices for long requests: the tier with the highest `above` below the input tokens
   * applies to the whole call. A price a tier leaves out comes from the base prices.
   */
  tiers?: readonly PriceTier[]
}

/** A call's cost by part, in the unit of the prices; `total` is their sum, unrounded. */
export interface Cost {
  total: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** Counts the usage lacked, costed as 0: the total is too low. Absent when none is missing. */
  missing?: ('input' | 'output')[]
}

function pricesFor(prices: Prices, inputTokens: number | undefined): PriceSet {
  let tier: PriceTier | undefined
  if (inputTokens !== undefined)
    for (const t of prices.tiers ?? [])
      if (t.above < inputTokens && (!tier || t.above > tier.above)) tier = t
  return { ...prices, ...tier }
}

/**
 * Estimates what a call cost from its usage (`inputTokens` with cached tokens included, as every
 * stream and `toUsage` report it). Never throws: a missing input or output count is listed in
 * `missing`.
 */
export function estimateCost(usage: LlmUsage, prices: Prices): Cost {
  const {
    input,
    output,
    cacheRead = input,
    cacheWrite = input,
  } = pricesFor(prices, usage.inputTokens)
  const read = usage.cacheReadTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  const cost = {
    input: (Math.max(0, (usage.inputTokens ?? 0) - read - write) * input) / 1e6,
    cacheRead: (read * cacheRead) / 1e6,
    cacheWrite: (write * cacheWrite) / 1e6,
    output: ((usage.outputTokens ?? 0) * output) / 1e6,
  }
  const result: Cost = {
    total: cost.input + cost.cacheRead + cost.cacheWrite + cost.output,
    ...cost,
  }
  const missing = (['input', 'output'] as const).filter((k) => usage[`${k}Tokens`] === undefined)
  if (missing.length) result.missing = missing
  return result
}

const has = (raw: object, ...keys: string[]) => keys.some((key) => key in raw)

/**
 * Turns a Provider's raw `usage` (Anthropic, OpenAI Chat Completions or Responses, Gemini's
 * `usageMetadata`) into `LlmUsage`, by its fields. An unknown shape gives `{}`; never throws.
 */
export function toUsage(raw: unknown): LlmUsage {
  if (typeof raw !== 'object' || raw === null) return {}
  if (has(raw, 'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount'))
    return fromGemini(raw as GeminiUsage)
  if (has(raw, 'prompt_tokens', 'completion_tokens')) return fromChat(raw as ChatUsage)
  // Anthropic and Responses share `input_tokens` and `output_tokens`; only Anthropic leaves
  // cached tokens out of `input_tokens`, and it is the one with these fields.
  const details = (raw as AnthropicUsage).output_tokens_details
  if (
    has(raw, 'cache_read_input_tokens', 'cache_creation_input_tokens') ||
    (typeof details === 'object' && details !== null && 'thinking_tokens' in details)
  )
    return fromAnthropic(raw as AnthropicUsage)
  if (has(raw, 'input_tokens', 'output_tokens')) return fromResponses(raw as ResponsesUsage)
  return {}
}
