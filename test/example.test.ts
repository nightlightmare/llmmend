import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clamp } from '../src/example/index'

describe('clamp', () => {
  it('keeps the result within bounds', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }),
        fc.double({ noNaN: true }),
        fc.double({ noNaN: true }),
        (v, a, b) => {
          const [min, max] = a <= b ? [a, b] : [b, a]
          const r = clamp(v, min, max)
          expect(r).toBeGreaterThanOrEqual(min)
          expect(r).toBeLessThanOrEqual(max)
        },
      ),
    )
  })

  it('rejects inverted bounds', () => {
    expect(() => clamp(0, 1, 0)).toThrow(RangeError)
  })
})
