/** Splits `data` into pieces at the given offsets (taken modulo the length, deduplicated). */
export function splitAt(data: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => c % (data.length + 1)))]
  points.sort((a, b) => a - b)
  const pieces: Uint8Array[] = []
  let start = 0
  for (const p of [...points, data.length]) {
    pieces.push(data.subarray(start, p))
    start = p
  }
  return pieces
}
