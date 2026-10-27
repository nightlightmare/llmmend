import { locate } from './locate'

/**
 * Reads JSON that is still arriving, for progressive UIs. Takes a Reply (preamble and code fence
 * are skipped) and returns the first object or array in it as far as it goes:
 *
 * - an unfinished string is returned as is, so it grows as text arrives;
 * - an unfinished number or literal, and a key without a value, are left out until they finish;
 * - a value once returned as finished never changes later.
 *
 * `complete` is true once the value's closing bracket has arrived. Never throws; `value` is
 * `undefined` while no object or array has started.
 */
export function parsePartialJson(text: string): { value: unknown; complete: boolean } {
  const candidate = locate(text, 'partial', true).candidates[0]
  if (!candidate) return { value: undefined, complete: false }
  const complete = !candidate.issues.some((i) => i.code === 'truncated_closed')
  return { value: candidate.value, complete }
}
