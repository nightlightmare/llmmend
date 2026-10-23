// Shared by the `*.bench.ts` files. Each file runs in its own worker, so one comparison's JIT
// warm-up does not skew another's. They import `llmmend/*`, the built `dist`: source modules
// would add Vite's export getters to every internal call.
import { expect, type TestContext, test } from 'vitest'

export type Contender = [name: string, fn: () => unknown]

/**
 * Benchmarks llmmend (first) against another package and checks the target: by default no more
 * than 1.5× slower. Run by hand with `pnpm bench`, not in CI, where timings are too noisy.
 */
export function compare(title: string, ours: Contender, theirs: Contender, target = 1.5): void {
  // oxlint-disable-next-line vitest/valid-title -- the title is built by each benchmark file
  test(title, async ({ bench }: TestContext) => {
    const results = await bench.compare(bench(ours[0], ours[1]), bench(theirs[0], theirs[1]))
    const ratio = results.get(theirs[0]).throughput.mean / results.get(ours[0]).throughput.mean
    console.log(`${title}: llmmend takes ${ratio.toFixed(2)}× the time of ${theirs[0]}`)
    expect.soft(ratio).toBeLessThanOrEqual(target)
  })
}

/** Runs `fn`, ignoring a throw: both libraries reject some inputs, and the time still counts. */
export function attempt(fn: () => unknown): void {
  try {
    fn()
  } catch {
    // Rejected input.
  }
}
