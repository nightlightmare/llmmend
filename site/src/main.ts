// Wires a page: loads its tab's tool, restores a shared link or the first example, and re-renders
// the result as the input or an option changes.
// oxlint-disable-next-line import/no-unassigned-import -- Vite bundles the page's styles from here.
import './style.css'
import type { Strings, Tool } from './dom'
import { decodeState, encodeState, type State } from './share'

const t = JSON.parse(document.getElementById('strings')!.textContent!) as Strings

// The style menu: the choice lives on <html> and in this browser only.
const THEME_KEY = 'llmmend-theme'
const choices = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')]
const showTheme = () => {
  const current = document.documentElement.dataset.theme ?? 'claude'
  for (const choice of choices)
    choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === current))
}
for (const choice of choices)
  choice.addEventListener('click', () => {
    document.documentElement.dataset.theme = choice.dataset.themeChoice!
    try {
      localStorage.setItem(THEME_KEY, choice.dataset.themeChoice!)
    } catch {
      // Storage blocked (private mode): the style still applies to this page.
    }
    showTheme()
    choice.closest('details')!.open = false
  })
showTheme()

// Menus close on a click elsewhere and on Escape, like other dropdowns.
const menus = [...document.querySelectorAll<HTMLDetailsElement>('details.menu')]
document.addEventListener('click', (event) => {
  for (const menu of menus) if (!menu.contains(event.target as Node)) menu.open = false
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  for (const menu of menus)
    if (menu.open) {
      menu.open = false
      menu.querySelector('summary')!.focus()
    }
})
const tools: Record<Strings['tab'], () => Promise<{ tool: Tool }>> = {
  json: () => import('./json'),
  sse: () => import('./sse'),
  chunk: () => import('./chunk'),
  prompt: () => import('./prompt'),
  cost: () => import('./cost'),
  retry: () => import('./retry'),
}
const { tool } = await tools[t.tab]()

const input = document.getElementById('input') as HTMLTextAreaElement
const output = document.getElementById('output')!
const sample = document.getElementById('sample') as HTMLSelectElement
// Every option except the example picker: these go into share links.
const options = [
  ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'select, input, textarea:not(#input)',
  ),
].filter((element) => element !== sample)

let latest = 0
async function render() {
  const run = ++latest
  const values = Object.fromEntries(options.map((element) => [element.id, element.value]))
  let result: Node
  try {
    result = await tool.render(input.value, values, t)
  } catch (error) {
    result = document.createTextNode(String(error))
  }
  // A slower earlier render (streams are async) must not replace a newer one.
  if (run === latest) output.replaceChildren(result)
}

let timer: ReturnType<typeof setTimeout> | undefined
const soon = () => {
  clearTimeout(timer)
  timer = setTimeout(render, 120)
}

function apply(state: State) {
  input.value = state.input
  for (const element of options)
    if (state.options[element.id] !== undefined) element.value = state.options[element.id]!
}

const shared = await decodeState(location.hash)
apply(shared ?? { input: tool.samples[sample.value] ?? '', options: {} })
input.addEventListener('input', soon)
for (const element of options) element.addEventListener('input', soon)
sample.addEventListener('change', () => {
  input.value = tool.samples[sample.value] ?? ''
  void render()
})

const status = document.getElementById('share-status')!
const share = document.getElementById('share')!
let shareTimer: ReturnType<typeof setTimeout> | undefined
share.addEventListener('click', async () => {
  const values = Object.fromEntries(options.map((element) => [element.id, element.value]))
  const hash = await encodeState({ input: input.value, options: values })
  if (!hash) {
    status.classList.remove('sr-only')
    status.textContent = t.tooLong
    return
  }
  history.replaceState(null, '', `#${hash}`)
  try {
    await navigator.clipboard.writeText(location.href)
  } catch {
    // No clipboard permission: the link is in the address bar.
    return
  }
  // A check mark in place of the icon for a moment; screen readers hear the status instead.
  status.classList.add('sr-only')
  status.textContent = t.copied
  share.classList.add('copied')
  clearTimeout(shareTimer)
  shareTimer = setTimeout(() => {
    share.classList.remove('copied')
    status.textContent = ''
  }, 2000)
})

await render()
