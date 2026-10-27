import { estimateCost, type Prices, toUsage } from 'llmmend/cost'
import { block, h, json, type Tool } from './dom'

const anthropic = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  usage: {
    input_tokens: 1_200,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 40_000,
    output_tokens: 800,
  },
}

const openai = {
  prompt_tokens: 2_000,
  completion_tokens: 500,
  total_tokens: 2_500,
  prompt_tokens_details: { cached_tokens: 1_024 },
  completion_tokens_details: { reasoning_tokens: 320 },
}

const gemini = {
  promptTokenCount: 250_000,
  candidatesTokenCount: 1_000,
  thoughtsTokenCount: 600,
  totalTokenCount: 251_600,
}

// The usage of an Anthropic stream cut off after `message_start`: input, no output yet.
const cutOff = { input_tokens: 3_000, cache_read_input_tokens: 0 }

const text = (value: unknown) => JSON.stringify(value, null, 2)

// Empty fields are left out, so a missing cache price falls back to `input`.
const price = (value: string | undefined) =>
  value === undefined || value.trim() === '' ? undefined : Number(value)

function prices(options: Record<string, string>): Prices {
  const result: Prices = {
    input: price(options['price-input']) ?? 0,
    output: price(options['price-output']) ?? 0,
  }
  const cacheRead = price(options['price-cache-read'])
  const cacheWrite = price(options['price-cache-write'])
  if (cacheRead !== undefined) result.cacheRead = cacheRead
  if (cacheWrite !== undefined) result.cacheWrite = cacheWrite
  const above = price(options['price-tier-above'])
  if (above !== undefined) {
    const tier: NonNullable<Prices['tiers']>[number] = { above }
    const input = price(options['price-tier-input'])
    const output = price(options['price-tier-output'])
    if (input !== undefined) tier.input = input
    if (output !== undefined) tier.output = output
    result.tiers = [tier]
  }
  return result
}

const money = (value: number) => `$${value.toFixed(6).replace(/0{1,4}$/, '')}`

export const tool: Tool = {
  samples: {
    anthropic: text(anthropic),
    openai: text(openai),
    gemini: text(gemini),
    'cut-off': text(cutOff),
  },
  render(input, options, t) {
    let raw: unknown
    try {
      raw = JSON.parse(input)
    } catch {
      return h('p', { class: 'status failed' }, t.cost.invalid)
    }
    // A whole reply works too: its `usage` (or Gemini's `usageMetadata`) is what counts.
    const object = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const usage = toUsage(object.usage ?? object.usageMetadata ?? raw)
    const cost = estimateCost(usage, prices(options))
    const rows = (['input', 'cacheRead', 'cacheWrite', 'output'] as const).map((part) =>
      h('tr', {}, h('th', {}, t.cost.parts[part]), h('td', {}, money(cost[part]))),
    )
    return h(
      'div',
      {},
      h('p', { class: 'status ok' }, `${t.cost.total}: ${money(cost.total)}`),
      cost.missing &&
        h('p', { class: 'status failed' }, `${t.cost.missing}: ${cost.missing.join(', ')}`),
      block(t.cost.breakdown, h('table', { class: 'cost' }, ...rows)),
      block('LlmUsage', json(usage)),
      h('p', { class: 'note' }, t.cost.note),
    )
  },
}
