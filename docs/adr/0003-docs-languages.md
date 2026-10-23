# User-facing docs in English, Chinese and Russian; everything else English only

The README and `docs/api.md` (descriptions and examples) are published in English, Simplified Chinese and Russian, because those are the audiences we target. Everything else (code, JSDoc, error messages, `package.json`, GitHub About, issues, PRs, commits, changelog, `GLOSSARY.md`, ADRs, agent docs) is English only. English is the source of truth: npm renders only `README.md`, so `README.zh-CN.md` and `README.ru.md` sit beside it, each opening with an `English | 简体中文 | Русский` switcher.

Translations change in the same PR as the English text. `scripts/check-i18n.mjs` runs in CI and fails when the three files differ in heading count and order, or when their code blocks differ after comments are stripped (comments inside examples are translated). This catches a forgotten example update without trying to compare meaning; review by a native speaker is welcome but never blocks a release.

## Considered Options

- **One file mixing three languages**: rejected, unreadable and impossible to diff.
- **Untranslated comments inside examples** so code blocks compare byte for byte: rejected, translated comments are part of what makes an example useful to a reader.
