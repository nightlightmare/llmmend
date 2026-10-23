// Just enough Markdown for the docs checks: headings and fenced code blocks.

/**
 * @param {string} text
 * @returns {{
 *   headings: { level: number, text: string, line: number }[],
 *   blocks: { lang: string, code: string, line: number }[],
 * }}
 */
export function parseMarkdown(text) {
  const headings = []
  const blocks = []
  let fence
  let lines = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
        blocks.push({ lang: fence.lang, code: lines.join('\n'), line: fence.line })
        fence = undefined
      } else lines.push(line)
      return
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/)
    if (open) {
      fence = { marker: open[1], lang: open[2], line: i + 1 }
      lines = []
      return
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) headings.push({ level: heading[1].length, text: heading[2].trim(), line: i + 1 })
  })
  return { headings, blocks }
}
