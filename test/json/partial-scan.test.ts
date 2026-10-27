import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { followPartial } from '../../src/json/extract'
import { type Checkpoint, parseValueAt } from '../../src/json/parser'
import { PartialScan } from '../../src/json/partial-scan'
import { cutInto, partialByLocate, type PickOptions, pickOptions, replyPieces } from './replies'

/** Follows the pieces, checking each step against locating the whole text again. */
function expectFollowsLocate(parts: string[], opts: PickOptions = {}): void {
  const follow = followPartial(opts)
  let text = ''
  for (const part of parts) {
    text += part
    expect(follow(part)).toEqual(partialByLocate(text, opts))
  }
}

describe('followPartial', () => {
  it('chooses what locating the whole text again would, after every piece', () => {
    fc.assert(fc.property(replyPieces, pickOptions, expectFollowsLocate), { numRuns: 3000 })
  })

  it.each([
    ['an open Candidate that fails, with one inside it', ['[{"a": 1}', ' x', ']']],
    ['a start that only the end of the text let through', ['see [', ' ', 'x] and [', '1]']],
    ['a run of brackets cut at the end', ['[[[ ', ' ', '{', '"a', '": 1}]]]']],
    ['an escape cut in the middle', ['{"a": "caf\\', 'u00', 'e9 \\', 'n"}']],
    ['a key cut in the middle', ['{"ke', 'y": [1', ', 2], "b', '": "x"}']],
    ['a value that ends where a piece ends', ['{"a": "x"', ', "b": [1]', ', "c": {}', '}']],
    ['a duplicate key', ['{"a": "x", "a": "', 'y', '"}']],
    ['comments and trailing commas', ['{// c\n "a": [1,', ' /* x */', '],', '}']],
    ['a cut-off -Infinity', ['[-I', 'nf', 'inity, 1]']],
    ['nesting deeper than the parser goes', ['['.repeat(300), '['.repeat(300), ']']],
  ])('handles %s', (_, parts) => {
    expectFollowsLocate(parts)
    expectFollowsLocate(parts, { pick: 'first' })
    expectFollowsLocate(parts, { pick: 'largest' })
  })

  // No test text comes near the failed-scan budget, so these pin how it is spent directly.
  it('charges a failed start to the budget as locate does', () => {
    const scan = new PartialScan()
    scan.push('x [1, ')
    scan.push('y')
    expect(scan['spent']).toBe('[1, y'.length)
  })

  it('checks again a start that the end of the text let through, without charging it', () => {
    const scan = new PartialScan()
    scan.push('x [')
    expect(scan.open).toMatchObject({ start: 2 })
    scan.push(' y')
    expect(scan.open).toBeUndefined()
    expect(scan['spent']).toBe(0)
  })
})

describe('parseValueAt with resume', () => {
  it('gives what a parse from the start gives, piece after piece', () => {
    fc.assert(
      fc.property(
        fc.jsonValue().chain((v) => cutInto(JSON.stringify(v, null, 1))),
        (parts) => {
          let text = ''
          let resume: Checkpoint[] | undefined
          for (const part of parts) {
            text += part
            const fresh = parseValueAt(text, 0, { repair: 'partial' })
            const resumed = parseValueAt(text, 0, { repair: 'partial', ...(resume && { resume }) })
            expect(resumed.ok && resumed.value).toEqual(fresh.ok && fresh.value)
            if (!resumed.ok || !resumed.checkpoints) break
            resume = resumed.checkpoints
          }
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('does not change values it returned before', () => {
    const first = parseValueAt('{"a": [1, {"b": "x', 0, { repair: 'partial' })
    if (!first.ok) throw new Error('expected a value')
    const before = structuredClone(first.value)
    parseValueAt('{"a": [1, {"b": "xyz"}, 3], "c": 4}', 0, {
      repair: 'partial',
      resume: first.checkpoints!,
    })
    expect(first.value).toEqual(before)
  })
})
