/** The strings a page embeds for its own language (site/i18n.mjs), as far as the scripts use them. */
export interface Strings {
  lang: string
  tab: 'json' | 'sse' | 'chunk'
  copied: string
  tooLong: string
  json: Record<
    'schemaInvalid' | 'value' | 'issues' | 'noIssues' | 'raw' | 'schemaIssues' | 'ok' | 'failed',
    string
  >
  sse: Record<'text' | 'reasoning' | 'stop' | 'usage' | 'events' | 'more' | 'failed', string>
  chunk: Record<'total' | 'chunks' | 'tokens' | 'oversized' | 'estimate', string>
}

/** One playground tab: its examples and how it turns the input and options into the result. */
export interface Tool {
  samples: Record<string, string>
  render(input: string, options: Record<string, string>, t: Strings): Node | Promise<Node>
}

type Child = Node | string | false | null | undefined

/** Creates an element; `false`, `null` and `undefined` children are skipped. */
export function h(
  tag: string,
  attributes: Record<string, string> = {},
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  for (const child of children) if (child || child === '') element.append(child)
  return element
}

/** A titled block of the result. */
export const block = (title: string, ...children: Child[]): HTMLElement =>
  h('section', { class: 'block' }, h('h3', {}, title), ...children)

export const pre = (text: string): HTMLElement => h('pre', {}, text)

export const json = (value: unknown): HTMLElement =>
  pre(JSON.stringify(value, null, 2) ?? String(value))
