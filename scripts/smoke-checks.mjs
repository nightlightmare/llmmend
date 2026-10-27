// The smoke checks, one per package subpath. Plain ES with no runtime APIs beyond Web standards,
// so the same file runs on Node, Bun, Deno and in a Cloudflare Worker.

const assert = {
  equal(actual, expected) {
    if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`)
  },
  ok(value) {
    if (!value) throw new Error('expected a truthy value')
  },
  // Enough for the plain data compared here: same keys in the same order.
  deepEqual(actual, expected) {
    assert.equal(JSON.stringify(actual), JSON.stringify(expected))
  },
}

// One check per subpath; keep in sync with `exports`.
export const checks = {
  '.': (m) => {
    assert.equal(new m.LlmmendJsonError('not_found', '', []).name, 'LlmmendJsonError')
    assert.ok(new m.LlmmendHttpError(500, new Headers(), '') instanceof m.LlmmendError)
  },
  './json': (m) => {
    assert.deepEqual(
      m.extractCodeBlocks('```TypeScript\nlet a\n```\n```py\nb', { lang: 'ts' }).map((b) => b.code),
      ['let a'],
    )
    assert.deepEqual(m.extractTag('x <Answer a="1">Hi</answer>', 'answer'), {
      ok: true,
      value: 'Hi',
      attributes: { a: '1' },
      issues: [{ code: 'tag_case_mismatch', at: 18 }],
    })
    assert.equal(new m.LlmmendJsonError('truncated', '', []).code, 'truncated')
    assert.equal(m.repairJson("{name: 'Ada', ok: True,").json, '{"name":"Ada","ok":true}')
    assert.deepEqual(m.extractJsonOrThrow('Sure:\n```json\n{"a": [1, 2]}\n```'), { a: [1, 2] })
    assert.deepEqual(m.parsePartialJson('{"t": "Hel'), { value: { t: 'Hel' }, complete: false })
  },
  './sse': async (m) => {
    assert.equal(new m.LlmmendHttpError(429, new Headers(), '').status, 429)
    // Exercises the runtime's ReadableStream and streaming TextDecoder: the emoji is split.
    const bytes = new TextEncoder().encode('data: 🌊\r\n\r\n')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 8))
        controller.enqueue(bytes.subarray(8))
        controller.close()
      },
    })
    const events = []
    for await (const event of m.parseSSE(stream)) events.push(event)
    assert.deepEqual(events, [{ event: 'message', data: '🌊' }])
    // Exercises the runtime's Response.
    const reply = [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    const body = reply.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
    assert.deepEqual(await m.collectText(new Response(body), { provider: 'anthropic' }), {
      text: 'Hi',
      stopReason: 'end',
      usage: { outputTokens: 1 },
      toolCalls: [],
    })
    const chunks = [{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }, '[DONE]']
    const chat = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`)
    assert.deepEqual(await m.collectText(new Response(chat.join('')), { provider: 'openai' }), {
      text: 'Hi',
      stopReason: 'end',
      toolCalls: [],
    })
    // A tool call whose arguments the model wrote with single quotes and a trailing comma.
    const call = [
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: "{'a':" } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: ' 1,}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
      '[DONE]',
    ].map(
      (c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}

`,
    )
    const { toolCalls } = await m.collectText(new Response(call.join('')), { provider: 'openai' })
    assert.equal(toolCalls.length, 1)
    assert.deepEqual(toolCalls[0].args, { a: 1 })
    const partials = []
    for await (const item of m.streamToolCalls(new Response(call.join('')), { provider: 'openai' }))
      if (!item.done && item.type === 'tool_call') partials.push(item.partial)
    assert.deepEqual(partials, [{}, { a: 1 }])
    const json = [{ choices: [{ delta: { content: '{"a": [1]}' } }] }, '[DONE]']
    const items = []
    const body2 = json.map(
      (c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}

`,
    )
    for await (const item of m.streamJson(new Response(body2.join('')), { provider: 'openai' }))
      items.push(item)
    assert.deepEqual(items[0], { done: false, partial: { a: [1] }, complete: true })
    assert.deepEqual(items[1].result.value, { a: [1] })
    const gemini = { candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }] }
    const geminiBody = new Response(`data: ${JSON.stringify(gemini)}

`)
    // No provider: the format is detected.
    assert.deepEqual(await m.collectText(geminiBody), {
      text: 'Hi',
      stopReason: 'end',
      toolCalls: [],
    })
    // Serving: the runtime's Response, ReadableStream and TextEncoder, read back with parseSSE.
    async function* serve() {
      yield { data: 'line 1\nline 2 🌊', event: 'note', id: '7' }
      yield { type: 'text', index: 0, text: 'Hi' }
    }
    const served = m.sseResponse(serve(), { keepAlive: 60_000 })
    assert.equal(served.headers.get('content-type'), 'text/event-stream')
    const read = []
    for await (const event of m.parseSSE(served.body)) read.push(event)
    assert.deepEqual(read, [
      { event: 'note', data: 'line 1\nline 2 🌊', id: '7' },
      { event: 'message', data: '{"type":"text","index":0,"text":"Hi"}', id: '7' },
    ])
  },
  './chunk': (m) => {
    // Exercises the runtime's Intl.Segmenter: the family emoji is one grapheme cluster.
    const chunks = m.chunkText('One. Two. 👨‍👩‍👧', { maxTokens: 1, countTokens: (t) => [...t].length })
    assert.equal(chunks.map((c) => c.text).join(''), 'One. Two. 👨‍👩‍👧')
    assert.ok(chunks.some((c) => c.text === '👨‍👩‍👧' && c.oversized))
    assert.equal(m.truncateToTokens('abcdef', 3, { countTokens: (t) => t.length }), 'abc')
    assert.ok(m.estimateTokens('Hello, world!') > 0)
  },
}
