import { jsonrepair } from 'jsonrepair'
import { repairJson } from 'llmmend/json'
import { fixtureDir } from '../fixtures'
import { attempt, compare } from './compare'

const items = Array.from({ length: 2000 }, (_, i) => ({
  id: i,
  name: `Item ${i} «${'x'.repeat(i % 17)}»`,
  tags: ['a', 'b', 'c'].slice(0, i % 4),
  price: i * 1.25,
  active: i % 3 === 0,
  note: null,
}))
const valid = JSON.stringify({ items }, null, 2)

// What LLMs get wrong: single quotes, unquoted keys, trailing commas, Python literals, a cut-off end.
const broken = valid
  .replaceAll('"name"', 'name')
  .replaceAll('"', "'")
  .replaceAll('\n  ]', ',\n  ]')
  .replaceAll('true', 'True')
  .slice(0, -1000)

const corpus = [...fixtureDir('llm-replies')]
  .filter(([name]) => name.startsWith('repair-') && name.endsWith('.txt'))
  .map(([, text]) => text)

compare(
  `repair ${(broken.length / 1024).toFixed(0)} kB of broken JSON`,
  [
    'llmmend repairJson',
    () => {
      repairJson(broken)
    },
  ],
  [
    'jsonrepair',
    () => {
      jsonrepair(broken)
    },
  ],
)

compare(
  `repair the ${corpus.length}-entry fixture corpus`,
  [
    'llmmend repairJson',
    () => {
      for (const text of corpus) attempt(() => repairJson(text))
    },
  ],
  [
    'jsonrepair',
    () => {
      for (const text of corpus) attempt(() => jsonrepair(text))
    },
  ],
)
