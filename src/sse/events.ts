import type { SSEEvent } from './parse'

/**
 * Why the model stopped. `refused` covers Anthropic `refusal` and OpenAI `content_filter`; `paused`
 * is Anthropic `pause_turn`. Closed union: adding a member is a minor release (ADR 0002).
 */
export type StopReason =
  | 'end'
  | 'max_tokens'
  | 'tool_use'
  | 'stop_sequence'
  | 'refused'
  | 'paused'
  | 'error'
  | 'unknown'

/** Token counts. A cumulative snapshot: the latest one wins, values are never summed. */
export interface LlmUsage {
  /** All input tokens, cached ones included. */
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * One provider-neutral unit of a streamed answer. `index` is always the Block's position in the
 * answer (ADR 0001). Closed union: adding a member is a minor release (ADR 0002).
 */
export type LlmEvent =
  | { type: 'text'; index: number; text: string }
  /** `redacted` carries the opaque data of an Anthropic `redacted_thinking` Block. */
  | { type: 'reasoning'; index: number; text: string; redacted?: string }
  | { type: 'reasoning_signature'; index: number; signature: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; argsDelta: string }
  | ({ type: 'usage' } & LlmUsage)
  /** Arrives exactly once, always last. */
  | { type: 'done'; stopReason: StopReason; rawStopReason?: string }
  | { type: 'error'; message: string; raw: unknown }
  /** An event the adapter does not recognise. */
  | { type: 'other'; raw: SSEEvent }

/** Turns one Provider's events into LLM events. */
export interface ProviderAdapter {
  name: string
  /** Called once per stream; per-stream state lives in the returned function's closure. */
  create(): (event: SSEEvent) => LlmEvent[]
}

/**
 * A built-in Provider name, or a custom adapter. `'openai'` is Chat Completions, the format shared
 * by OpenAI-compatible APIs (OpenRouter, Groq, Ollama, vLLM, LM Studio).
 */
export type Provider = 'anthropic' | 'openai' | ProviderAdapter
