import { parseJson } from '../json/parser'
import type { StandardSchemaV1 } from '../json/schema'
import type { LlmUsage, StopReason } from './events'
import { type CollectedText, type CollectTextOptions, streamLlm, type StreamSource } from './stream'
import {
  finishToolCalls,
  type PendingToolCall,
  type ToolCall,
  type ToolSchemas,
} from './tool-calls'

/** Every property optional, all the way down: what a value looks like while it is being written. */
export type DeepPartial<T> = T extends readonly (infer Item)[]
  ? DeepPartial<Item>[]
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T

type Input<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferInput<S> : never

interface PartialBase {
  done: false
  type: 'tool_call'
  /** The call's Block. */
  index: number
  id: string
  custom?: true
}

/**
 * A tool call while its arguments stream. `partial` is the arguments so far, read like
 * `parsePartialJson` (a custom tool's: its text so far); with `tools`, typed as a deep partial of
 * the tool schema's input, narrowed by `name`.
 */
export type PartialToolCall<Tools extends ToolSchemas = Record<never, never>> = [
  keyof Tools,
] extends [never]
  ? PartialBase & { name: string; partial: unknown }
  : {
      [Name in keyof Tools & string]: PartialBase & {
        name: Name
        partial: DeepPartial<Input<Tools[Name]>>
      }
    }[keyof Tools & string]

/** What `streamToolCalls` yields: text and Partial tool calls as they arrive, then the result. */
export type StreamToolCallsItem<Tools extends ToolSchemas = Record<never, never>> =
  | { done: false; type: 'text'; text: string }
  | PartialToolCall<Tools>
  | ({ done: true } & CollectedText<Tools>)

/**
 * Streams an answer with tool calls, for UIs that render a call while the model writes it. Yields
 * each piece of text, and a tool call's Partial value each time it changes; then one item with
 * `done: true` and what `collectText` would return. Each delta re-parses that call's arguments.
 */
export async function* streamToolCalls<Tools extends ToolSchemas = Record<never, never>>(
  source: StreamSource,
  options: CollectTextOptions<Tools> = {},
): AsyncIterable<StreamToolCallsItem<Tools>> {
  const { tools, coerce, ...streamOptions } = options
  let text = ''
  let stopReason: StopReason = 'unknown'
  let usage: LlmUsage | undefined
  const calls = new Map<number, PendingToolCall>()
  // What was last yielded per call, serialized, so an unchanged Partial value is not repeated.
  const shown = new Map<number, string>()

  for await (const event of streamLlm(source, streamOptions)) {
    if (event.type === 'text') {
      text += event.text
      yield { done: false, type: 'text', text: event.text }
    } else if (event.type === 'tool_call_start')
      calls.set(event.index, { ...event, argsText: '', custom: event.custom === true })
    else if (event.type === 'tool_call_delta') {
      const call = calls.get(event.index)
      if (!call) continue
      call.argsText += event.argsDelta
      // A call to an unlisted tool ends as unknown_tool: nothing to render meanwhile.
      if (tools && !Object.hasOwn(tools, call.name)) continue
      let partial: unknown = call.argsText
      if (!call.custom) {
        const parsed = parseJson(call.argsText, { repair: 'partial' })
        if (!parsed.ok) continue
        partial = parsed.value
      }
      const key = JSON.stringify(partial)
      if (shown.get(call.index) === key) continue
      shown.set(call.index, key)
      const { index, id, name } = call
      yield {
        done: false,
        type: 'tool_call',
        index,
        id,
        name,
        ...(call.custom ? { custom: true as const } : {}),
        partial,
      } as PartialToolCall<Tools>
    } else if (event.type === 'usage') {
      const { type: _, ...counts } = event
      usage = counts
    } else if (event.type === 'done') stopReason = event.stopReason
  }

  const toolCalls = (await finishToolCalls(calls.values(), tools, coerce)) as ToolCall<Tools>[]
  yield { done: true, text, stopReason, ...(usage ? { usage } : {}), toolCalls }
}
