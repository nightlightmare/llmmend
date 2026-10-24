import { describe, expect, it } from 'vitest'
import { decodeState, encodeState, MAX_HASH } from '../../site/src/share'

describe('playground share links', () => {
  it('restore the input and options, Unicode included', async () => {
    const state = { input: 'Ответ: {"emoji": "🌊", "中文": [1, 2,]}', options: { pick: 'first' } }
    const hash = await encodeState(state)
    expect(hash).toMatch(/^s=[\w-]+$/)
    expect(await decodeState(`#${hash}`)).toEqual(state)
  })

  it('refuse state that would make the link too long', async () => {
    // Pseudo-random text (the high bits of a linear congruential generator) does not compress.
    let seed = 1
    const input = Array.from({ length: MAX_HASH }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return String.fromCharCode(33 + ((seed >>> 16) % 90))
    }).join('')
    expect(await encodeState({ input, options: {} })).toBeUndefined()
  })

  it('ignore hashes that are not share links or are damaged', async () => {
    expect(await decodeState('')).toBeUndefined()
    expect(await decodeState('#section')).toBeUndefined()
    expect(await decodeState('#s=not-deflate')).toBeUndefined()
    const hash = await encodeState({ input: 'x', options: {} })
    expect(await decodeState(`#${hash!.slice(0, -4)}`)).toBeUndefined()
  })
})
