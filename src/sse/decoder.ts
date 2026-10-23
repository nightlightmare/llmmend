// Bytes to lines for the SSE parser, per the WHATWG event stream format: UTF-8 decoded in
// streaming mode (a character split across chunks is never broken), lines ending in CRLF, LF or CR.

/**
 * Turns stream chunks into complete lines. There is no flush: whatever is buffered when the
 * stream ends is an unterminated line of an incomplete event, which the spec says to discard.
 */
export interface LineDecoder {
  /** Feeds a chunk and returns the lines it completed, without their line endings. */
  push(chunk: Uint8Array | string): string[]
}

const LF = 0x0a
const CR = 0x0d
const BOM = 0xfeff

export function createLineDecoder(): LineDecoder {
  // The default TextDecoder strips a leading BOM, as the spec requires for byte streams.
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  // The previous chunk ended with CR, so an LF at the start of the next one ends nothing.
  let skipLF = false

  function take(text: string): string[] {
    const lines: string[] = []
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i)
      if (skipLF) {
        skipLF = false
        if (ch === LF) {
          start = i + 1
          continue
        }
      }
      if (ch === LF || ch === CR) {
        lines.push(buffer + text.slice(start, i))
        buffer = ''
        start = i + 1
        skipLF = ch === CR
      }
    }
    buffer += text.slice(start)
    return lines
  }

  return {
    push(chunk) {
      let text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      if (!started && text.length > 0) {
        started = true
        if (text.charCodeAt(0) === BOM) text = text.slice(1)
      }
      return take(text)
    },
  }
}
