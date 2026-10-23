## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Languages

Only the README and `docs/api.md` exist in three languages (`*.md`, `*.zh-CN.md`, `*.ru.md`; the README translations live in `docs/`, never in the root, where npm could pick one as the package README); English is the source of truth and translations change in the same PR. Write everything else in English only: code, comments, JSDoc, error messages, issues, PRs, commits, changesets, `GLOSSARY.md`, ADRs. See `docs/adr/0003-docs-languages.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
