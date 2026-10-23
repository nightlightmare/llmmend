import {
  type ExtractOptions,
  type ExtractResult,
  extractJsonAsync,
  partialCandidate,
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
 * Streams a Reply that contains JSON. While it arrives, yields the Candidate `pick` would choose
 * from the text so far as a Partial value (see `parsePartialJson`), each time it changes; then
 * one item with `done: true` and the full Extraction in `result`. Only text counts; reasoning and
 * tool calls are ignored. Throws only what `streamLlm` throws.
 *
 * Every text event re-parses the whole Reply, so the cost grows with the square of its length:
 * fine for typical structured output, slow for hundreds of kilobytes.
 */
export async function* streamJson<T = unknown>(
  source: StreamSource,
  options: StreamJsonOptions<T>,
): AsyncIterable<StreamJsonItem<T>> {
  const { provider, signal, ...extract } = options
  let text = ''
  let partial: unknown
  let complete = false
  // What was last yielded, serialized, so an unchanged Partial value is not yielded again.
  let shown: string | undefined
  let stopReason: StopReason = 'unknown'
  let rawStopReason: string | undefined
  let usage: LlmUsage | undefined
  let error: string | undefined

  for await (const event of streamLlm(source, signal ? { provider, signal } : { provider })) {
    if (event.type === 'text') {
      text += event.text
      const current = partialCandidate(text, extract)
      if (!current) continue
      const key = `${current.complete} ${JSON.stringify(current.value)}`
      if (key === shown) continue
      shown = key
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
