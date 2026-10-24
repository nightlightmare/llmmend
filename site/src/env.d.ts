// Vite's `?raw` imports: the file's text, bundled into the page.
declare module '*?raw' {
  const text: string
  export default text
}

declare module '*.css'
