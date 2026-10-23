import { parse as parsePartial } from 'partial-json'
import { parsePartialJson } from 'llmmend/json'
import { attempt, compare } from './compare'

const items = Array.from({ length: 2000 }, (_, i) => ({
  id: i,
  name: `Item ${i} «${'x'.repeat(i % 17)}»`,
  tags: ['a', 'b', 'c'].slice(0, i % 4),
  price: i * 1.25,
  active: i % 3 === 0,
  note: null,
}))
// A progressive UI re-parses the growing prefix after every streamed chunk.
const small = JSON.stringify({ items: items.slice(0, 100) })
const prefixes = Array.from({ length: Math.ceil(small.length / 64) }, (_, i) =>
  small.slice(0, (i + 1) * 64),
)

compare(
  `partial parse of ${prefixes.length} growing prefixes (${(small.length / 1024).toFixed(0)} kB)`,
  [
    'llmmend parsePartialJson',
    () => {
      for (const prefix of prefixes) parsePartialJson(prefix)
    },
  ],
  [
    'partial-json',
    () => {
      for (const prefix of prefixes) attempt(() => parsePartial(prefix))
    },
  ],
)
