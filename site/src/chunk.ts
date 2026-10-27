import { chunkText, estimateTokens, type Tokenizer } from 'llmmend/chunk'
import readme from '../../README.md?raw'
import ja from '../../test/fixtures/chunk/corpus/ja.txt?raw'
import { block, h, type Tool } from './dom'

export const tool: Tool = {
  // The README from its first section: the badges above it make a dull first chunk.
  samples: { readme: readme.slice(readme.indexOf('## Why')), ja },
  render(input, options, t) {
    const maxTokens = Math.max(1, Number(options['max-tokens']) || 1)
    const overlap = Math.max(0, Math.min(maxTokens - 1, Number(options.overlap) || 0))
    const tokenizer: Tokenizer =
      options.tokenizer === 'claude' || options.tokenizer === 'gemini' ? options.tokenizer : 'o200k'
    const chunks = chunkText(input, {
      maxTokens,
      overlap,
      mode: options.mode === 'text' ? 'text' : 'markdown',
      tokenizer,
    })
    return h(
      'div',
      {},
      h(
        'p',
        { class: 'status ok' },
        `${t.chunk.total}: ${estimateTokens(input, { tokenizer })} ${t.chunk.tokens}`,
      ),
      block(
        `${t.chunk.chunks} (${chunks.length})`,
        ...chunks.map((chunk, i) => {
          // The part repeated from the previous chunk.
          const shared = i > 0 ? Math.max(0, chunks[i - 1]!.end - chunk.start) : 0
          return h(
            'article',
            { class: chunk.oversized ? 'chunk oversized' : 'chunk' },
            h(
              'header',
              {},
              `#${chunk.index} · ${chunk.tokens} ${t.chunk.tokens} · ${chunk.start}–${chunk.end}`,
              chunk.oversized && ` · ${t.chunk.oversized}`,
            ),
            h(
              'pre',
              {},
              shared > 0 && h('mark', {}, chunk.text.slice(0, shared)),
              chunk.text.slice(shared),
            ),
          )
        }),
      ),
      h('p', { class: 'note' }, t.chunk.estimate),
    )
  },
}
