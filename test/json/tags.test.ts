import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractAllTags, extractTag } from '../../src/json/index'

describe('extractTag', () => {
  it('returns the text of a tag in a reply, trimmed at its edges', () => {
    const reply = 'Let me think.\n<answer>\n  42 is\n  the answer\n</answer>\nDone.'
    expect(extractTag(reply, 'answer')).toEqual({
      ok: true,
      value: '42 is\n  the answer',
      attributes: {},
      issues: [],
    })
  })

  it('picks the last tag by default, the first on request', () => {
    const reply = 'Format: <answer>X</answer>. Thinking… <answer>Paris</answer>'
    expect(extractTag(reply, 'answer')).toMatchObject({ ok: true, value: 'Paris' })
    expect(extractTag(reply, 'answer', { pick: 'first' })).toMatchObject({ ok: true, value: 'X' })
  })

  it('returns attributes in any quoting, and bare ones as empty strings', () => {
    const reply = `<answer lang="en" confidence='0.9' draft final=yes>Hi</answer>`
    expect(extractTag(reply, 'answer')).toMatchObject({
      value: 'Hi',
      attributes: { lang: 'en', confidence: '0.9', draft: '', final: 'yes' },
    })
  })

  it('accepts a closing tag in another case and reports it', () => {
    const reply = 'x <Answer>Yes</answer>'
    expect(extractTag(reply, 'ANSWER')).toEqual({
      ok: true,
      value: 'Yes',
      attributes: {},
      issues: [{ code: 'tag_case_mismatch', at: reply.indexOf('</answer>') }],
    })
  })

  it('matches nested tags of the same name by depth', () => {
    const reply = '<note>outer <note>inner</note> tail</note>'
    expect(extractTag(reply, 'note')).toMatchObject({ value: 'outer <note>inner</note> tail' })
  })

  it('ignores tags inside fenced code blocks, ``` or ~~~, closed or not', () => {
    const backticks = 'Use:\n```xml\n<answer>example</answer>\n```\n<answer>real</answer>'
    expect(extractTag(backticks, 'answer', { pick: 'first' })).toMatchObject({ value: 'real' })
    const tildes = '~~~~\n<answer>example</answer>\n~~~~\n<answer>real</answer>'
    expect(extractTag(tildes, 'answer', { pick: 'first' })).toMatchObject({ value: 'real' })
    const unclosed = '<answer>real</answer>\n```\n<answer>example</answer>'
    expect(extractTag(unclosed, 'answer')).toMatchObject({ value: 'real' })
    // A shorter or different fence does not close it.
    const nested = '````\n```\n<answer>example</answer>\n~~~~\n````\n<answer>real</answer>'
    expect(extractTag(nested, 'answer', { pick: 'first' })).toMatchObject({ value: 'real' })
  })

  it('reports a tag cut off after the last closed one, with its text so far', () => {
    const reply = 'Format: <answer>X</answer>\n<answer>\nFirst, heat the oven to 180'
    expect(extractTag(reply, 'answer')).toEqual({
      ok: false,
      error: 'truncated',
      partial: 'First, heat the oven to 180',
    })
  })

  it('reports a missing tag', () => {
    expect(extractTag('No tags here, only a < b and </answer>.', 'answer')).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('reads a self-closing tag as empty, with its attributes', () => {
    expect(extractTag('<answer value="7" />', 'answer')).toMatchObject({
      ok: true,
      value: '',
      attributes: { value: '7' },
    })
  })

  it('keeps a self-closing tag of the same name inside the value', () => {
    expect(extractTag('<answer>see <answer/> here</answer>', 'answer')).toMatchObject({
      value: 'see <answer/> here',
    })
  })

  it('leaves entities and other tags inside the value alone', () => {
    expect(extractTag('<answer>a &lt; b<br>c</answer>', 'answer')).toMatchObject({
      value: 'a &lt; b<br>c',
    })
  })
})

describe('extractAllTags', () => {
  it('returns closed top-level tags in order, with positions', () => {
    const reply = '<thinking>plan <step>1</step></thinking>\n<answer>42</answer> <draft>'
    const tags = extractAllTags(reply)
    expect(tags.map((t) => [t.name, t.value])).toEqual([
      ['thinking', 'plan <step>1</step>'],
      ['answer', '42'],
    ])
    for (const tag of tags) expect(reply.slice(tag.start, tag.end)).toMatch(/^<.*>$/s)
  })

  it('filters by name, keeping the outermost of nested tags', () => {
    const reply = '<step>a <step>b</step></step> <step>c</step> <answer>x</answer>'
    expect(extractAllTags(reply, 'step').map((t) => t.value)).toEqual(['a <step>b</step>', 'c'])
  })

  it('keeps a tag that overlaps another without being inside it', () => {
    const reply = '<a>1 <b>2</a> 3</b>'
    expect(extractAllTags(reply).map((t) => t.name)).toEqual(['a', 'b'])
  })

  it('skips tags in code fences and stray closing tags', () => {
    const reply = '</answer>\n```\n<answer>no</answer>\n```\n<answer>yes</answer>'
    expect(extractAllTags(reply).map((t) => t.value)).toEqual(['yes'])
  })
})

describe('tags: properties', () => {
  const tagged = fc
    .tuple(fc.string(), fc.constantFrom('answer', 'Answer', 'step'), fc.string(), fc.string())
    .map(([before, name, value, after]) => `${before}<${name}>${value}</${name}>${after}`)

  it('never throws, and values are substrings of the reply', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), tagged), (text) => {
        const result = extractTag(text, 'answer')
        expect(!result.ok || text.includes(result.value)).toBe(true)
        for (const tag of extractAllTags(text)) {
          expect(text).toContain(tag.value)
          expect(tag.start).toBeLessThan(tag.end)
        }
      }),
      { numRuns: 1000 },
    )
  })
})
