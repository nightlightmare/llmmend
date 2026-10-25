import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractCodeBlocks } from '../../src/json/index'

describe('extractCodeBlocks', () => {
  it('returns every fenced block in order, with language, info, code and position', () => {
    const reply = [
      'Install it:',
      '```bash',
      'npm i llmmend',
      '```',
      'Then:',
      '```ts title="app.ts"',
      "import { extractJson } from 'llmmend'",
      '',
      'extractJson(reply)',
      '```',
    ].join('\n')
    const blocks = extractCodeBlocks(reply)
    expect(blocks).toEqual([
      {
        lang: 'bash',
        info: 'bash',
        code: 'npm i llmmend',
        start: reply.indexOf('```bash'),
        end: reply.indexOf('```\nThen') + 3,
        complete: true,
      },
      {
        lang: 'ts',
        info: 'ts title="app.ts"',
        code: "import { extractJson } from 'llmmend'\n\nextractJson(reply)",
        start: reply.indexOf('```ts'),
        end: reply.length,
        complete: true,
      },
    ])
    for (const b of blocks) expect(reply.slice(b.start, b.end)).toMatch(/^```[\s\S]*```$/)
  })

  it('filters by language, with common aliases and any case', () => {
    const reply = '```TypeScript\na\n```\n```js\nb\n```\n```sh\nc\n```\n```zsh\nd\n```'
    expect(extractCodeBlocks(reply, { lang: 'ts' }).map((b) => b.code)).toEqual(['a'])
    expect(extractCodeBlocks(reply, { lang: 'JavaScript' }).map((b) => b.code)).toEqual(['b'])
    expect(extractCodeBlocks(reply, { lang: 'bash' }).map((b) => b.code)).toEqual(['c', 'd'])
    expect(extractCodeBlocks(reply, { lang: 'rust' })).toEqual([])
    expect(extractCodeBlocks(reply)[0]?.lang).toBe('typescript')
  })

  it('returns a block the reply ends inside as incomplete', () => {
    const reply = 'Here:\n```python\ndef f():\n    return'
    expect(extractCodeBlocks(reply)).toEqual([
      {
        lang: 'python',
        info: 'python',
        code: 'def f():\n    return',
        start: 6,
        end: reply.length,
        complete: false,
      },
    ])
    expect(extractCodeBlocks('```js')).toMatchObject([{ lang: 'js', code: '', complete: false }])
  })

  it('closes a fence only with the same character, at least as long', () => {
    const reply = '````md\n```js\ninner\n```\n~~~~\n````\nafter'
    expect(extractCodeBlocks(reply)).toMatchObject([
      { lang: 'md', code: '```js\ninner\n```\n~~~~', complete: true },
    ])
    expect(extractCodeBlocks('~~~\na\n```\nb\n~~~')).toMatchObject([{ code: 'a\n```\nb' }])
  })

  it('keeps empty blocks, blocks without a language, and Windows line breaks', () => {
    expect(extractCodeBlocks('```\n```')).toEqual([
      { lang: '', info: '', code: '', start: 0, end: 7, complete: true },
    ])
    expect(extractCodeBlocks('```sql\r\nSELECT 1;\r\n```\r\n')).toMatchObject([
      { lang: 'sql', code: 'SELECT 1;', complete: true },
    ])
  })

  it('ignores inline triple backticks, indented code and fences indented four spaces', () => {
    const reply = 'Use ```inline``` here.\n\n    indented code\n\n    ```\n    not a fence\n    ```'
    expect(extractCodeBlocks(reply)).toEqual([])
  })

  it('never throws, and code and positions come from the text', () => {
    const fenced = fc
      .tuple(fc.string(), fc.constantFrom('```', '~~~', '````'), fc.string(), fc.string())
      .map(([before, fence, code, after]) => `${before}\n${fence}js\n${code}\n${fence}\n${after}`)
    fc.assert(
      fc.property(fc.oneof(fc.string(), fenced), (text) => {
        for (const b of extractCodeBlocks(text)) {
          expect(text.slice(b.start, b.end)).toContain(b.code)
          expect(b.start).toBeLessThanOrEqual(b.end)
        }
      }),
      { numRuns: 1000 },
    )
  })
})
