import {
  type ExtractOptions,
  type ExtractResult,
  extractJsonAsync,
  followPartial,
} from '../json/extract'
import type { LlmUsage, StopReason } from './events'
import { type StreamLlmOptions, type StreamSource, streamLlm } from './stream'

export type StreamJsonOptions<T> = StreamLlmOptions & ExtractOptions<T>

/** What `streamJson` yields: Partial values while the Reply arrives, then one final item. */
export type StreamJsonItem<T> =
  | { done: false; partial: unknown; complete: boolean }
  | {
      done: true
      /** The last Partial value. */
      partial: unknown
      complete: boolean
      /** `extractJsonAsync` over the whole Reply, with the same options. */
      result: ExtractResult<T>
      /** The whole Reply. */
      text: string
      stopReason: StopReason
      rawStopReason?: string
      usage?: LlmUsage
      /** The message of a Provider error that ended the stream. */
      error?: string
    }

/**
 * Whether two parsed JSON values would serialize the same. An unchanged Partial value is the
 * same object, and a changed one shares every part that ended, so this is usually quick.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    // From the end: an array grows there.
    for (let k = a.length - 1; k >= 0; k--) if (!sameJson(a[k], b[k])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const keys = Object.keys(a)
  const other = Object.keys(b)
  if (keys.length !== other.length) return false
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!
    if (key !== other[k]) return false
    if (!sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      return false
  }
  return true
}

/**
 * Streams a Reply that contains JSON. While it arrives, yields the Candidate `pick` would choose
 * from the text so far as a Partial value (see `parsePartialJson`), each time it changes; then
 * one item with `done: true` and the full Extraction in `result`. Only text counts; reasoning and
 * tool calls are ignored. Throws only what `streamLlm` throws.
 *
 * Parsing is incremental: a text event costs about its own length, plus a shallow copy of the
 * open arrays and objects when the value changes. Successive Partial values share the parts
 * that ended: treat them as read-only.
 */
export async function* streamJson<T = unknown>(
  source: StreamSource,
  options: StreamJsonOptions<T> = {},
): AsyncIterable<StreamJsonItem<T>> {
  const { provider, signal, ...extract } = options
  const follow = followPartial(extract)
  let text = ''
  let partial: unknown
  let complete = false
  let shown = false
  let stopReason: StopReason = 'unknown'
  let rawStopReason: string | undefined
  let usage: LlmUsage | undefined
  let error: string | undefined

  const llmOptions: StreamLlmOptions = {}
  if (provider) llmOptions.provider = provider
  if (signal) llmOptions.signal = signal
  for await (const event of streamLlm(source, llmOptions)) {
    if (event.type === 'text') {
      text += event.text
      const current = follow(event.text)
      if (!current) continue
      if (shown && current.complete === complete && sameJson(current.value, partial)) continue
      shown = true
      ;({ value: partial, complete } = current)
      yield { done: false, partial, complete }
    } else if (event.type === 'usage') {
      const { type: _, ...counts } = event
      usage = counts
    } else if (event.type === 'error') error = event.message
    else if (event.type === 'done') ({ stopReason, rawStopReason } = event)
  }

  const result = await extractJsonAsync(text, extract)
  const last: StreamJsonItem<T> = { done: true, partial, complete, result, text, stopReason }
  if (rawStopReason !== undefined) last.rawStopReason = rawStopReason
  if (usage) last.usage = usage
  if (error !== undefined) last.error = error
  yield last
}
