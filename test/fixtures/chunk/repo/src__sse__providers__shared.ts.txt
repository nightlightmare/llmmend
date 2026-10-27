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

/** The final event for a Provider's stop reason string, mapped through `reasons`. */
export function done(raw: string | undefined, reasons: Map<string, StopReason>): LlmEvent[] {
  return [
    raw === undefined
      ? { type: 'done', stopReason: 'unknown' }
      : { type: 'done', stopReason: reasons.get(raw) ?? 'unknown', rawStopReason: raw },
  ]
}
