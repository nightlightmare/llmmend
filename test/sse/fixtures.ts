import { expect } from 'vitest'
import { fixtureDir } from '../fixtures'
import { type LlmEvent, type StreamLlmOptions, streamLlm } from '../../src/sse/index'

const encoder = new TextEncoder()

/** The recorded and synthetic streams of one fixture directory, by case name. */
export function sseFixtures(dir: string): { name: string; bytes: Uint8Array }[] {
  return [...fixtureDir(`sse/${dir}`)]
    .filter(([f]) => f.endsWith('.sse'))
    .map(([f, text]) => ({ name: f.slice(0, -'.sse'.length), bytes: encoder.encode(text) }))
}

export function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

export async function collectEvents(
  source: Parameters<typeof streamLlm>[0],
  options: StreamLlmOptions,
): Promise<LlmEvent[]> {
  const events: LlmEvent[] = []
  for await (const event of streamLlm(source, options)) events.push(event)
  return events
}

const USAGE_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
] as const

/** The guarantees every stream must keep, whatever the Provider. */
export function expectInvariants(events: LlmEvent[]): void {
  const done = events.filter((e) => e.type === 'done')
  expect(done).toHaveLength(1)
  expect(events.at(-1)?.type).toBe('done')

  const started = new Set<number>()
  const last: Partial<Record<(typeof USAGE_KEYS)[number], number>> = {}
  for (const event of events) {
    if (event.type === 'tool_call_start') {
      expect(started.has(event.index)).toBe(false)
      started.add(event.index)
    }
    if (event.type === 'tool_call_delta') expect(started.has(event.index)).toBe(true)
    if (event.type === 'usage') {
      // Cumulative: a count once reported never disappears or shrinks.
      for (const key of USAGE_KEYS) {
        const previous = last[key]
        if (previous !== undefined) expect(event[key]).toBeGreaterThanOrEqual(previous)
        const value = event[key]
        if (value !== undefined) last[key] = value
      }
    }
  }
}
