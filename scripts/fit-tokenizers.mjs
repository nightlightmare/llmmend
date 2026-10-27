// Fits the `claude` and `gemini` weights of estimateTokens (src/chunk/tokens.ts) to the counts
// record-token-counts.mjs recorded, and prints them with how they do: on the corpus, and on each
// text when fitted without it. Rerun both after changing the corpus, then copy the weights over.
//   node scripts/fit-tokenizers.mjs
import { readdirSync, readFileSync } from 'node:fs'

// The runs and features estimateTokens counts, in the order of its weights: keep them in step.
const RUNS =
  /(?<lat>[A-Za-zÀ-ɏ]+)|(?<cyr>[Ѐ-ӿ]+)|(?<han>[㐀-鿿豈-﫿]+)|(?<kana>[぀-ヿ]+)|(?<hng>[가-힯]+)|(?<sym>(?:[\u{2070}-\u{2BFF}\u{1F000}-\u{1FAFF}]\u{FE0F}?)+)|(?<dig>\d+)|(?<ws>\s+)|(?<rep>(?<ch>[!-/:-@[-`{-~])\k<ch>+)|(?<pun>[!-/:-@[-`{-~])/gu
const O200K = [1, 0.25, 0, 1, 0.25, 0.8, 0.8, 0.8, 1.2, 1, 1, 1 / 64, 1, 1 / 64, 0.64, 1, 0.5]

function features(text) {
  const f = Array.from({ length: O200K.length }, () => 0)
  let counted = 0
  for (const match of text.matchAll(RUNS)) {
    const g = match.groups
    const n = match[0].length
    counted += n
    if (g.lat) {
      f[0]++
      f[1] += Math.max(0, n - 6)
      if (n > 1 && g.lat === g.lat.toUpperCase()) f[2] += n
    } else if (g.cyr) {
      f[3]++
      f[4] += Math.max(0, n - 3)
    } else if (g.han) f[5] += n
    else if (g.kana) f[6] += n
    else if (g.hng) f[7] += n
    else if (g.sym) f[8] += [...g.sym].length
    else if (g.dig) f[9] += Math.ceil(n / 3)
    else if (g.ws) {
      if (g.ws.includes('\n') || n > 1) {
        f[10]++
        f[11] += n
      }
    } else if (g.rep) {
      f[12]++
      f[13] += n
    } else if (match[0] === '|') f[15]++
    else f[14]++
  }
  f[16] += text.length - counted
  return f
}

const fixtures = new URL('../test/fixtures/chunk/', import.meta.url)
const texts = new Map()
for (const [dir, name] of [
  ['repo', (file) => file.replaceAll('__', '/').replace(/\.txt$/, '')],
  ['corpus', (file) => `corpus/${file}`],
]) {
  for (const file of readdirSync(new URL(`${dir}/`, fixtures)).toSorted()) {
    texts.set(name(file), readFileSync(new URL(`${dir}/${file}`, fixtures), 'utf8'))
  }
}
const windows = (text, size) => {
  const out = []
  for (let i = 0; i + size <= text.length; i += size / 2) out.push(text.slice(i, i + size))
  return out
}

function samples(tokenizer) {
  const counts = JSON.parse(readFileSync(new URL(`counts/${tokenizer}.json`, fixtures), 'utf8'))
  const out = []
  for (const [name, text] of texts) {
    const c = counts.texts[name]
    out.push({ name, kind: 'whole', f: features(text), y: c.whole, long: text.length > 500 })
    for (const size of [1000, 600]) {
      windows(text, size).forEach((w, i) =>
        out.push({ name, kind: size, f: features(w), y: c[size][i] }),
      )
    }
  }
  return out
}

function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let i = 0; i < n; i++) {
    let p = i
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
    ;[M[i], M[p]] = [M[p], M[i]]
    for (let k = 0; k < n; k++) {
      if (k === i) continue
      const factor = M[k][i] / M[i][i]
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

// Least squares on the relative error, whole texts weighing 5 windows (so Japanese and Korean,
// one short text each, count), pulled towards `o200k`'s weights scaled to the tokenizer.
const RIDGE = 0.1
const WHOLE = 5
function fit(s) {
  const base =
    s.filter((x) => x.kind === 'whole').reduce((a, x) => a + x.y, 0) /
    s
      .filter((x) => x.kind === 'whole')
      .reduce((a, x) => a + x.f.reduce((p, v, k) => p + v * O200K[k], 0), 0)
  const prior = O200K.map((v) => v * base)
  const n = O200K.length
  const A = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))
  const b = Array.from({ length: n }, () => 0)
  for (const x of s) {
    const weight = x.kind === 'whole' ? WHOLE : 1
    const g = x.f.map((v) => v / x.y)
    for (let i = 0; i < n; i++) {
      b[i] += weight * g[i]
      for (let j = 0; j < n; j++) A[i][j] += weight * g[i] * g[j]
    }
  }
  for (let i = 0; i < n; i++) {
    const ridge = RIDGE / Math.max(prior[i] ** 2, 0.01)
    A[i][i] += ridge
    b[i] += ridge * prior[i]
  }
  return solve(A, b).map((v) => Math.round(v * 100) / 100)
}

const error = (x, w) =>
  (Math.max(1, Math.round(x.f.reduce((a, v, k) => a + v * w[k], 0))) - x.y) / x.y
const pct = (e) => `${(e * 100).toFixed(1)} %`

for (const tokenizer of ['claude', 'gemini']) {
  const s = samples(tokenizer)
  const w = fit(s)
  const w1000 = s.filter((x) => x.kind === 1000).map((x) => Math.abs(error(x, w)))
  const w600 = s.filter((x) => x.kind === 600).map((x) => Math.abs(error(x, w)))
  const wholes = s.filter((x) => x.kind === 'whole' && x.long).map((x) => Math.abs(error(x, w)))
  const heldOut = []
  for (const name of texts.keys()) {
    const without = fit(s.filter((x) => x.name !== name))
    for (const x of s.filter((x) => x.name === name && x.kind === 1000))
      heldOut.push(Math.abs(error(x, without)))
  }
  console.log(`${tokenizer}: [${w.join(', ')}]`)
  console.log(
    `  worst 1,000-character window ${pct(Math.max(...w1000))}, held out ${pct(Math.max(...heldOut))}`,
  )
  console.log(
    `  600-character windows within 15 %: ${pct(w600.filter((e) => e <= 0.15).length / w600.length)}`,
  )
  console.log(`  worst whole text ${pct(Math.max(...wholes))}`)
}
