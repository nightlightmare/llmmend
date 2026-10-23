# User-facing docs in English, Chinese and Russian; everything else English only

The README and `docs/api.md` (descriptions and examples) are published in English, Simplified Chinese and Russian, because those are the audiences we target. Everything else (code, JSDoc, error messages, `package.json`, GitHub About, issues, PRs, commits, changelog, `GLOSSARY.md`, ADRs, agent docs) is English only. English is the source of truth. Each file opens with an `English | 简体中文 | Русский` switcher. The README translations live in `docs/` (`docs/README.zh-CN.md`, `docs/README.ru.md`), not beside `README.md`: npm takes the package's README from the first file matching `README.*` in the package root, in no fixed order, and 0.1.0 shipped with the Chinese README on npmjs.com that way.

Translations change in the same PR as the English text. `scripts/check-i18n.mjs` runs in CI and fails when the three files differ in heading count and order, or when their code blocks differ after comments are stripped (comments inside examples are translated). This catches a forgotten example update without trying to compare meaning; review by a native speaker is welcome but never blocks a release.

## Considered Options

- **One file mixing three languages**: rejected, unreadable and impossible to diff.
- **README translations beside `README.md`** (`README.zh-CN.md` in the root, a common convention): rejected after 0.1.0, see above; `scripts/check-i18n.mjs` fails if any `README.*` other than `README.md` appears in the root.
- **Untranslated comments inside examples** so code blocks compare byte for byte: rejected, translated comments are part of what makes an example useful to a reader.
