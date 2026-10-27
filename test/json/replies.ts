import * as fc from 'fast-check'
import type { ExtractOptions } from '../../src/json/extract'
import { locate } from '../../src/json/locate'
import type { PartialCandidate } from '../../src/json/partial-scan'

export type PickOptions = Pick<ExtractOptions<unknown>, 'pick' | 'expect'>

/**
 * What `streamJson` showed as `partial` before #73: the whole text located again after every
 * piece. The incremental path must match it exactly.
 */
export function partialByLocate(
  text: string,
  { pick = 'last', expect: kind }: PickOptions,
): PartialCandidate | undefined {
  const wanted = locate(text, 'partial').candidates.filter(
    (c) => !kind || kind === 'any' || Array.isArray(c.value) === (kind === 'array'),
  )
  if (!wanted.length) return undefined
  let c = pick === 'first' ? wanted[0]! : wanted.at(-1)!
  if (pick === 'largest') for (const w of wanted) if (w.end - w.start > c.end - c.start) c = w
  const complete = !c.issues.some((i) => i.code === 'truncated_closed')
  return { start: c.start, end: c.end, value: c.value, complete }
}

/** Pieces that make JSON, almost-JSON and prose around it, with the usual ways to break it. */
const fragment = fc.oneof(
  { weight: 3, arbitrary: fc.json() },
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      '{',
      '}',
      '[',
      ']',
      '"',
      "'",
      ':',
      ',',
      ' ',
      '\n',
      'a',
      'key',
      '"k"',
      '1',
      '-',
      '.5',
      'e3',
      'tru',
      'true',
      'null',
      'None',
      'NaN',
      '-Infinity',
      '\\',
      '\\n',
      '\\u12',
      '\\u0041',
      '//',
      '/*',
      '*/',
      '\u0001',
      '```json\n',
      '```',
      'Sure: ',
      '{"a": ',
      '[1, 2',
      '"x"',
      '{x}',
      '[y]',
    ),
  },
)

/** A Reply made of such pieces. */
export const reply: fc.Arbitrary<string> = fc
  .array(fragment, { maxLength: 30 })
  .map((parts) => parts.join(''))

/** The text cut at random points into non-empty pieces. */
export const cutInto = (text: string): fc.Arbitrary<string[]> =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: Math.max(1, text.length - 1) }), { maxLength: 40 })
    .map((cuts) => {
      const at = [0, ...cuts.filter((c) => c < text.length).sort((a, b) => a - b), text.length]
      return at
        .slice(1)
        .map((end, k) => text.slice(at[k], end))
        .filter((p) => p !== '')
    })

/** A Reply as it arrives: cut into random pieces. */
export const replyPieces: fc.Arbitrary<string[]> = reply.chain(cutInto)

export const pickOptions: fc.Arbitrary<PickOptions> = fc.record(
  {
    pick: fc.constantFrom('first' as const, 'last' as const, 'largest' as const),
    expect: fc.constantFrom('object' as const, 'array' as const, 'any' as const),
  },
  { requiredKeys: [] },
)
