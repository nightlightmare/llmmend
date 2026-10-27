// The playground: static pages from pages.mjs, scripts from site/src, the package from src/ (so
// the site always shows the current code). Deployed to GitHub Pages by .github/workflows/pages.yml.
//
//   pnpm site:dev     serve at http://localhost:5173/llmmend/
//   pnpm site:build   build into site/dist; GOATCOUNTER=<code> adds the visit counter
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { BASE, sitemap, writePages } from './pages.mjs'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const { version } = JSON.parse(readFileSync(here('../package.json'), 'utf8'))
// Only a GoatCounter site code ([a-z0-9-]) goes into the page.
const goatcounter = /^[a-z0-9-]+$/.test(process.env.GOATCOUNTER ?? '')
  ? process.env.GOATCOUNTER
  : ''

const input = writePages(here('.pages'), { version, goatcounter })

export default defineConfig({
  root: here('.pages'),
  base: BASE,
  resolve: {
    alias: [
      { find: /^llmmend\/(json|sse|chunk|prompt|cost)$/, replacement: here('../src/$1/index.ts') },
    ],
  },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    rollupOptions: { input },
  },
  plugins: [
    {
      name: 'llmmend-site-files',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() })
        for (const name of ['llms.txt', 'llms-full.txt'])
          this.emitFile({ type: 'asset', fileName: name, source: readFileSync(here(`../${name}`)) })
      },
    },
  ],
})
