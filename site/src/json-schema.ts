// A small JSON Schema subset wrapped as a Standard Schema, so the playground can show
// `schema_mismatch` without bundling a validator. Real code passes Zod, Valibot or ArkType.
import type { StandardSchemaV1 } from 'llmmend/json'

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  additionalProperties?: boolean | Schema
}

type Issue = { message: string; path: PropertyKey[] }

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'integer') return Number.isInteger(value)
  return typeOf(value) === type
}

function check(schema: Schema, value: unknown, path: PropertyKey[], issues: Issue[]): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => matchesType(value, type))) {
      issues.push({ message: `Expected ${types.join(' or ')}, got ${typeOf(value)}`, path })
      return
    }
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    issues.push({ message: `Expected ${JSON.stringify(schema.const)}`, path })
  if (
    schema.enum &&
    !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))
  )
    issues.push({
      message: `Expected one of ${schema.enum.map((o) => JSON.stringify(o)).join(', ')}`,
      path,
    })
  if (Array.isArray(value) && schema.items)
    value.forEach((item, i) => check(schema.items!, item, [...path, i], issues))
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? [])
      if (!(key in object)) issues.push({ message: `Missing property "${key}"`, path })
    for (const [key, item] of Object.entries(object)) {
      const property = schema.properties?.[key]
      if (property) check(property, item, [...path, key], issues)
      else if (schema.additionalProperties === false)
        issues.push({ message: `Unexpected property "${key}"`, path: [...path, key] })
      else if (typeof schema.additionalProperties === 'object')
        check(schema.additionalProperties, item, [...path, key], issues)
    }
  }
}

/** Wraps a parsed JSON Schema object as a Standard Schema validator. */
export function jsonSchema(schema: Schema): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'llmmend-playground',
      validate(value) {
        const issues: Issue[] = []
        check(schema, value, [], issues)
        return issues.length ? { issues } : { value }
      },
    },
  }
}
