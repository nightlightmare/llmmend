import type { LlmEvent, StopReason } from '../events'

/** Parses an event's `data` as a JSON object; anything else gives `undefined`. */
export function parseObject<T extends object>(data: string): T | undefined {
  try {
    const value: unknown = JSON.parse(data)
    return typeof value === 'object' && value !== null ? (value as T) : undefined
  } catch {
    return undefined
  }
}

/** The final event, with the raw stop reason and the response id when there are any. */
export function done(
  stopReason: StopReason,
  rawStopReason: string | undefined,
  responseId: string | undefined,
): LlmEvent[] {
  const event: LlmEvent = { type: 'done', stopReason }
  if (rawStopReason !== undefined) event.rawStopReason = rawStopReason
  if (responseId !== undefined) event.responseId = responseId
  return [event]
}

/** The Stop reason of a Provider's raw stop reason, mapped through `reasons`. */
export const mapStop = (raw: string | undefined, reasons: Map<string, StopReason>): StopReason =>
  (raw !== undefined && reasons.get(raw)) || 'unknown'
