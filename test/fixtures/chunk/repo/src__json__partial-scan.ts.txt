// `locate(text, 'partial')` for a Reply that arrives in pieces (`streamJson`), without reading the
// whole text again for every piece: the scan keeps its place, and a Candidate the end of the text
// cut off goes on from its Checkpoints. Each piece reads only the text after the innermost one,
// so a long Reply costs linear time. The loop mirrors `locate`: change both together.
import {
  AT_END,
  CANNOT,
  createStartCheck,
  FAILED_SCAN_BUDGET,
  MAY,
  OPEN_BRACE,
  OPEN_BRACKET,
} from './locate'
import { type Checkpoint, parseValueAt, type ParseResult } from './parser'

export interface PartialCandidate {
  start: number
  end: number
  value: unknown
  /** False while the end of the text cuts the value off. */
  complete: boolean
}

/** Checkpoints with every position moved by `by`. */
function shift(checkpoints: Checkpoint[], by: number): Checkpoint[] {
  return checkpoints.map((c) =>
    c.kind === 'string'
      ? { ...c, start: c.start + by, resumeAt: c.resumeAt + by }
      : { ...c, start: c.start + by, resumeAt: c.resumeAt + by, commaAt: c.commaAt + by },
  )
}

export class PartialScan {
  /** Candidates that ended before the end of the text: they never change. */
  readonly complete: PartialCandidate[] = []
  /** The Candidate the end of the text cuts off, after all of `complete`. */
  open: PartialCandidate | undefined
  /** Where `open` goes on from, in positions of the whole text. */
  private checkpoints: Checkpoint[] = []
  /** Whether `open` passed the start check only because the text ended right after it. */
  private openAtEnd = false
  private readonly pieces: string[] = []
  private readonly pieceStarts: number[] = []
  private length = 0
  /** The next start to try. */
  private next = 0
  private spent = 0
  private readonly doomed = new Set<number>()
  private stopped = false

  push(piece: string): void {
    this.pieces.push(piece)
    this.pieceStarts.push(this.length)
    this.length += piece.length
    if (this.stopped) return
    let i = this.next
    let base = i
    let resume: Checkpoint[] | undefined
    if (this.open) {
      // The open Candidate is tried again at its start, as `locate` would on the longer text.
      i = this.open.start
      resume = this.checkpoints
      base = this.openAtEnd ? i : resume.at(-1)!.resumeAt
      this.open = undefined
    }
    let text = this.textFrom(base)
    let mayStartAt = createStartCheck(text, true)
    while (i < this.length && this.spent < FAILED_SCAN_BUDGET * this.length + 4096) {
      if (i < base && !resume) {
        // The open Candidate failed: scan what it covered, as `locate` does after a failed start.
        // (Resuming it reads nothing before `base`.)
        base = i
        text = this.textFrom(base)
        mayStartAt = createStartCheck(text, true)
      }
      let start: number = MAY
      let result: ParseResult
      if (resume) {
        if (this.openAtEnd) start = mayStartAt(i - base)
        if (start === CANNOT) {
          resume = undefined
          i++
          continue
        }
        result = parseValueAt(text, i - base, { repair: 'partial', resume: shift(resume, -base) })
        resume = undefined
      } else {
        const ch = text.charCodeAt(i - base)
        if ((ch !== OPEN_BRACE && ch !== OPEN_BRACKET) || this.doomed.has(i)) {
          i++
          continue
        }
        start = mayStartAt(i - base)
        if (start === CANNOT) {
          i++
          continue
        }
        result = parseValueAt(text, i - base, { repair: 'partial' })
      }
      if (result.ok) {
        const candidate = { start: i, end: result.end + base, value: result.value, complete: true }
        if (result.checkpoints) {
          candidate.complete = false
          this.open = candidate
          this.checkpoints = shift(result.checkpoints, base)
          this.openAtEnd = start === AT_END
        } else {
          this.complete.push(candidate)
        }
        i = candidate.end
        continue
      }
      if (result.error !== 'unparseable') {
        this.stopped = true
        break
      }
      for (const open of result.open) this.doomed.add(open + base)
      this.spent += result.at + base - i + 1
      i++
    }
    this.next = i
  }

  /** The text from `pos` to the end, joined from the pieces it spans. */
  private textFrom(pos: number): string {
    let k = this.pieces.length - 1
    while (k > 0 && this.pieceStarts[k]! > pos) k--
    const head = this.pieces[k]!.slice(pos - this.pieceStarts[k]!)
    return k === this.pieces.length - 1 ? head : head + this.pieces.slice(k + 1).join('')
  }
}
