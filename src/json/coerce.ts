// Schema-guided coercion, the opt-in `coerce` option: when a schema rejects a value, try the
// type slips models make (`"42"` for 42, `"true"` for true, and back) at the paths the schema's
// issues name. Standard Schema exposes no structure, only `validate`, so the paths are the only
// guide; messages are never read, so it works the same for every schema library.
import type { CoercedType, Issue } from './issue'
import type { StandardSchemaV1 } from './schema'

type Result = StandardSchemaV1.Result<unknown>
type Key = string | number

/** Upper bound on passes, whatever the number of issues. */
const MAX_PASSES = 32
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** The path as plain keys, or undefined when a key is a symbol (never in parsed JSON). */
function keysOf(path: StandardSchemaV1.Issue['path']): Key[] | undefined {
  const keys: Key[] = []
  for (const segment of path ?? []) {
    const key = typeof segment === 'object' ? segment.key : segment
    if (typeof key === 'symbol') return undefined
    keys.push(key)
  }
  return keys
}

const samePath = (a: Key[] | undefined, b: Key[]): boolean =>
  a !== undefined && a.length === b.length && a.every((key, i) => String(key) === String(b[i]))

function get(value: unknown, path: Key[]): unknown {
  for (const key of path) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
    value = (value as Record<Key, unknown>)[key]
  }
  return value
}

/** `value` with `next` at `path`, copying the containers on the way: `value` is not changed. */
function set(value: unknown, path: Key[], next: unknown): unknown {
  if (!path.length) return next
  const [key, ...rest] = path as [Key, ...Key[]]
  const container = value as Record<Key, unknown>
  const copy = (Array.isArray(value) ? [...value] : { ...container }) as Record<Key, unknown>
  Object.defineProperty(copy, key, {
    value: set(container[key], rest, next),
    writable: true,
    enumerable: true,
    configurable: true,
  })
  return copy
}

/** What a model may have meant instead of `value`. */
function alternatives(value: unknown): unknown[] {
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (typeof value !== 'string') return []
  if (NUMBER.test(value)) return [Number(value)]
  if (value === 'true' || value === 'false') return [value === 'true']
  return value === 'null' ? [null] : []
}

const typeOf = (value: unknown): CoercedType =>
  value === null ? 'null' : (typeof value as CoercedType)

export interface Coerced {
  value: unknown
  result: Result
  /** One `coerced` Issue per change kept. */
  issues: Issue[]
}

/**
 * The steps of coercing `value`, which `result` rejected: yields each value to validate and takes
 * its result back, so one loop serves sync and async schemas. A pass keeps the first change that
 * makes the issue at its path go away; there are at most as many passes as issues, and at most 32.
 */
export function* coercion(value: unknown, result: Result): Generator<unknown, Coerced, Result> {
  const issues: Issue[] = []
  let passes = Math.min(result.issues?.length ?? 0, MAX_PASSES)
  while (result.issues && passes-- > 0) {
    let kept = false
    for (const issue of result.issues) {
      const path = keysOf(issue.path)
      if (!path) continue
      const before = get(value, path)
      for (const after of alternatives(before)) {
        const next = set(value, path, after)
        const tried: Result = yield next
        if (tried.issues?.some((i) => samePath(keysOf(i.path), path))) continue
        value = next
        result = tried
        issues.push({ code: 'coerced', path, from: typeOf(before), to: typeOf(after) })
        kept = true
        break
      }
      if (kept) break
    }
    if (!kept) break
  }
  return { value, result, issues }
}

/** Runs `coercion` with a validator that must answer synchronously. */
export function coerceSync(
  value: unknown,
  result: Result,
  validate: (value: unknown) => Result,
): Coerced {
  const steps = coercion(value, result)
  let step = steps.next()
  while (!step.done) step = steps.next(validate(step.value))
  return step.value
}

/** Runs `coercion` with any validator. */
export async function coerceAsync(
  value: unknown,
  result: Result,
  validate: (value: unknown) => Result | Promise<Result>,
): Promise<Coerced> {
  const steps = coercion(value, result)
  let step = steps.next()
  while (!step.done) step = steps.next(await validate(step.value))
  return step.value
}
