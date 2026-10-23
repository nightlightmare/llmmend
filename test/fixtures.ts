// Fixtures are loaded through Vite instead of node:fs, so the suites also run in WebKit.
const files = import.meta.glob<string>('./fixtures/**/*.{txt,json,sse}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The files directly inside one fixture directory, by file name. */
export function fixtureDir(dir: string): Map<string, string> {
  const prefix = `./fixtures/${dir}/`
  const result = new Map<string, string>()
  for (const [path, text] of Object.entries(files)) {
    const name = path.slice(prefix.length)
    if (path.startsWith(prefix) && !name.includes('/')) result.set(name, text)
  }
  return result
}
