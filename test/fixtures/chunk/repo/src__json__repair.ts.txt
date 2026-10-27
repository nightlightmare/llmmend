import { LlmmendJsonError } from '../shared/errors'
import type { Issue } from './issue'
import { parseJson } from './parser'

/**
 * Repairs JSON text the way models break it (trailing commas, single quotes, unquoted keys,
 * Python literals, `NaN`, raw control characters, comments, Truncation) and returns valid JSON
 * plus the Issues fixed. The whole text must be one value: use `extractJson` for a Reply with
 * text around it. Throws `LlmmendJsonError` when the text cannot be repaired.
 */
export function repairJson(text: string): { json: string; issues: Issue[] } {
  const result = parseJson(text, { repair: 'full' })
  if (!result.ok) {
    throw new LlmmendJsonError(
      result.error,
      `Cannot repair JSON: ${result.error} at position ${result.at}`,
      result.issues,
    )
  }
  return { json: JSON.stringify(result.value), issues: result.issues }
}
