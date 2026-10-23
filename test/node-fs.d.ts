// The two `node:fs` functions the tests read fixtures with. Declared here instead of adding
// @types/node, which would make Node APIs type-check in `src`, where only Web APIs may be used.
declare module 'node:fs' {
  export function readdirSync(path: URL): string[]
  export function readFileSync(path: URL, encoding: 'utf8'): string
}
