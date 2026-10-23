// The one Vite API the tests use. Declared here instead of depending on `vite/client` types.
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, T>
}
