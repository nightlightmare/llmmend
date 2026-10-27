// Time for long Replies, arriving four characters per text event. Kept out of coverage runs
// (see vitest.config.ts), where instrumentation makes timings meaningless.
import { describe, expect, it } from 'vitest'
import { streamJson } from '../../src/sse/index'
import { byteStream } from './fixtures'

const encoder = new TextEncoder()

/** An Anthropic stream that writes `text` four characters at a time. */
function stream(text: string): ReadableStream<Uint8Array> {
  const events: string[] = []
  for (let i = 0; i < text.length; i += 4) {
    const delta = { type: 'text_delta', text: text.slice(i, i + 4) }
    events.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta })}\n\n`)
  }
  events.push('data: {"type":"message_stop"}\n\n')
  return byteStream([encoder.encode(events.join(''))])
}

async function time(text: string): Promise<number> {
  const source = stream(text)
  const start = performance.now()
  let last: unknown
  for await (const item of streamJson(source, { provider: 'anthropic' })) last = item
  expect(last).toMatchObject({ done: true, result: { ok: true } })
  return performance.now() - start
}

/** Best of a few runs after a warm-up: the ratio is for the code, not for JIT tiers. */
async function bestOf(text: string): Promise<number> {
  await time(text)
  let best = Infinity
  for (let i = 0; i < 3; i++) best = Math.min(best, await time(text))
  return best
}

/** How much longer four times the text takes: about 4 when linear, 16 when quadratic (CI runners
 * are noisy, so the bound for linear is 8). */
async function growth(make: (size: number) => string): Promise<number> {
  return (await bestOf(make(400_000))) / (await bestOf(make(100_000)))
}

const record = (k: number, text: string): string =>
  JSON.stringify({ id: k, title: `Item ${k}`, tags: ['a', 'b'], body: text })

describe('streamJson', () => {
  it.each([
    ['one long string', (size: number) => JSON.stringify({ content: 'word '.repeat(size / 5) })],
    [
      'a few hundred long records',
      (size: number) =>
        `[${Array.from({ length: size / 1000 }, (_, k) => record(k, 'word '.repeat(180))).join(', ')}]`,
    ],
  ])(
    'streams %s in linear time',
    async (_, make) => {
      expect(await growth(make)).toBeLessThan(8)
    },
    120_000,
  )

  // Each changed Partial value is a new array, so a wide open array is copied (shallowly) per
  // change: far below re-parsing the Reply, but more than linear.
  it('streams ten thousand short records far below quadratic time', async () => {
    const make = (size: number) =>
      `[${Array.from({ length: size / 40 }, (_, k) => record(k, '')).join(', ')}]`
    expect(await growth(make)).toBeLessThan(10)
  }, 120_000)
})
