<!-- TEMPLATE: replace PACKAGE_NAME / PACKAGE_DESCRIPTION everywhere, then delete the "Using this template" section. -->

# PACKAGE_NAME

[![npm](https://img.shields.io/npm/v/PACKAGE_NAME)](https://www.npmjs.com/package/PACKAGE_NAME)
[![bundle size](https://img.shields.io/bundlejs/size/PACKAGE_NAME)](https://bundlejs.com/?q=PACKAGE_NAME)
[![CI](https://github.com/nightlightmare/PACKAGE_NAME/actions/workflows/ci.yml/badge.svg)](https://github.com/nightlightmare/PACKAGE_NAME/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/PACKAGE_NAME#provenance)
![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)

**One sentence: the pain, then the fix.**

## The problem

<!-- 2–3 sentences in the words people search with. -->

## The fix

```ts
import { clamp } from 'PACKAGE_NAME/example'

clamp(15, 0, 10) // 10
```

## Install

```sh
npm install PACKAGE_NAME
```

Works in Node 20+, Bun, Deno and browsers. ESM and CommonJS, fully typed, zero dependencies.

## API

### `PACKAGE_NAME/example`

#### `clamp(value, min, max)`

## How it differs from alternatives

|                   | PACKAGE_NAME | alternative-a | alternative-b |
| ----------------- | ------------ | ------------- | ------------- |
| Zero dependencies | ✅           |               |               |
| Size (min+gzip)   |              |               |               |

## License

MIT © nightlightmare

---

## Using this template

1. On GitHub: **Use this template** → name the repo after the npm package.
2. Replace `PACKAGE_NAME` and `PACKAGE_DESCRIPTION` across the repo; fill `keywords`.
3. Rename `src/example/` to your first module and update `exports`, `size-limit` and `tsdown.config.ts`.
4. Update the per-subpath checks in `scripts/smoke.mjs`.
5. `pnpm install && pnpm coverage && pnpm build && pnpm smoke && pnpm check:publish && pnpm size`
6. npmjs.com → package → **Settings → Trusted Publisher**: GitHub Actions, this repo, workflow `release.yml`.
7. When the first release is ready, remove `"private": true` from `package.json`. Until then the release workflow publishes nothing.
8. Create the triage labels: `for l in needs-triage needs-info ready-for-agent ready-for-human wontfix; do gh label create $l; done`
