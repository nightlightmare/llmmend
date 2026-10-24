import { streamLlm, type LlmEvent, type Provider } from 'llmmend/sse'
import anthropicTools from '../../test/fixtures/sse/anthropic/tool-use-parallel.sse?raw'
import anthropicText from '../../test/fixtures/sse/anthropic/text.sse?raw'
import geminiText from '../../test/fixtures/sse/gemini/text.sse?raw'
import openaiTools from '../../test/fixtures/sse/ollama/tool-calls.sse?raw'
import responsesRefusal from '../../test/fixtures/sse/openai-responses/refusal.sse?raw'
import openrouterReasoning from '../../test/fixtures/sse/openrouter/reasoning.sse?raw'
import { block, h, json, pre, type Tool } from './dom'

/** Events listed one per line; longer streams show the rest as a count. */
const MAX_EVENTS = 300

export const tool: Tool = {
  samples: {
    'anthropic-text': anthropicText,
    'anthropic-tools': anthropicTools,
    'openai-tools': openaiTools,
    'openrouter-reasoning': openrouterReasoning,
    'responses-refusal': responsesRefusal,
    'gemini-text': geminiText,
  },
  async render(input, options, t) {
    const events: LlmEvent[] = []
    let failure: unknown
    try {
      for await (const event of streamLlm(new Response(input), {
        provider: (options.provider ?? 'auto') as Provider,
      }))
        events.push(event)
    } catch (error) {
      failure = error
    }

    const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
    const reasoning = events.flatMap((e) => (e.type === 'reasoning' ? [e.text] : [])).join('')
    const done = events.find((e) => e.type === 'done')
    let usage: LlmEvent | undefined
    for (const e of events) if (e.type === 'usage') usage = e
    const calls = new Map<number, { id: string; name: string; args: string }>()
    for (const e of events) {
      if (e.type === 'tool_call_start') calls.set(e.index, { id: e.id, name: e.name, args: '' })
      else if (e.type === 'tool_call_delta') calls.get(e.index)!.args += e.argsDelta
    }
    const errors = events.flatMap((e) => (e.type === 'error' ? [e.message] : []))

    return h(
      'div',
      {},
      failure !== undefined &&
        h('p', { class: 'status failed' }, `✗ ${t.sse.failed}: `, h('code', {}, String(failure))),
      ...errors.map((message) => h('p', { class: 'status failed' }, `✗ ${message}`)),
      done &&
        h(
          'p',
          { class: 'status ok' },
          `${t.sse.stop}: `,
          h('code', {}, done.stopReason),
          done.rawStopReason ? ` (${done.rawStopReason})` : '',
        ),
      reasoning && block(t.sse.reasoning, pre(reasoning)),
      text && block(t.sse.text, pre(text)),
      ...[...calls.values()].map((call) => {
        let args: unknown = call.args
        try {
          args = JSON.parse(call.args)
        } catch {
          // Arguments cut off mid-stream: show the raw text.
        }
        return block(`${call.name} (${call.id})`, json(args))
      }),
      usage && block(t.sse.usage, json({ ...usage, type: undefined })),
      block(
        `${t.sse.events} (${events.length})`,
        pre(
          events
            .slice(0, MAX_EVENTS)
            .map((e) =>
              JSON.stringify(e.type === 'other' ? { type: 'other', event: e.raw.event } : e),
            )
            .join('\n') +
            (events.length > MAX_EVENTS ? `\n… ${events.length - MAX_EVENTS} ${t.sse.more}` : ''),
        ),
      ),
    )
  },
}
