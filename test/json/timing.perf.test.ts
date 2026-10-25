// Time budgets: 100 kB of pathological input within 50 ms. Kept out of coverage runs (see
// vitest.config.ts), where instrumentation makes timings meaningless; `pnpm test` runs them.
import { describe, expect, it } from 'vitest'
import { extractAllTags, extractJson, extractTag } from '../../src/json/index'
import { parseJson, type Repair } from '../../src/json/parser'

/** Best of several runs after a warm-up: the budget is for the code, not for JIT tiers. */
function bestOf(run: () => void): number {
  for (let i = 0; i < 3; i++) run()
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

const size = 100_000

describe('parseJson', () => {
  const inputs: Record<string, string> = {
    'deep nesting': '['.repeat(size),
    'unterminated string': '"' + 'a'.repeat(size),
    'many escapes': '"' + '\\n'.repeat(size / 2) + '"',
    'long number': '1'.repeat(size),
    'repeated keys': '{' + '"k":1,'.repeat(size / 6) + '"k":1}',
    'wide array': '[' + '0,'.repeat(size / 2 - 1) + '0]',
    'single quotes and comments': "{'k': 'v', // c\n".repeat(size / 16),
    'random bytes': Array.from({ length: size }, (_, i) =>
      String.fromCharCode((i * 2654435761) % 256),
    ).join(''),
  }
  const repairs: Repair[] = ['none', 'syntax', 'full']

  it.each(
    Object.entries(inputs).flatMap(([name, text]) =>
      repairs.map((repair): [string, Repair, string] => [name, repair, text]),
    ),
  )('parses 100 kB of %s within 50 ms (repair: %s)', (_, repair, text) => {
    expect(bestOf(() => parseJson(text, { repair }))).toBeLessThan(50)
  })
})

describe('extractJson', () => {
  const replies: Record<string, string> = {
    'markdown links': '[link](https://example.com) '.repeat(size / 28) + '{"found": true}',
    'unmatched brackets': '[[[[{{{{'.repeat(size / 8),
    'brackets in prose': 'see [1], {x} and [y]. '.repeat(size / 22),
    'one cut-off string': '{"a": "' + 'x'.repeat(size),
    'nested starts': '[{"a": ['.repeat(size / 8),
  }

  it.each(Object.entries(replies))('handles 100 kB of %s within 50 ms', (_, text) => {
    expect(bestOf(() => extractJson(text))).toBeLessThan(50)
  })
})

describe('extractTag and extractAllTags', () => {
  const replies: Record<string, string> = {
    'an unclosed tag with many attributes': '<answer' + ' a=1'.repeat(size / 4),
    'many opening tags': '<answer>'.repeat(size / 8),
    'many closed tags': '<a>x</a>'.repeat(size / 8),
    'many code fences': '```\n<a>x</a>\n```\n'.repeat(size / 18),
    'angle brackets in prose': 'a < b and c<d '.repeat(size / 14),
  }

  it.each(Object.entries(replies))('handles 100 kB of %s within 50 ms', (_, text) => {
    expect(bestOf(() => extractTag(text, 'answer'))).toBeLessThan(50)
    expect(bestOf(() => extractAllTags(text))).toBeLessThan(50)
  })
})
