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
    if (text === '') return lines
    let start = 0
    if (skipLF) {
      skipLF = false
      if (text.charCodeAt(0) === LF) start = 1
    }
    // `indexOf` is much faster than a loop over every character. Each position is searched
    // again only once passed, so text without any CR is not rescanned for every line.
    let lf = text.indexOf('\n', start)
    let cr = text.indexOf('\r', start)
    for (;;) {
      if (lf !== -1 && lf < start) lf = text.indexOf('\n', start)
      if (cr !== -1 && cr < start) cr = text.indexOf('\r', start)
      const end = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr)
      if (end === -1) break
      lines.push(buffer + text.slice(start, end))
      buffer = ''
      start = end + 1
      if (end === cr) {
        if (start === text.length) skipLF = true
        else if (text.charCodeAt(start) === LF) start++
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
