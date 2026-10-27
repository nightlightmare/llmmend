import { fencedBlocks } from './code-blocks'
import type { Issue } from './issue'

/** A closed tag found in a Reply. `start` and `end` span the whole tag, opening to closing. */
export interface Tag {
  name: string
  /** The text between the opening and closing tag, trimmed at its edges only. */
  value: string
  /** Attributes of the opening tag; one without a value is `''`. */
  attributes: Record<string, string>
  start: number
  end: number
}

export type ExtractTagResult =
  | { ok: true; value: string; attributes: Record<string, string>; issues: Issue[] }
  | { ok: false; error: 'not_found' }
  /** The tag opened and the Reply ended first; `partial` is its text so far. */
  | { ok: false; error: 'truncated'; partial: string }

export interface ExtractTagOptions {
  /** Which tag to use when the Reply has several. Default `'last'`. */
  pick?: 'first' | 'last'
}

interface Token {
  /** As written: case may differ between the opening and closing tag. */
  name: string
  close: boolean
  selfClosing: boolean
  attributes: string
  start: number
  end: number
}

interface Pair {
  open: Token
  close: Token | undefined
}

// No '<' inside a tag: each match attempt stops at the next '<', which keeps a long text full of
// stray '<' (comparisons, generics) linear instead of quadratic.
const TAG =
  /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[^\s=<>/]+(?:\s*=\s*(?:"[^"<]*"|'[^'<]*'|[^\s"'<>]+))?)*)\s*(\/?)>/g
const ATTRIBUTE = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g

/** Spans of fenced code blocks, where tags are format examples, not answers. */
const fences = (text: string): [number, number][] => fencedBlocks(text).map((b) => [b.start, b.end])

function tokens(text: string): Token[] {
  const skip = fences(text)
  let fence = 0
  const found: Token[] = []
  for (const m of text.matchAll(TAG)) {
    const start = m.index
    // Matches and fences both come in text order: one pass over each.
    while (fence < skip.length && skip[fence]![1] <= start) fence++
    if (fence < skip.length && start >= skip[fence]![0]) continue
    found.push({
      name: m[2]!,
      close: m[1] === '/',
      selfClosing: m[4] === '/',
      attributes: m[3]!,
      start,
      end: start + m[0].length,
    })
  }
  return found
}

/**
 * Matches the tags of each name by depth; a closing tag with nothing open is ignored. An
 * opening tag still open at the end has no `close`.
 */
function pairs(all: Token[], name?: string): Pair[] {
  const byName = new Map<string, Token[]>()
  for (const token of all) {
    const key = token.name.toLowerCase()
    if (name !== undefined && key !== name.toLowerCase()) continue
    const list = byName.get(key)
    if (list) list.push(token)
    else byName.set(key, [token])
  }
  const result: Pair[] = []
  for (const list of byName.values()) {
    let open: Token | undefined
    let depth = 0
    for (const token of list) {
      if (token.selfClosing && !token.close) {
        if (!depth) result.push({ open: token, close: token })
      } else if (!token.close) {
        if (!depth++) open = token
      } else if (depth && !--depth) {
        result.push({ open: open!, close: token })
        open = undefined
      }
    }
    if (open) result.push({ open, close: undefined })
  }
  // A local array (toSorted is newer than the ES2022 target).
  // oxlint-disable-next-line unicorn/no-array-sort
  return result.sort((a, b) => a.open.start - b.open.start)
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of source.matchAll(ATTRIBUTE)) out[m[1]!] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

function toTag(text: string, { open, close }: Pair & { close: Token }): Tag {
  const value = open === close ? '' : text.slice(open.end, close.start).trim()
  return {
    name: open.name,
    value,
    attributes: attributes(open.attributes),
    start: open.start,
    end: close.end,
  }
}

const closed = (pair: Pair): pair is Pair & { close: Token } => pair.close !== undefined

/**
 * Finds a tag in a model Reply (`<answer>…</answer>`) and returns its text. Tags inside fenced
 * code blocks don't count; the closing tag may differ in case; attributes are returned. An
 * opening tag the Reply cuts off after the last closed one is the real answer: `truncated`.
 */
export function extractTag(
  text: string,
  name: string,
  options: ExtractTagOptions = {},
): ExtractTagResult {
  const found = pairs(tokens(text), name)
  const complete = found.filter(closed)
  const cut = found.find((p) => !p.close)
  const lastEnd = complete.at(-1)?.close.end ?? -1
  if (cut && cut.open.start > lastEnd)
    return { ok: false, error: 'truncated', partial: text.slice(cut.open.end).trim() }
  const pair = options.pick === 'first' ? complete[0] : complete.at(-1)
  if (!pair) return { ok: false, error: 'not_found' }
  const tag = toTag(text, pair)
  const issues: Issue[] =
    pair.open !== pair.close && pair.open.name !== pair.close.name
      ? [{ code: 'tag_case_mismatch', at: pair.close.start }]
      : []
  return { ok: true, value: tag.value, attributes: tag.attributes, issues }
}

/**
 * Every closed top-level tag in the Reply, in order; with `name`, only tags of that name (the
 * outermost when they nest). Tags inside fenced code blocks don't count.
 */
export function extractAllTags(text: string, name?: string): Tag[] {
  const top: Tag[] = []
  // In order of start, a tag is nested when it ends inside the last top-level one.
  let outerEnd = -1
  for (const pair of pairs(tokens(text), name).filter(closed)) {
    const tag = toTag(text, pair)
    if (tag.start < outerEnd && tag.end <= outerEnd) continue
    top.push(tag)
    outerEnd = Math.max(outerEnd, tag.end)
  }
  return top
}
