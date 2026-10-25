// Inline SVG icons for the playground, read from npm packages at build time so the pages load no
// icon files: interface icons from lucide-static (ISC), provider marks from
// @lobehub/icons-static-svg (MIT).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lucide = (name) => require.resolve(`lucide-static/icons/${name}.svg`)
const lobe = (name) => require.resolve(`@lobehub/icons-static-svg/icons/${name}.svg`)

/** The style themes, each named after the interface whose colours it takes. */
export const THEMES = [
  { id: 'claude', name: 'Claude', file: lobe('claude-color') },
  { id: 'openai', name: 'OpenAI', file: lobe('openai') },
  { id: 'openrouter', name: 'OpenRouter', file: lobe('openrouter') },
  { id: 'gemini', name: 'Gemini', file: lobe('gemini-color') },
]

const FILES = {
  globe: lucide('globe'),
  share: lucide('share-2'),
  check: lucide('check'),
  chevron: lucide('chevron-down'),
  ...Object.fromEntries(THEMES.map((theme) => [theme.id, theme.file])),
}

let instance = 0

/**
 * The icon as inline SVG, hidden from screen readers (the button around it carries the label).
 * Gradient ids get a per-use suffix, since the same mark appears more than once on a page.
 */
export function icon(name, className = '') {
  const n = ++instance
  return readFileSync(FILES[name], 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/\s(width|height|class|style)="[^"]*"/g, '')
    .replace(/\sid="([^"]+)"/g, ` id="$1-${n}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`)
    .replace(
      '<svg',
      `<svg class="icon${className ? ` ${className}` : ''}" aria-hidden="true" focusable="false"`,
    )
    .replace(/\s+/g, ' ')
    .trim()
}
