import { coerceAsync } from '../json/coerce'
import type { Issue } from '../json/issue'
import { parseJson } from '../json/parser'
import type { StandardSchemaV1 } from '../json/schema'

/** Schemas for the tools a model may call, by tool name: any Standard Schema. */
export type ToolSchemas = Record<string, StandardSchemaV1>

/**
 * Why a tool call cannot be used. `truncated`: the arguments were cut off (never completed, since
 * running half a call is unsafe); `unknown_tool`: the model called a tool missing from `tools`.
 * Closed union: adding a member is a minor release (ADR 0002).
 */
export type ToolCallError =
  | 'truncated'
  | 'unparseable'
  | 'max_depth'
  | 'schema_mismatch'
  | 'unknown_tool'

interface CallBase {
  /** The call's Block. */
  index: number
  id: string
}

type Output<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : never

/** A usable call: JSON arguments in `args`, or a custom tool's free-form text in `input`. */
type Called<Name, Args, Input> =
  | (CallBase & { ok: true; name: Name; custom?: undefined; args: Args; issues: Issue[] })
  | (CallBase & { ok: true; name: Name; custom: true; input: Input; issues: Issue[] })

type Usable<Tools extends ToolSchemas> = [keyof Tools] extends [never]
  ? Called<string, unknown, string>
  : {
      [Name in keyof Tools & string]: Called<Name, Output<Tools[Name]>, Output<Tools[Name]>>
    }[keyof Tools & string]

type Failed = CallBase & {
  ok: false
  name: string
  custom?: true
  /** The arguments (or a custom tool's input) as the model wrote them. */
  argsText: string
  issues: Issue[]
}

/**
 * One tool call of an answer, assembled from its LLM events. With `tools`, a usable call's `args`
 * has the type of its tool's schema output, narrowed by `name`.
 */
export type ToolCall<Tools extends ToolSchemas = Record<never, never>> =
  | Usable<Tools>
  | (Failed & { error: 'schema_mismatch'; schemaIssues: readonly StandardSchemaV1.Issue[] })
  | (Failed & { error: Exclude<ToolCallError, 'schema_mismatch'> })

/** A tool call while its Block streams: everything `tool_call_start` and the deltas gave. */
export interface PendingToolCall {
  index: number
  id: string
  name: string
  argsText: string
  custom: boolean
}

type AnyCall = ToolCall<ToolSchemas>

async function finish(
  call: PendingToolCall,
  tools: ToolSchemas | undefined,
  coerce: boolean | undefined,
): Promise<AnyCall> {
  const { index, id, name, argsText, custom } = call
  const base = { index, id, name, ...(custom ? { custom: true as const } : {}) }
  if (tools && !Object.hasOwn(tools, name))
    return { ...base, ok: false, error: 'unknown_tool', argsText, issues: [] }

  let value: unknown = argsText
  let issues: Issue[] = []
  if (!custom) {
    // A tool without parameters may stream no argument text at all.
    if (!argsText.trim()) value = {}
    else {
      const parsed = parseJson(argsText, { repair: 'syntax' })
      if (!parsed.ok)
        return { ...base, ok: false, error: parsed.error, argsText, issues: parsed.issues }
      value = parsed.value
      issues = parsed.issues
    }
  }

  const schema = tools?.[name]
  if (schema) {
    const { validate } = schema['~standard']
    let validated = await validate(value)
    if (validated.issues && coerce) {
      const coerced = await coerceAsync(value, validated, validate)
      validated = coerced.result
      issues = [...issues, ...coerced.issues]
    }
    if (validated.issues)
      return {
        ...base,
        ok: false,
        error: 'schema_mismatch',
        argsText,
        issues,
        schemaIssues: validated.issues,
      }
    value = validated.value
  }
  return custom
    ? { index, id, name, ok: true, custom: true, input: value as string, issues }
    : { index, id, name, ok: true, args: value, issues }
}

/** Turns the calls collected from a stream into tool calls, in Block order. */
export function finishToolCalls(
  calls: Iterable<PendingToolCall>,
  tools: ToolSchemas | undefined,
  coerce?: boolean,
): Promise<AnyCall[]> {
  // Sorts a copy (toSorted is newer than the ES2022 target).
  // oxlint-disable-next-line unicorn/no-array-sort
  return Promise.all(
    [...calls].sort((a, b) => a.index - b.index).map((c) => finish(c, tools, coerce)),
  )
}
