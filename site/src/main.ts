// Wires a page: loads its tab's tool, restores a shared link or the first example, and re-renders
// the result as the input or an option changes.
// oxlint-disable-next-line import/no-unassigned-import -- Vite bundles the page's styles from here.
import './style.css'
import type { Strings, Tool } from './dom'
import { decodeState, encodeState, type State } from './share'

const t = JSON.parse(document.getElementById('strings')!.textContent!) as Strings
const tools: Record<Strings['tab'], () => Promise<{ tool: Tool }>> = {
  json: () => import('./json'),
  sse: () => import('./sse'),
  chunk: () => import('./chunk'),
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
document.getElementById('share')!.addEventListener('click', async () => {
  const values = Object.fromEntries(options.map((element) => [element.id, element.value]))
  const hash = await encodeState({ input: input.value, options: values })
  if (!hash) {
    status.textContent = t.tooLong
    return
  }
  history.replaceState(null, '', `#${hash}`)
  try {
    await navigator.clipboard.writeText(location.href)
    status.textContent = t.copied
  } catch {
    // No clipboard permission: the link is in the address bar.
    status.textContent = ''
  }
})

await render()
