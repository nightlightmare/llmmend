// Writes the playground's static pages: one per language and tab, each with its own title,
// description and links to its translations, so search engines index every tool in every
// language. vite.config.mjs calls it before building; the output (site/.pages/) is not committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { LANGS, STRINGS, TABS } from './i18n.mjs'

export const ORIGIN = 'https://nightlightmare.github.io'
export const BASE = '/llmmend/'
const REPO = 'https://github.com/nightlightmare/llmmend'

/** The page's path below BASE: English at the root, tabs other than JSON in subfolders. */
export const pagePath = (lang, tab) =>
  `${lang === 'en' ? '' : `${lang}/`}${tab === 'json' ? '' : `${tab}/`}`

const url = (lang, tab) => `${ORIGIN}${BASE}${pagePath(lang, tab)}`

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const select = (id, label, options) => `
        <label>${escape(label)}
          <select id="${id}">${options
            .map(([value, text]) => `<option value="${escape(value)}">${escape(text)}</option>`)
            .join('')}</select>
        </label>`

const number = (id, label, value, min) => `
        <label>${escape(label)}
          <input id="${id}" type="number" min="${min}" value="${value}" />
        </label>`

const tools = {
  json: (t) => `
      <div class="controls">${select('sample', t.sample, Object.entries(t.json.samples))}${select(
        'pick',
        t.json.pick,
        [
          ['last', 'last'],
          ['first', 'first'],
          ['largest', 'largest'],
        ],
      )}${select('repair', t.json.repair, [
        ['full', 'full'],
        ['syntax', 'syntax'],
        ['none', 'none'],
      ])}${select('expect', t.json.expect, [
        ['any', 'any'],
        ['object', 'object'],
        ['array', 'array'],
      ])}
      </div>
      <details>
        <summary>${escape(t.json.schema)}</summary>
        <textarea id="schema" rows="6" spellcheck="false" placeholder='{"type": "object", "required": ["city"]}'></textarea>
        <p class="note">${escape(t.json.schemaNote)}</p>
      </details>`,
  sse: (t) => `
      <div class="controls">${select('sample', t.sample, [
        ['anthropic-thinking', 'Anthropic: thinking, cut off by max_tokens'],
        ['anthropic-tools', 'Anthropic: parallel tool calls'],
        ['openai-tools', 'OpenAI Chat Completions (Ollama): tool calls'],
        ['openrouter-reasoning', 'OpenRouter: reasoning'],
        ['responses-refusal', 'OpenAI Responses: refusal'],
        ['gemini-max-tokens', 'Gemini: cut off by max tokens'],
      ])}${select('provider', t.sse.provider, [
        ['auto', t.sse.auto],
        ['anthropic', 'anthropic'],
        ['openai', 'openai'],
        ['openai-responses', 'openai-responses'],
        ['gemini', 'gemini'],
      ])}
      </div>`,
  chunk: (t) => `
      <div class="controls">${select('sample', t.sample, [
        ['readme', 'README.md'],
        ['ja', '日本語 (ja.txt)'],
      ])}${number('max-tokens', t.chunk.maxTokens, 120, 1)}${number(
        'overlap',
        t.chunk.overlap,
        20,
        0,
      )}${select('mode', t.chunk.mode, [
        ['markdown', t.chunk.markdown],
        ['text', t.chunk.text],
      ])}
      </div>`,
}

function page(lang, tab, { version, goatcounter }) {
  const t = STRINGS[lang]
  const depth = pagePath(lang, tab).split('/').length - 1
  const up = '../'.repeat(depth + 1)
  const alternates = LANGS.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${url(l, tab)}" />`,
  ).join('\n    ')
  const strings = JSON.stringify({ ...t, lang, tab }).replace(/</g, '\\u003c')
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `llmmend: ${t.h1[tab]}`,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (runs in the browser)',
    offers: { '@type': 'Offer', price: '0' },
    url: url(lang, tab),
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(t.title[tab])} · llmmend</title>
    <meta name="description" content="${escape(t.description[tab])}" />
    <link rel="canonical" href="${url(lang, tab)}" />
    ${alternates}
    <link rel="alternate" hreflang="x-default" href="${url('en', tab)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escape(t.title[tab])}" />
    <meta property="og:description" content="${escape(t.description[tab])}" />
    <meta property="og:url" content="${url(lang, tab)}" />
    <script type="application/ld+json">${jsonLd}</script>
    <script type="application/json" id="strings">${strings}</script>
    <script type="module" src="${up}src/main.ts"></script>${
      goatcounter
        ? `\n    <script data-goatcounter="https://${goatcounter}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`
        : ''
    }
  </head>
  <body>
    <header>
      <a class="brand" href="${BASE}${pagePath(lang, 'json')}">llmmend</a>
      <span class="tagline">${escape(t.tagline)}</span>
      <nav class="langs">${LANGS.map((l) =>
        l === lang
          ? `<span aria-current="page">${escape(STRINGS[l].langName)}</span>`
          : `<a href="${BASE}${pagePath(l, tab)}" hreflang="${l}" lang="${l}">${escape(STRINGS[l].langName)}</a>`,
      ).join(' ')}</nav>
    </header>
    <nav class="tabs">${TABS.map((tb) =>
      tb === tab
        ? `<span aria-current="page">${escape(t.tabs[tb])}</span>`
        : `<a href="${BASE}${pagePath(lang, tb)}">${escape(t.tabs[tb])}</a>`,
    ).join('')}</nav>
    <main>
      <h1>${escape(t.h1[tab])}</h1>
      <p class="lead">${escape(t.description[tab])}</p>
      ${tools[tab](t)}
      <div class="panes">
        <section>
          <div class="pane-head">
            <h2><label for="input">${escape(t.input)}</label></h2>
            <button id="share" type="button">${escape(t.share)}</button>
            <span id="share-status" role="status"></span>
          </div>
          <textarea id="input" rows="18" spellcheck="false"></textarea>
        </section>
        <section>
          <div class="pane-head"><h2>${escape(t.output)}</h2></div>
          <div id="output" aria-live="polite"></div>
        </section>
      </div>
      <p class="note">${escape(t.privacy)}${goatcounter ? ` ${escape(t.analytics)}` : ''}</p>
    </main>
    <footer>
      <a href="${REPO}">${escape(t.footer)}</a> ·
      <a href="https://www.npmjs.com/package/llmmend">npm i llmmend@${escape(version)}</a> ·
      <a href="${BASE}llms.txt">llms.txt</a>
    </footer>
  </body>
</html>
`
}

/** Writes every page into `dir` and returns their paths, for Vite's `build.rollupOptions.input`. */
export function writePages(dir, options) {
  rmSync(dir, { recursive: true, force: true })
  const inputs = {}
  for (const lang of LANGS) {
    for (const tab of TABS) {
      const path = pagePath(lang, tab)
      mkdirSync(`${dir}/${path}`, { recursive: true })
      writeFileSync(`${dir}/${path}index.html`, page(lang, tab, options))
      inputs[`${lang}-${tab}`] = `${dir}/${path}index.html`
    }
  }
  return inputs
}

/** sitemap.xml with every page and its translations. */
export function sitemap() {
  const entries = LANGS.flatMap((lang) =>
    TABS.map(
      (tab) => `  <url>
    <loc>${url(lang, tab)}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(l, tab)}" />`).join('\n')}
  </url>`,
    ),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`
}
