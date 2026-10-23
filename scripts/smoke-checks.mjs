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
    })
    const chunks = [{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }, '[DONE]']
    const chat = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`)
    assert.deepEqual(await m.collectText(new Response(chat.join('')), { provider: 'openai' }), {
      text: 'Hi',
      stopReason: 'end',
    })
  },
}
