import { describe, expect, it } from 'vitest'
import { extractJson } from '../../src/json'
import { jsonSchema } from '../../site/src/json-schema'

const schema = jsonSchema({
  type: 'object',
  required: ['city', 'temp'],
  additionalProperties: false,
  properties: {
    city: { type: 'string' },
    temp: { type: 'integer' },
    unit: { enum: ['C', 'F'] },
    tags: { type: 'array', items: { type: 'string' } },
    kind: { const: 'weather' },
  },
})

const issues = (text: string) => {
  const res = extractJson(text, { schema })
  return res.ok ? [] : res.error === 'schema_mismatch' ? res.schemaIssues : [res.error]
}

describe('playground JSON Schema subset', () => {
  it('accepts a matching value', () => {
    expect(
      issues('{"city": "Paris", "temp": 21, "unit": "C", "tags": ["a"], "kind": "weather"}'),
    ).toEqual([])
  })

  it('reports each mismatch with its path', () => {
    expect(
      issues('{"temp": 21.5, "unit": "K", "tags": ["a", 1], "kind": "other", "extra": true}'),
    ).toEqual([
      { message: 'Missing property "city"', path: [] },
      { message: 'Expected integer, got number', path: ['temp'] },
      { message: 'Expected one of "C", "F"', path: ['unit'] },
      { message: 'Expected string, got number', path: ['tags', 1] },
      { message: 'Expected "weather"', path: ['kind'] },
      { message: 'Unexpected property "extra"', path: ['extra'] },
    ])
  })

  it('checks the type first and stops there', () => {
    expect(issues('[1, 2]')).toEqual([{ message: 'Expected object, got array', path: [] }])
  })
})
